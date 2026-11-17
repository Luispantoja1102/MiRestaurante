// Uber Eats: webhook firmado, pedido guardado una sola vez, aceptar/rechazar y vínculo de tienda por negocio.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');

process.env.UBER_EATS_ENV = 'sandbox';
process.env.UBER_EATS_CLIENT_ID = 'cid';
process.env.UBER_EATS_CLIENT_SECRET = 'secreto-de-prueba';
const SECRET = process.env.UBER_EATS_CLIENT_SECRET;

const { app, state, tokenFor } = loadApp();
let api;
const realFetch = global.fetch;
const uberCalls = [];
let uberOrders = {}; // orderId -> respuesta de Get Order Details
let uberFails = null; // status con el que falla accept/deny
let storeState = { status: 'ONLINE' }; // estado de la tienda en Uber
let createdOrders = []; // ids que Uber tiene en CREATED (null = Uber falla)
let storeAvgPrep = 15; // avg_prep_time de la tienda (null = Uber falla al consultarla)
let prepFails = false;

// Los pedidos a la API local pasan; todo lo de Uber se simula.
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  const raw = Buffer.isBuffer(opts.body) ? zlib.gunzipSync(opts.body).toString() : opts.body ? String(opts.body) : null; // el menú viaja comprimido
  uberCalls.push({ url: u, method: opts.method || 'GET', body: raw, headers: opts.headers || {} });
  const json = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  if (u.includes('/oauth/v2/token')) return json(200, { access_token: 'tk', expires_in: 2592000 });
  if (/\/v1\/eats\/stores\/[^/?]+$/.test(u)) return storeAvgPrep == null ? json(500, {}) : json(200, { name: 'Tienda', avg_prep_time: storeAvgPrep });
  if (/\/v1\/delivery\/store\/[^/]+\/update-store-prep-time$/.test(u)) return prepFails ? json(404, { message: 'no existe' }) : json(204);
  if (/\/v1\/eats\/stores\/[^/]+\/created-orders/.test(u)) {
    return createdOrders ? json(200, { orders: createdOrders.map((id) => ({ id, current_state: 'CREATED', placed_at: '2026-11-16T10:00:00Z' })) }) : json(500, {});
  }
  const m = u.match(/\/v2\/eats\/order\/([^/?]+)/);
  if (m) return uberOrders[m[1]] ? json(200, uberOrders[m[1]]) : json(404, {});
  if (/\/v1\/eats\/store\/[^/]+\/status$/.test(u)) {
    if ((opts.method || 'GET') === 'POST') {
      if (uberFails) return json(uberFails, {});
      storeState = { status: JSON.parse(opts.body).status };
      return json(204);
    }
    return json(200, storeState);
  }
  if (/\/v2\/eats\/stores\/[^/]+\/menus$/.test(u) && opts.method === 'PUT') return uberFails ? json(uberFails, { error: 'precio inválido' }) : json(204);
  if (/\/v2\/eats\/stores\/[^/]+\/menus\/items\/[^/]+$/.test(u)) return uberFails ? json(uberFails, {}) : json(204);
  if (/accept_pos_order|deny_pos_order|\/cancel$|restaurantdelivery\/status$/.test(u)) return uberFails ? json(uberFails, {}) : json(204);
  return json(500, {});
};

test.before(async () => {
  api = await startServer(app);
  state.users.push(
    { _id: new ObjectId(), name: 'Ana', lastName: 'D', username: 'ana', email: 'ana@t1.com', password: 'x', role: 'admin', tenantId: 't1' },
    { _id: new ObjectId(), name: 'Caro', lastName: 'C', username: 'caro', email: 'caro@t1.com', password: 'x', role: 'cashier', tenantId: 't1' },
    { _id: new ObjectId(), name: 'Beto', lastName: 'B', username: 'beto', email: 'beto@t2.com', password: 'x', role: 'admin', tenantId: 't2' },
  );
  state.foods.push({ id: 'f-latte', name: 'Latte', price: 40, tenantId: 't1' });
});
test.after(async () => { await api.close(); global.fetch = realFetch; });

const admin = () => tokenFor('ana', 'admin', 't1');
const cashier = () => tokenFor('caro', 'cashier', 't1');
const STORE = 'store-uuid-0001';

const sample = (id, over = {}) => ({
  id,
  display_id: id.slice(-5).toUpperCase(),
  type: 'DELIVERY_BY_UBER',
  eater: { first_name: 'Marta', last_name: 'Ríos', phone: '5512345678', phone_code: '+52' },
  cart: {
    items: [
      { title: 'Latte', quantity: 2, price: { unit_price: { amount: 4000 } }, special_instructions: 'sin azúcar', selected_modifier_groups: [{ selected_items: [{ title: 'Leche de avena', quantity: 1 }] }] },
      { title: 'Pan dulce', quantity: 1, price: { unit_price: { amount: 3500 } } },
    ],
  },
  payment: { charges: { sub_total: { amount: 11500 }, tax: { amount: 920 }, total: { amount: 12420 } } },
  ...over,
});

const body = (event_type, orderId, store = STORE) =>
  JSON.stringify({ event_type, event_id: `ev-${orderId}-${event_type}`, event_time: 1, meta: { resource_id: orderId, user_id: store, status: 'pos' } });
