// Uber Eats: webhook firmado, pedido guardado una sola vez, aceptar/rechazar y vínculo de tienda por negocio.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

// Los pedidos a la API local pasan; todo lo de Uber se simula.
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  uberCalls.push({ url: u, method: opts.method || 'GET', body: opts.body ? String(opts.body) : null });
  const json = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  if (u.includes('/oauth/v2/token')) return json(200, { access_token: 'tk', expires_in: 2592000 });
  const m = u.match(/\/v2\/eats\/order\/([^/?]+)/);
  if (m) return uberOrders[m[1]] ? json(200, uberOrders[m[1]]) : json(404, {});
  if (/accept_pos_order|deny_pos_order/.test(u)) return uberFails ? json(uberFails, {}) : json(204);
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