const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const hook = (raw, signature = sign(raw)) =>
  realFetch(`${api.base}/integrations/uber/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Uber-Signature': signature } : {}) }, body: raw });
const uberOrder = (id) => state.orders.find((o) => o.external?.orderId === id);
const link = () => api.call('PUT', '/integrations/uber', { token: admin(), body: { storeId: STORE } });

test('vincular la tienda: solo el administrador, con un Store ID válido y que no sea de otro negocio', async () => {
  assert.equal((await api.call('PUT', '/integrations/uber', { token: cashier(), body: { storeId: STORE } })).status, 403);
  assert.equal((await api.call('PUT', '/integrations/uber', { token: admin(), body: { storeId: '¿?' } })).status, 400);
  const ok = await link();
  assert.equal(ok.status, 200);
  assert.equal(ok.json.storeId, STORE);
  const otro = await api.call('PUT', '/integrations/uber', { token: tokenFor('beto', 'admin', 't2'), body: { storeId: STORE } });
  assert.equal(otro.status, 409);
  const st = await api.call('GET', '/integrations/uber', { token: admin() });
  assert.deepEqual([st.json.configured, st.json.environment, st.json.storeId], [true, 'sandbox', STORE]);
});

test('el webhook rechaza lo que no viene firmado por Uber', async () => {
  const raw = body('orders.notification', 'o-aaaaa1');
  assert.equal((await hook(raw, null)).status, 401);
  assert.equal((await hook(raw, 'a'.repeat(64))).status, 401);
  assert.equal((await hook(raw, sign(raw, 'otro-secreto'))).status, 401);
  assert.equal((await hook(raw + ' ', sign(raw))).status, 401); // el cuerpo cambió: la firma ya no vale
  assert.equal(state.orders.length, 0);
});

test('un pedido de Uber se guarda una sola vez, con su origen, sin envío y pendiente de aceptar', async () => {
  uberOrders['o-aaaaa1'] = sample('o-aaaaa1');
  const raw = body('orders.notification', 'o-aaaaa1');
  const r = await hook(raw);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
  const o = uberOrder('o-aaaaa1');
  assert.equal(o.tenantId, 't1');
  assert.equal(o.channel, 'uber');
  assert.equal(o.status, 'pending');
  assert.equal(o.paymentStatus, 'unpaid');
  assert.equal(o.deliveryFee, 0);
  assert.equal(o.total, 124.2);
  assert.equal(o.tableName, 'Uber Eats · Marta Ríos #AAAA1');
  assert.equal(o.modality, 'delivery');
  assert.equal(o.delivery.phone, '+52 5512345678');
  assert.deepEqual(o.items.map((i) => [i.name, i.price, i.quantity]), [['Latte', 40, 2], ['Pan dulce', 35, 1]]);
  assert.match(o.items[0].notes, /Leche de avena/);
  assert.equal(o.items[0].foodId, 'f-latte'); // el nombre coincide con el menú
  assert.equal(o.external.state, 'awaiting');
  // Uber reintenta el mismo evento: no se duplica ni se vuelve a pedir a Uber
  const antes = uberCalls.length;
  assert.equal((await hook(raw)).status, 200);
  assert.equal(state.orders.length, 1);
  assert.equal(uberCalls.length, antes);
});

test('la lista de pedidos por responder trae solo los de plataforma pendientes de este negocio', async () => {
  const r = await api.call('GET', '/orders/awaiting', { token: cashier() });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.map((o) => o.external.orderId), ['o-aaaaa1']);
  assert.equal((await api.call('GET', '/orders/awaiting', { token: tokenFor('x', 'waiter', 't1') })).status, 403);
  assert.deepEqual((await api.call('GET', '/orders/awaiting', { token: tokenFor('beto', 'admin', 't2') })).json, []);
});

test('una tienda sin vincular se ignora con 200', async () => {
  uberOrders['o-zzzzz9'] = sample('o-zzzzz9');
  const r = await hook(body('orders.notification', 'o-zzzzz9', 'tienda-desconocida'));
  assert.equal(r.status, 200);
  assert.equal(uberOrder('o-zzzzz9'), undefined);
});

test('si Uber no responde al pedir el detalle, el webhook devuelve 500 para que reintente', async () => {
  const r = await hook(body('orders.notification', 'o-noexiste'));
  assert.equal(r.status, 500);
  assert.equal(uberOrder('o-noexiste'), undefined);
});

test('mientras espera respuesta no se puede cobrar ni mover de estado', async () => {
  const o = uberOrder('o-aaaaa1');
  assert.equal((await api.call('PUT', `/orders/${o.id}/pay`, { token: cashier(), body: {} })).status, 400);
  assert.equal((await api.call('PUT', `/orders/${o.id}/status`, { token: cashier(), body: { status: 'preparing' } })).status, 400);
});

test('aceptar exige caja abierta; si Uber falla el pedido sigue esperando', async () => {
  const o = uberOrder('o-aaaaa1');
  const sinCaja = await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() });
  assert.equal(sinCaja.status, 400);
  assert.match(sinCaja.text, /caja/i);
  state.cash.push({ id: 'c1', tenantId: 't1', status: 'open' });
  uberFails = 404;
  const venc = await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() });
  assert.equal(venc.status, 502);
  assert.equal(uberOrder('o-aaaaa1').external.state, 'awaiting');
  uberFails = null;
});

test('aceptar avisa a Uber, cobra como Plataforma en la caja abierta y manda el pedido a cocina', async () => {
  const o = uberOrder('o-aaaaa1');
  const r = await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 'preparing');
  assert.equal(r.json.paymentMethod, 'platform');
  assert.equal(r.json.paymentStatus, 'paid');
  assert.equal(r.json.cashSessionId, 'c1');
  assert.equal(r.json.external.state, 'accepted');
  const call = uberCalls.filter((c) => c.url.endsWith('/v1/eats/orders/o-aaaaa1/accept_pos_order')).pop();
  assert.ok(call.url.startsWith('https://test-api.uber.com/'));
  assert.equal(JSON.parse(call.body).external_reference_id, o.id);
  // ya no espera respuesta: no se puede aceptar dos veces
  assert.equal((await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() })).status, 400);
});

test('sin pantalla de Cocina (solo para llevar o con meseros) el pedido aceptado pasa directo a Listo', async () => {
  for (const [i, serviceFocus] of ['takeaway', 'waiters'].entries()) {
    const id = `o-kkkkk${i + 1}`;
    uberOrders[id] = sample(id, { type: 'PICK_UP' });
    await hook(body('orders.notification', id));
    state.settings.t1 = { businessName: 'La Casa', serviceFocus };
    const r = await api.call('PUT', `/orders/${uberOrder(id).id}/external/accept`, { token: cashier() });
    delete state.settings.t1;
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, 'ready', serviceFocus);
    assert.equal(r.json.external.state, 'accepted');
  }
});

test('rechazar avisa a Uber con el motivo y cancela el pedido', async () => {
  uberOrders['o-bbbbb2'] = sample('o-bbbbb2');
  await hook(body('orders.notification', 'o-bbbbb2'));
  const o = uberOrder('o-bbbbb2');
  const r = await api.call('PUT', `/orders/${o.id}/external/deny`, { token: cashier(), body: { code: 'ITEM_AVAILABILITY', explanation: 'Sin leche' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 'cancelled');
  assert.equal(r.json.external.state, 'denied');
  const call = uberCalls.filter((c) => c.url.endsWith('/o-bbbbb2/deny_pos_order')).pop();
  assert.deepEqual(JSON.parse(call.body).reason, { code: 'ITEM_AVAILABILITY', explanation: 'Sin leche' });
});

test('un motivo desconocido se envía como OTHER', async () => {
  uberOrders['o-ccccc3'] = sample('o-ccccc3');
  await hook(body('orders.notification', 'o-ccccc3'));
  const o = uberOrder('o-ccccc3');
  await api.call('PUT', `/orders/${o.id}/external/deny`, { token: cashier(), body: { code: 'INVENTADO' } });
  const call = uberCalls.filter((c) => c.url.endsWith('/o-ccccc3/deny_pos_order')).pop();
  assert.equal(JSON.parse(call.body).reason.code, 'OTHER');
});

test('si Uber cancela el pedido, se cancela aquí', async () => {
  uberOrders['o-ddddd4'] = sample('o-ddddd4', { type: 'PICK_UP' });
  await hook(body('orders.notification', 'o-ddddd4'));
  assert.equal(uberOrder('o-ddddd4').modality, 'takeaway');
  assert.equal((await hook(body('orders.cancel', 'o-ddddd4'))).status, 200);
  assert.equal(uberOrder('o-ddddd4').status, 'cancelled');
  assert.equal(uberOrder('o-ddddd4').external.state, 'canceled_by_uber');
  // cancelar un pedido que no existe no es un error
  assert.equal((await hook(body('orders.cancel', 'o-fantasma'))).status, 200);
});

test('solo los pedidos de Uber en espera se pueden aceptar o rechazar', async () => {
  const local = { id: 'local-1', tenantId: 't1', status: 'pending', items: [] };
  state.orders.push(local);
  assert.equal((await api.call('PUT', '/orders/local-1/external/accept', { token: cashier() })).status, 400);
  assert.equal((await api.call('PUT', '/orders/nada/external/deny', { token: cashier() })).status, 404);
  uberOrders['o-eeeee5'] = sample('o-eeeee5');
  await hook(body('orders.notification', 'o-eeeee5'));
  // un mesero no responde a Uber
  assert.equal((await api.call('PUT', `/orders/${uberOrder('o-eeeee5').id}/external/accept`, { token: tokenFor('x', 'waiter', 't1') })).status, 403);
  // otro negocio no ve este pedido
  assert.equal((await api.call('PUT', `/orders/${uberOrder('o-eeeee5').id}/external/accept`, { token: tokenFor('beto', 'admin', 't2') })).status, 404);
});

const platformTotal = async () => (await api.call('GET', '/cash/session', { token: cashier() })).json.totals.platform;
const lastCall = (suffix) => uberCalls.filter((c) => c.url.endsWith(suffix)).pop();

test('las alergias y notas del cliente llegan al pedido, y al aceptar se avisa a Uber qué mostramos y cuándo estará listo', async () => {
  uberOrders['o-ggggg7'] = sample('o-ggggg7', {
    cart: {
      special_instructions: 'Tocar el timbre',
      items: [{
        title: 'Latte', quantity: 1, price: { unit_price: { amount: 4000 } },
        special_requests: [{ allergy: { allergens_to_exclude: [{ type: 'DAIRY' }, { type: 'OTHER', freeform_text: 'kiwi' }], allergy_instructions: 'sin trazas' } }],
      }],
    },
    packaging: { disposable_items: { should_include: false } },
  });
  await hook(body('orders.notification', 'o-ggggg7'));
  const o = uberOrder('o-ggggg7');
  assert.equal(o.external.allergy, true);
  assert.equal(o.items[0].notes, 'ALERGIA: lácteos, kiwi · sin trazas');
  assert.equal(o.notes, 'Tocar el timbre · Sin cubiertos');

  const antes = Date.now();
  const r = await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier(), body: { prepMinutes: 20 } });
  assert.equal(r.status, 200, r.text);
  const sent = JSON.parse(lastCall('/o-ggggg7/accept_pos_order').body);
  assert.deepEqual(sent.fields_relayed, { order_special_instructions: true, item_special_instructions: true, item_special_requests: true });
  assert.ok(Math.abs(sent.pickup_time * 1000 - (antes + 20 * 60_000)) < 10_000, 'listo en ~20 minutos');
  assert.ok(r.json.external.pickupAt);
});

test('cancelar un pedido aceptado: pide motivo, avisa a Uber y lo saca del cierre de caja', async () => {
  const o = uberOrder('o-ggggg7');
  const antes = await platformTotal();
  assert.equal((await api.call('PUT', `/orders/${o.id}/external/cancel`, { token: cashier(), body: { code: 'OTHER' } })).status, 400, 'OTHER pide detalle');
  assert.equal((await api.call('PUT', `/orders/${o.id}/external/cancel`, { token: tokenFor('x', 'waiter', 't1'), body: { code: 'OUT_OF_ITEMS' } })).status, 403);

  const r = await api.call('PUT', `/orders/${o.id}/external/cancel`, { token: cashier(), body: { code: 'OUT_OF_ITEMS' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.status, r.json.paymentStatus, r.json.external.state, r.json.external.cancelReason], ['cancelled', 'refunded', 'canceled', 'OUT_OF_ITEMS']);
  assert.deepEqual(JSON.parse(lastCall('/o-ggggg7/cancel').body), { reason: 'OUT_OF_ITEMS' });
  assert.equal(Number((antes - (await platformTotal())).toFixed(2)), o.total, 'el pedido ya no cuenta como cobrado');
  assert.equal((await api.call('PUT', `/orders/${o.id}/external/cancel`, { token: cashier(), body: { code: 'OUT_OF_ITEMS' } })).status, 400, 'ya terminó');

  // Un pedido sin aceptar no se cancela: se rechaza
  uberOrders['o-hhhhh8'] = sample('o-hhhhh8');
  await hook(body('orders.notification', 'o-hhhhh8'));
  assert.equal((await api.call('PUT', `/orders/${uberOrder('o-hhhhh8').id}/external/cancel`, { token: cashier(), body: { code: 'OUT_OF_ITEMS' } })).status, 400);
});

test('si Uber ya no permite cancelar, el pedido sigue igual', async () => {
  const o = uberOrder('o-hhhhh8');
  await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() });
  uberFails = 404;
  const r = await api.call('PUT', `/orders/${o.id}/external/cancel`, { token: cashier(), body: { code: 'KITCHEN_CLOSED' } });
  uberFails = null;
  assert.equal(r.status, 502);
  assert.match(r.text, /ya no permite/);
  assert.equal(uberOrder('o-hhhhh8').status !== 'cancelled', true);
  assert.equal(uberOrder('o-hhhhh8').paymentStatus, 'paid');
});

test('estado de entrega: solo pedidos que reparte el restaurante, con su propio permiso de Uber', async () => {
  // Uber reparte: no aplica
  assert.equal((await api.call('PUT', `/orders/${uberOrder('o-hhhhh8').id}/external/delivery`, { token: cashier(), body: { status: 'started' } })).status, 400);

  uberOrders['o-iiiii9'] = sample('o-iiiii9', { type: 'DELIVERY_BY_RESTAURANT' });
  await hook(body('orders.notification', 'o-iiiii9'));
  const o = uberOrder('o-iiiii9');
  assert.equal((await api.call('PUT', `/orders/${o.id}/external/delivery`, { token: cashier(), body: { status: 'started' } })).status, 400, 'primero hay que aceptarlo');
  await api.call('PUT', `/orders/${o.id}/external/accept`, { token: cashier() });

  assert.equal((await api.call('PUT', `/orders/${o.id}/external/delivery`, { token: cashier(), body: { status: 'volando' } })).status, 400);
  const started = await api.call('PUT', `/orders/${o.id}/external/delivery`, { token: cashier(), body: { status: 'started' } });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.external.deliveryStatus, 'started');
  assert.deepEqual(JSON.parse(lastCall('/o-iiiii9/restaurantdelivery/status').body), { status: 'started' });
  assert.ok(uberCalls.some((c) => c.url.includes('/oauth/v2/token') && c.body.includes('restaurantdelivery.status')), 'pidió el permiso aparte');

  const done = await api.call('PUT', `/orders/${o.id}/external/delivery`, { token: cashier(), body: { status: 'delivered' } });
  assert.deepEqual([done.status, done.json.status], [200, 'served']);
});

test('si Uber cancela un pedido que ya cobramos, deja de contar en la caja', async () => {
  uberOrders['o-jjjjj0'] = sample('o-jjjjj0');
  await hook(body('orders.notification', 'o-jjjjj0'));
  await api.call('PUT', `/orders/${uberOrder('o-jjjjj0').id}/external/accept`, { token: cashier() });
  const antes = await platformTotal();
  assert.equal((await hook(body('orders.cancel', 'o-jjjjj0'))).status, 200);
  const o = uberOrder('o-jjjjj0');
  assert.deepEqual([o.status, o.paymentStatus, o.external.state], ['cancelled', 'refunded', 'canceled_by_uber']);
  assert.equal(Number((antes - (await platformTotal())).toFixed(2)), o.total);
});

const storeCalls = () => uberCalls.filter((c) => c.method === 'POST' && /\/store\/[^/]+\/status$/.test(c.url));
const settle = () => new Promise((r) => setTimeout(r, 80)); // la caja no espera a Uber
const closeCash = () => api.call('POST', '/cash/session/close', { token: cashier(), body: { countedCash: 0 } });
const openCash = () => api.call('POST', '/cash/session/open', { token: cashier(), body: { openingFloat: 0 } });
const uberLinkDoc = () => state.integrations.find((i) => i.provider === 'uber' && i.tenantId === 't1');

test('estado de la tienda: se lee y se pausa a mano con su propio permiso de Uber', async () => {
  assert.equal((await api.call('GET', '/integrations/uber/store', { token: tokenFor('x', 'waiter', 't1') })).status, 403);
  const st = await api.call('GET', '/integrations/uber/store', { token: cashier() });
  assert.deepEqual([st.json.linked, st.json.status, st.json.autoPause], [true, 'ONLINE', true]);
  assert.equal((await api.call('GET', '/integrations/uber/store', { token: tokenFor('beto', 'admin', 't2') })).json.linked, false);

  assert.equal((await api.call('PUT', '/integrations/uber/store', { token: cashier(), body: { status: 'OFFLINE' } })).status, 400);
  assert.equal((await api.call('PUT', '/integrations/uber/store', { token: tokenFor('x', 'waiter', 't1'), body: { status: 'PAUSED' } })).status, 403);
  const antes = Date.now();
  const r = await api.call('PUT', '/integrations/uber/store', { token: cashier(), body: { status: 'PAUSED', minutes: 30 } });
  assert.equal(r.status, 200, r.text);
  const sent = JSON.parse(storeCalls().pop().body);
  assert.equal(sent.status, 'PAUSED');
  assert.match(sent.paused_until, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, 'formato que pide Uber');
  assert.ok(Math.abs(new Date(sent.paused_until) - (antes + 30 * 60_000)) < 10_000);
  assert.ok(uberCalls.some((c) => c.url.includes('/oauth/v2/token') && c.body.includes('eats.store.status.write')), 'pidió el permiso de escritura aparte');
  assert.equal((await api.call('GET', '/integrations/uber/store', { token: cashier() })).json.status, 'PAUSED');
  assert.equal((await api.call('PUT', '/integrations/uber/store', { token: cashier(), body: { status: 'ONLINE' } })).status, 200);
  assert.equal(storeState.status, 'ONLINE');
});

test('cerrar la caja pausa la tienda de Uber y abrirla la reanuda', async () => {
  const n = storeCalls().length;
  assert.equal((await closeCash()).status, 200);
  await settle();
  assert.deepEqual([storeCalls().length, storeState.status, uberLinkDoc().pausedByCash], [n + 1, 'PAUSED', true]);
  assert.equal(JSON.parse(storeCalls().pop().body).reason, 'Caja cerrada');
  assert.equal((await openCash()).status, 201);
  await settle();
  assert.deepEqual([storeCalls().length, storeState.status, uberLinkDoc().pausedByCash], [n + 2, 'ONLINE', false]);
});

test('no se pisa una pausa que no es nuestra, y se puede desactivar la pausa automática', async () => {
  // Ya estaba pausada (a mano, por Uber o fuera de horario): ni se pausa ni se reanuda sola
  storeState = { status: 'PAUSED' };
  let n = storeCalls().length;
  await closeCash(); await settle();
  assert.deepEqual([storeCalls().length, !!uberLinkDoc().pausedByCash], [n, false]);
  await openCash(); await settle();
  assert.equal(storeCalls().length, n);
  storeState = { status: 'ONLINE' };

  // Pausa manual después de cerrar: abrir la caja no la deshace
  await closeCash(); await settle();
  assert.equal(uberLinkDoc().pausedByCash, true);
  await api.call('PUT', '/integrations/uber/store', { token: cashier(), body: { status: 'PAUSED', minutes: 60 } });
  assert.equal(uberLinkDoc().pausedByCash, false);
  n = storeCalls().length;
  await openCash(); await settle();
  assert.equal(storeCalls().length, n, 'la pausa manual se respeta');
  await api.call('PUT', '/integrations/uber/store', { token: cashier(), body: { status: 'ONLINE' } });

  // Desactivada: la caja no toca la tienda
  assert.equal((await api.call('PUT', '/integrations/uber/autopause', { token: cashier(), body: { autoPause: false } })).status, 403);
  assert.equal((await api.call('PUT', '/integrations/uber/autopause', { token: admin(), body: { autoPause: 'no' } })).status, 400);
  assert.equal((await api.call('PUT', '/integrations/uber/autopause', { token: admin(), body: { autoPause: false } })).status, 200);
  assert.equal((await api.call('GET', '/integrations/uber', { token: admin() })).json.autoPause, false);
  n = storeCalls().length;
  await closeCash(); await settle();
  await openCash(); await settle();
  assert.equal(storeCalls().length, n);
  await api.call('PUT', '/integrations/uber/autopause', { token: admin(), body: { autoPause: true } });
});

test('si Uber falla, la caja abre y cierra igual', async () => {
  storeState = { status: 'ONLINE' };
  uberFails = 500;
  const closed = await closeCash();
  await settle();
  uberFails = null;
  assert.equal(closed.status, 200, closed.text);
  assert.equal(!!uberLinkDoc().pausedByCash, false, 'no se anotó una pausa que no ocurrió');
  assert.equal((await openCash()).status, 201);
});

const events = () => state.uberEvents || [];

test('la bitácora guarda cada aviso con su resultado y los errores al hablar con Uber', async () => {
  uberOrders['o-lllll1'] = sample('o-lllll1');
  await hook(body('orders.notification', 'o-lllll1'));
  await hook(body('orders.notification', 'o-lllll1')); // reintento
  await hook(body('orders.notification', 'o-lllll1', 'tienda-desconocida'));
  await hook(JSON.stringify({ event_type: 'orders.release', meta: { resource_id: 'x', user_id: STORE } }));
  await hook(body('orders.notification', 'o-sin-detalle')); // Uber no lo conoce: falla y Uber reintentará
  const last = events().slice(-5).map((e) => [e.eventType, e.outcome, e.detail || '']);
  assert.deepEqual(last[0], ['orders.notification', 'ok', '']);
  assert.deepEqual(last[1], ['orders.notification', 'ignored', 'repetido']);
  assert.deepEqual(last[2], ['orders.notification', 'ignored', 'tienda sin vincular']);
  assert.deepEqual(last[3], ['orders.release', 'ignored', 'evento no atendido']);
  assert.equal(last[4][1], 'error');
  assert.equal(events().find((e) => e.orderId === 'o-lllll1' && e.outcome === 'ok').tenantId, 't1');

  // Una acción que falla contra Uber también queda anotada
  uberFails = 500;
  await api.call('PUT', `/orders/${uberOrder('o-lllll1').id}/external/accept`, { token: cashier() });
  uberFails = null;
  assert.equal(events().pop().eventType, 'api.accept');
});

test('tasa de aceptación: aceptados entre decididos; lo pendiente aún no cuenta', async () => {
  const uberSvc = require('../services/uber.service');
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60_000);
  const r = uberSvc.acceptanceStats([
    { id: '1', external: { acceptedAt: ago(5), state: 'accepted' } },
    { id: '2', external: { acceptedAt: ago(5), state: 'canceled_by_uber' } }, // aceptado y luego cancelado: cuenta como aceptado
    { id: '3', external: { state: 'denied' } },
    { id: '4', external: { state: 'awaiting', deadline: new Date(now + 60_000) } },
    { id: '5', external: { state: 'awaiting', deadline: ago(1), displayId: 'AAAAA', receivedAt: ago(13) } },
    { id: '6', external: { state: 'canceled_by_uber', displayId: 'BBBBB', receivedAt: ago(30) } },
  ], now);
  assert.deepEqual([r.received, r.accepted, r.denied, r.pending, r.missed, r.rate], [6, 2, 1, 1, 2, 0.4]);
  assert.deepEqual(r.missedOrders.map((o) => [o.displayId, o.reason]), [['AAAAA', 'sin respuesta'], ['BBBBB', 'cancelado por Uber']]);
  assert.equal(uberSvc.acceptanceStats([]).rate, null, 'sin pedidos no hay tasa');

  const api1 = await api.call('GET', '/integrations/uber/metrics', { token: cashier() });
  const mine = state.orders.filter((o) => o.source === 'uber' && o.tenantId === 't1');
  assert.equal(api1.status, 200, api1.text);
  assert.deepEqual([api1.json.days, api1.json.received], [7, mine.length]);
  assert.equal(api1.json.accepted + api1.json.denied + api1.json.missed + api1.json.pending, api1.json.received);
  assert.equal((await api.call('GET', '/integrations/uber/metrics?days=30', { token: cashier() })).json.days, 30);
  assert.equal((await api.call('GET', '/integrations/uber/metrics?days=999', { token: cashier() })).json.days, 7);
  assert.equal((await api.call('GET', '/integrations/uber/metrics', { token: tokenFor('x', 'waiter', 't1') })).status, 403);
  assert.equal((await api.call('GET', '/integrations/uber/metrics', { token: tokenFor('beto', 'admin', 't2') })).json.received, 0, 'cada negocio ve lo suyo');
});

test('revisar pedidos: trae los que el aviso no entregó y cierra los que Uber ya canceló', async () => {
  // Uber tiene un pedido sin atender que nunca nos avisó
  uberOrders['o-mmmmm1'] = sample('o-mmmmm1');
  createdOrders = ['o-mmmmm1'];
  const r = await api.call('POST', '/integrations/uber/reconcile', { token: cashier() });
  assert.deepEqual([r.status, r.json.recovered], [200, 1]);
  assert.equal(uberOrder('o-mmmmm1').external.state, 'awaiting');
  assert.equal((await api.call('POST', '/integrations/uber/reconcile', { token: cashier() })).json.recovered, 0, 'no se duplica');
  assert.ok(events().some((e) => e.eventType === 'recuperado' && e.orderId === 'o-mmmmm1'));

  // Seguimos esperando un pedido que Uber ya canceló (se acabó el tiempo)
  createdOrders = [];
  uberOrders['o-mmmmm2'] = sample('o-mmmmm2');
  await hook(body('orders.notification', 'o-mmmmm2'));
  uberOrders['o-mmmmm2'] = { ...uberOrders['o-mmmmm2'], current_state: 'CANCELED' };
  const r2 = await api.call('POST', '/integrations/uber/reconcile', { token: cashier() });
  assert.equal(r2.json.closed, 1);
  assert.deepEqual([uberOrder('o-mmmmm2').status, uberOrder('o-mmmmm2').external.state], ['cancelled', 'canceled_by_uber']);

  // Uber falla: se avisa y queda anotado
  createdOrders = null;
  assert.equal((await api.call('POST', '/integrations/uber/reconcile', { token: cashier() })).status, 502);
  assert.equal(events().pop().eventType, 'api.reconcile');
  createdOrders = [];
  assert.equal((await api.call('POST', '/integrations/uber/reconcile', { token: tokenFor('x', 'waiter', 't1') })).status, 403);
});

test('al abrir la caja se revisan los pedidos perdidos, sin esperar', async () => {
  uberOrders['o-mmmmm3'] = sample('o-mmmmm3');
  createdOrders = ['o-mmmmm3'];
  await closeCash();
  await openCash();
  await settle();
  await settle();
  assert.ok(uberOrder('o-mmmmm3'), 'el pedido perdido apareció solo');
  createdOrders = [];
});

test('plataforma: tasa por negocio, peores primero, y lo que ha fallado', async () => {
  const platformAdmin = tokenFor('root', 'platform_admin', null);
  assert.equal((await api.call('GET', '/platform/uber', { token: tokenFor('ayuda', 'platform_support', null) })).status, 403);
  assert.equal((await api.call('GET', '/platform/uber', { token: cashier() })).status, 403);
  const r = await api.call('GET', '/platform/uber?days=30', { token: platformAdmin });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.days, 30);
  assert.equal(r.json.totals.received, state.orders.filter((o) => o.source === 'uber').length);
  assert.equal(r.json.totals.missedOrders, undefined, 'el detalle de pedidos es del negocio');
  const t1 = r.json.tenants.find((t) => t.tenantId === 't1');
  assert.deepEqual([t1.name, t1.storeId], ['T1', STORE]);
  assert.ok(r.json.events.some((e) => e.outcome === 'error'));
  assert.ok(r.json.events.every((e) => e.at && e.eventType));
});

const uberMenuSvc = require('../services/uber.menu.service');
const putMenus = () => uberCalls.filter((c) => c.method === 'PUT' && /\/menus$/.test(c.url));
const itemCalls = () => uberCalls.filter((c) => /\/menus\/items\//.test(c.url));

test('el menú se traduce al formato de Uber: centavos, IVA aparte, extras y agotados', () => {
  const now = 1_000_000_000_000;
  const { body, outIds } = uberMenuSvc.buildMenu({
    foods: [
      { id: 'f1', name: 'Latte', price: 40.5, menuId: 'm1', description: 'Café', imgUrl: 'https://x.test/l.jpg', recipe: [{ ingredientId: 'leche', quantity: 200 }],
        extras: [{ ingredientId: 'sirope', label: 'Sirope', amount: 1, price: 8, max: 3 }, { ingredientId: 'azucar', label: 'Azúcar', amount: 1, price: 0, max: 2 }] },
      { id: 'f2', name: 'Pan', price: 35, menuId: 'm1', imgUrl: 'data:image/png;base64,AA' },
      { id: 'f3', name: 'Huérfano', price: 10, menuId: 'otra' },
    ],
    menus: [{ id: 'm1', name: 'Bebidas' }, { id: 'vacia', name: 'Vacía' }],
    ingredients: [{ id: 'leche', stock: 0 }, { id: 'sirope', stock: 5 }, { id: 'azucar', stock: 0 }],
    title: 'Café ZZ', open: '08:00', close: '22:00', now,
  });
  assert.deepEqual(body.categories.map((c) => c.id), ['m1'], 'sin categorías vacías ni productos sin categoría');
  const item = (id) => body.items.find((i) => i.id === id);
  assert.deepEqual(body.items.map((i) => i.id), ['f1', 'f1_sirope', 'f1_azucar', 'f2']);
  assert.deepEqual([item('f1').price_info.price, item('f1').tax_info.tax_rate], [4050, 8], 'centavos y el IVA se suma');
  assert.ok(item('f1').image_url && !item('f2').image_url, 'solo imágenes con dirección https');
  assert.equal(item('f1').description.translations.es_mx, 'Café');
  assert.deepEqual(item('f1').modifier_group_ids, { ids: ['f1_extras'] });
  assert.deepEqual(body.modifier_groups[0].modifier_options.map((o) => o.id), ['f1_sirope', 'f1_azucar']);
  assert.equal(body.modifier_groups[0].quantity_info.quantity.max_permitted, 5);
  assert.deepEqual([item('f1_sirope').price_info.price, item('f1_sirope').quantity_info.quantity.max_permitted], [800, 3]);
  // Agotados: el producto con receta sin leche y el extra sin azúcar
  assert.deepEqual([...outIds].sort(), ['f1', 'f1_azucar']);
  assert.deepEqual(item('f1').suspension_info.suspension, { suspend_until: now / 1000 + 24 * 3600, reason: 'Agotado' });
  assert.ok(!item('f1_sirope').suspension_info && !item('f2').suspension_info);
  const m = body.menus[0];
  assert.deepEqual([m.category_ids, m.service_availability.length, m.service_availability[0].time_periods[0]], [['m1'], 7, { start_time: '08:00', end_time: '22:00' }]);
  assert.equal(m.title.translations.es_mx, 'Café ZZ');
});

test('publicar el menú: solo el administrador, horario válido, va comprimido y se guarda qué se subió', async () => {
  state.menus.push({ id: 'm1', name: 'Bebidas', tenantId: 't1' });
  state.ingredients.push(
    { id: 'i-leche', tenantId: 't1', name: 'Leche', unit: 'ml', stock: 0, minStock: 0 },
    { id: 'i-sirope', tenantId: 't1', name: 'Sirope', unit: 'pump', stock: 20, minStock: 0 },
  );
  Object.assign(state.foods.find((f) => f.id === 'f-latte'), { menuId: 'm1', recipe: [{ ingredientId: 'i-leche', quantity: 200 }], extras: [{ ingredientId: 'i-sirope', label: 'Sirope', amount: 1, price: 8, max: 3 }] });

  assert.equal((await api.call('POST', '/integrations/uber/menu', { token: cashier(), body: {} })).status, 403);
  assert.equal((await api.call('POST', '/integrations/uber/menu', { token: admin(), body: { open: '8am', close: '22:00' } })).status, 400);
  assert.equal((await api.call('POST', '/integrations/uber/menu', { token: admin(), body: { open: '09:00', close: '09:30' } })).status, 400, 'más de una hora seguida');
  assert.equal((await api.call('POST', '/integrations/uber/menu', { token: tokenFor('beto', 'admin', 't2'), body: {} })).status, 400, 'sin tienda vinculada');

  const r = await api.call('POST', '/integrations/uber/menu', { token: admin(), body: { open: '08:00', close: '22:00' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.categories, r.json.outOfStock], [1, 1]);
  const call = putMenus().pop();
  assert.equal(call.headers['Content-Encoding'], 'gzip');
  assert.ok(call.url.startsWith('https://test-api.uber.com/v2/eats/stores/'));
  const sent = JSON.parse(call.body);
  assert.ok(sent.items.find((i) => i.id === 'f-latte').suspension_info, 'sin leche: sube ya agotado');
  assert.ok(uberCalls.some((c) => c.url.includes('/oauth/v2/token') && c.body.includes('eats.store')));
  assert.ok(uberLinkDoc().menuPublishedAt);
  assert.ok(uberLinkDoc().suspendedIds.includes('f-latte'));
  assert.ok(uberLinkDoc().publishedItemIds.includes('f-latte_i-sirope'));

  const st = await api.call('GET', '/integrations/uber/menu', { token: cashier() });
  assert.deepEqual([st.json.published, st.json.outOfStock, st.json.hours], [true, ['Latte'], { open: '08:00', close: '22:00' }]);
});

test('al reponer o agotar un ingrediente, Uber se entera solo y solo de lo que cambió', async () => {
  const calls = () => itemCalls().filter((c) => c.url.includes('/items/f-latte')).length;
  let n = calls();
  const stock = (type, quantity) => api.call('POST', '/ingredients/i-leche/stock', { token: admin(), body: { type, quantity } });

  assert.equal((await stock('restock', 1000)).status, 200);
  await settle();
  assert.equal(calls(), n + 1);
  assert.equal(JSON.parse(itemCalls().pop().body).suspension_info.suspension.suspend_until, null, 'se reanuda');
  assert.equal(uberLinkDoc().suspendedIds.includes('f-latte'), false);

  n = calls();
  await stock('waste', 1000);
  await settle();
  assert.equal(calls(), n + 1);
  const sent = JSON.parse(itemCalls().pop().body).suspension_info.suspension;
  assert.deepEqual([sent.reason, sent.suspend_until > Date.now() / 1000], ['Agotado', true]);

  n = calls();
  await stock('waste', 1); // sigue agotado: Uber no necesita otro aviso
  await settle();
  assert.equal(calls(), n);

  // Al abrir la caja se renueva (el agotado vence a las 24 h)
  await closeCash();
  await openCash();
  await settle();
  await settle();
  assert.equal(calls(), n + 1);
  assert.equal(uberLinkDoc().suspendedIds.includes('f-latte'), true);
});

test('Uber pide el menú otra vez: se vuelve a publicar solo si el negocio ya lo publicó', async () => {
  const n = putMenus().length;
  const refresh = (store) => hook(JSON.stringify({ event_type: 'store.menu_refresh_request', store_id: store, partner_store_id: 'x', webhook_meta: {} }));
  assert.equal((await refresh(STORE)).status, 200);
  assert.equal(putMenus().length, n + 1);
  assert.equal(events().at(-1).detail, 'menú publicado de nuevo');

  assert.equal((await refresh('tienda-ajena')).status, 200);
  assert.equal(putMenus().length, n + 1);
  assert.equal(events().at(-1).detail, 'tienda sin vincular');
});

test('si Uber rechaza el menú se dice por qué y no se marca como publicado', async () => {
  const before = uberLinkDoc().menuPublishedAt;
  uberFails = 400;
  const r = await api.call('POST', '/integrations/uber/menu', { token: admin(), body: {} });
  uberFails = null;
  assert.equal(r.status, 502);
  assert.match(r.text, /precio inválido/);
  assert.equal(uberLinkDoc().menuPublishedAt, before);
  assert.equal(events().at(-1).eventType, 'api.menu');
});

test('los extras que elige el cliente en Uber descuentan su ingrediente, y el producto se reconoce por el id del menú', async () => {
  const stock = (id) => state.ingredients.find((i) => i.id === id).stock;
  const [sirope0, leche0] = [stock('i-sirope'), stock('i-leche')];
  uberOrders['o-nnnnn1'] = sample('o-nnnnn1', {
    cart: { items: [{
      id: 'f-latte', title: 'Café con leche', quantity: 2, price: { unit_price: { amount: 4000 } },
      selected_modifier_groups: [{ selected_items: [{ id: 'f-latte_i-sirope', title: 'Sirope', quantity: 2 }, { id: 'ajeno_x', title: 'Otro', quantity: 1 }] }],
    }] },
  });
  await hook(body('orders.notification', 'o-nnnnn1'));
  const o = uberOrder('o-nnnnn1');
  assert.equal(o.items[0].foodId, 'f-latte', 'por id, aunque el título sea otro');
  assert.deepEqual(o.items[0].options.map((x) => [x.ingredientId, x.quantity, x.amount]), [['i-sirope', 2, 1]], 'solo los extras que reconocemos');
  // 2 cafés × (2 siropes) = 4 siropes; la receta base gasta 200 de leche por café
  assert.equal(sirope0 - stock('i-sirope'), 4);
  assert.equal(leche0 - stock('i-leche'), 400);
  assert.deepEqual(o.stockLines.map((l) => l.ingredientId).sort(), ['i-leche', 'i-sirope']);
});

test('el menú se publica de nuevo solo cuando cambia un producto, y se puede apagar', async () => {
  const n = () => putMenus().length;
  const price = (v) => api.call('PUT', '/foods/f-latte', { token: admin(), body: { price: v } });
  const sentPrice = () => JSON.parse(putMenus().pop().body).items.find((i) => i.id === 'f-latte').price_info.price;

  let before = n();
  assert.equal((await price(45)).status, 200);
  await settle();
  assert.equal(n(), before + 1);
  assert.equal(sentPrice(), 4500);
  assert.equal(uberLinkDoc().menuDirty, false);

  // Varios cambios seguidos: lo último llega a Uber sin una subida por cada uno
  before = n();
  await price(46);
  await price(47);
  await price(48);
  await settle(); await settle();
  assert.ok(n() - before >= 1 && n() - before <= 3);
  assert.equal(sentPrice(), 4800);

  // Una categoría nueva también cuenta
  before = n();
  assert.equal((await api.call('POST', '/menus', { token: admin(), body: { name: 'Postres' } })).status, 201);
  await settle();
  assert.equal(n(), before + 1);

  // Si Uber falla, queda anotado y se sube al abrir la caja
  before = n();
  uberFails = 500;
  await price(49);
  await settle();
  uberFails = null;
  assert.equal(uberLinkDoc().menuDirty, true);
  assert.equal(n(), before + 1, 'lo intentó una vez');
  await closeCash();
  await openCash();
  await settle(); await settle();
  assert.equal(n(), before + 2);
  assert.equal(sentPrice(), 4900);
  assert.equal(uberLinkDoc().menuDirty, false);

  // Apagado: se anota que hay cambios, pero no se sube solo
  assert.equal((await api.call('PUT', '/integrations/uber/menu/auto', { token: cashier(), body: { autoPublish: false } })).status, 403);
  assert.equal((await api.call('PUT', '/integrations/uber/menu/auto', { token: admin(), body: { autoPublish: 'no' } })).status, 400);
  assert.equal((await api.call('PUT', '/integrations/uber/menu/auto', { token: admin(), body: { autoPublish: false } })).status, 200);
  before = n();
  await price(50);
  await settle();
  assert.equal(n(), before);
  const st = (await api.call('GET', '/integrations/uber/menu', { token: cashier() })).json;
  assert.deepEqual([st.dirty, st.autoPublish], [true, false]);
  assert.equal((await api.call('POST', '/integrations/uber/menu', { token: admin(), body: {} })).status, 200);
  assert.equal((await api.call('GET', '/integrations/uber/menu', { token: cashier() })).json.dirty, false);
  await api.call('PUT', '/integrations/uber/menu/auto', { token: admin(), body: { autoPublish: true } });
});

test('revisión periódica: la corre un reloj externo con su clave y solo mira tiendas con la caja abierta', async () => {
  process.env.CRON_SECRET = 'reloj-secreto';
  const sweep = (auth) => realFetch(`${api.base}/integrations/uber/sweep`, { headers: auth ? { Authorization: auth } : {} });
  delete process.env.CRON_SECRET;
  assert.equal((await sweep('Bearer reloj-secreto')).status, 503, 'sin CRON_SECRET en el servidor');
  process.env.CRON_SECRET = 'reloj-secreto';
  assert.equal((await sweep()).status, 401);
  assert.equal((await sweep('Bearer otra')).status, 401);

  uberOrders['o-ooooo1'] = sample('o-ooooo1');
  createdOrders = ['o-ooooo1']; // Uber lo tiene pendiente y nunca avisó
  const r = await sweep('Bearer reloj-secreto');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { checked: 1, recovered: 1, closed: 0 });
  assert.ok(uberOrder('o-ooooo1'));

  await closeCash();
  uberOrders['o-ooooo2'] = sample('o-ooooo2');
  createdOrders = ['o-ooooo2'];
  assert.deepEqual(await (await sweep('Bearer reloj-secreto')).json(), { checked: 0, recovered: 0, closed: 0 }, 'sin caja abierta no mira');
  assert.equal(uberOrder('o-ooooo2'), undefined);
  createdOrders = [];
  await openCash();
  await settle(); await settle();
  delete process.env.CRON_SECRET;
});

test('pedidos programados: se guardan marcados y con la hora de recogida que dice Uber', async () => {
  uberOrders['o-ppppp1'] = sample('o-ppppp1', { estimated_ready_for_pickup_at: '2026-11-17T18:30:00Z' });
  await hook(JSON.stringify({ event_type: 'orders.scheduled.notification', event_id: 'ev-p1', meta: { resource_id: 'o-ppppp1', user_id: STORE, status: 'pos' } }));
  const o = uberOrder('o-ppppp1');
  assert.equal(o.external.scheduled, true);
  assert.equal(new Date(o.external.readyAt).toISOString(), '2026-11-17T18:30:00.000Z');
  assert.equal(o.external.state, 'awaiting');
  assert.equal(events().at(-1).outcome, 'ok');

  uberOrders['o-ppppp2'] = sample('o-ppppp2');
  await hook(body('orders.notification', 'o-ppppp2'));
  assert.deepEqual([uberOrder('o-ppppp2').external.scheduled, uberOrder('o-ppppp2').external.readyAt], [false, null]);
});

test('tiempo de preparación de la tienda: se lee de Uber y se cambia (la ruta de cambio no está confirmada por Uber)', async () => {
  assert.equal((await api.call('GET', '/integrations/uber/prep', { token: tokenFor('x', 'waiter', 't1') })).status, 403);
  assert.equal((await api.call('GET', '/integrations/uber/prep', { token: tokenFor('beto', 'admin', 't2') })).json.linked, false);
  assert.deepEqual((await api.call('GET', '/integrations/uber/prep', { token: cashier() })).json, { linked: true, prepMinutes: 15 });

  for (const bad of [0, 181, 'x', 1.5]) assert.equal((await api.call('PUT', '/integrations/uber/prep', { token: cashier(), body: { minutes: bad } })).status, 400, String(bad));
  const r = await api.call('PUT', '/integrations/uber/prep', { token: cashier(), body: { minutes: 20 } });
  assert.deepEqual([r.status, r.json.prepMinutes], [200, 20]);
  const sent = uberCalls.filter((c) => /update-store-prep-time$/.test(c.url)).pop();
  assert.deepEqual([sent.method, JSON.parse(sent.body)], ['POST', { default_prep_time: 1200 }]);
  assert.equal(uberLinkDoc().prepMinutes, 20);

  prepFails = true;
  const fail = await api.call('PUT', '/integrations/uber/prep', { token: cashier(), body: { minutes: 25 } });
  prepFails = false;
  assert.equal(fail.status, 502);
  assert.match(fail.text, /Uber Eats Manager/);
  assert.equal(events().at(-1).eventType, 'api.prep');
  assert.equal(uberLinkDoc().prepMinutes, 20, 'no se anota lo que Uber no aceptó');

  storeAvgPrep = null; // Uber no responde: se muestra lo último que guardamos
  const down = await api.call('GET', '/integrations/uber/prep', { token: cashier() });
  storeAvgPrep = 15;
  assert.deepEqual([down.json.prepMinutes, !!down.json.error], [20, true]);
});

test('sin credenciales de Uber el webhook responde 503', async () => {
  const id = process.env.UBER_EATS_CLIENT_ID;
  delete process.env.UBER_EATS_CLIENT_ID;
  assert.equal((await hook(body('orders.notification', 'o-x'))).status, 503);
  process.env.UBER_EATS_CLIENT_ID = id;
});

test('desvincular la tienda deja de recibir sus pedidos', async () => {
  assert.equal((await api.call('DELETE', '/integrations/uber', { token: admin() })).status, 200);
  uberOrders['o-fffff6'] = sample('o-fffff6');
  assert.equal((await hook(body('orders.notification', 'o-fffff6'))).status, 200);
  assert.equal(uberOrder('o-fffff6'), undefined);
});
