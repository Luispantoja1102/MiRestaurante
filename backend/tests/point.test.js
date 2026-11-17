// Terminal Mercado Pago Point: conexión OAuth por negocio, cobro en terminal y venta que lo consume una sola vez.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');

Object.assign(process.env, {
  MP_CLIENT_ID: 'cid',
  MP_CLIENT_SECRET: 'csecret',
  MP_OAUTH_REDIRECT: 'http://localhost:8081/point/oauth/callback',
  OAUTH_STATE_SECRET: 'estado-secreto',
  TOKEN_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  MP_WEBHOOK_SECRET: 'webhook-secreto',
  APP_URL: 'http://app.test',
});

const { app, state, tokenFor } = loadApp();
let api;
const realFetch = global.fetch;
const mpCalls = [];
let mpOrder = { status: 'created', payment: null }; // lo que Mercado Pago responde del cobro

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  mpCalls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const json = (status, data) => new Response(JSON.stringify(data), { status });
  if (u.endsWith('/oauth/token')) return json(200, { access_token: 'AT-secreto', refresh_token: 'RT-secreto', user_id: 99, expires_in: 15552000 });
  if (u.includes('/terminals/v1/list')) return json(200, { data: { terminals: [{ id: 'T1', external_pos_id: 'CAJA1', operating_mode: 'STANDALONE' }, { id: 'T2', external_pos_id: 'CAJA2', operating_mode: 'PDV' }] } });
  if (u.includes('/terminals/v1/setup')) return json(200, {});
  if (u.endsWith('/v1/orders')) return json(201, { id: `ord${mpCalls.length}`, status: 'created' });
  if (/\/v1\/orders\/[^/]+\/cancel$/.test(u)) return json(200, {});
  if (/\/v1\/orders\/[^/]+$/.test(u)) return json(200, { status: mpOrder.status, transactions: { payments: mpOrder.payment ? [mpOrder.payment] : [] } });
  return json(500, {});
};

test.before(async () => {
  api = await startServer(app);
  state.users.push(
    { _id: new ObjectId(), name: 'Ana', lastName: 'D', username: 'ana', email: 'ana@t1.com', password: 'x', role: 'admin', tenantId: 't1' },
  );
  state.foods.push({ id: 'f-latte', name: 'Latte', price: 40, tenantId: 't1' });
  state.cash.push({ id: 'c1', tenantId: 't1', status: 'open' });
});
test.after(async () => { await api.close(); global.fetch = realFetch; });

const admin = () => tokenFor('ana', 'admin', 't1');
const cashier = () => tokenFor('caro', 'cashier', 't1');
const TOTAL = 43.2; // un Latte de $40 con IVA
const paid = (amount) => ({ status: 'processed', payment: { id: 'p1', status: 'processed', paid_amount: String(amount) } });
const charge = (clientSaleId, amount = TOTAL) => api.call('POST', '/point/charges', { token: cashier(), body: { clientSaleId, amount } });
const counter = (over = {}) => api.call('POST', '/orders/counter', { token: cashier(), body: { items: [{ foodId: 'f-latte', quantity: 1 }], paymentMethod: 'card', ...over } });

test('conectar la cuenta es cosa del administrador y el state vuelve firmado', async () => {
  assert.equal((await api.call('GET', '/point/connect', { token: cashier() })).status, 403);
  const r = await api.call('GET', '/point/connect', { token: admin() });
  assert.equal(r.status, 200, r.text);
  const url = new URL(r.json.url);
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), process.env.MP_OAUTH_REDIRECT);

  const cb = (state) => realFetch(`${api.base}/point/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  const mala = await cb('t1.x.firmafalsa');
  assert.match(mala.headers.get('location'), /mp=error&reason=state/);
  assert.equal(state.pointConns, undefined, 'nada se guardó');

  const ok = await cb(url.searchParams.get('state'));
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), 'http://app.test/settings?s=terminal&mp=ok');
  const saved = state.pointConns.find((c) => c.tenantId === 't1');
  assert.ok(saved.accessToken && !saved.accessToken.includes('AT-secreto'), 'el token se guarda cifrado');
});

test('el estado pide elegir terminal y nunca devuelve tokens', async () => {
  const r = await api.call('GET', '/point/status', { token: cashier() });
  assert.equal(r.status, 200);
  assert.equal(r.json.code, 'no_terminal');
  assert.equal(r.json.connected, true);
  assert.doesNotMatch(r.text, /secreto|accessToken/);
  assert.equal((await charge('s0')).status, 409);
});

test('elegir terminal: solo administrador, y debe ser de su cuenta', async () => {
  assert.equal((await api.call('POST', '/point/terminal', { token: cashier(), body: { terminalId: 'T1' } })).status, 403);
  assert.equal((await api.call('POST', '/point/terminal', { token: admin(), body: { terminalId: 'OTRA' } })).status, 404);
  assert.equal((await api.call('POST', '/point/terminal', { token: admin(), body: { terminalId: 'T1' } })).status, 200);
  assert.ok(mpCalls.some((c) => c.method === 'PATCH' && c.body.terminals[0].operating_mode === 'PDV'), 'la terminal pasa a modo PDV');
  const st = await api.call('GET', '/point/status', { token: cashier() });
  assert.deepEqual([st.json.ok, st.json.terminalLabel], [true, 'CAJA1']);
});

test('una venta con tarjeta consume el cobro aprobado, y solo una vez', async () => {
  const c = await charge('venta-1');
  assert.equal(c.status, 201, c.text);
  const body = mpCalls.filter((x) => x.url.endsWith('/v1/orders') && x.method === 'POST').pop().body;
  assert.deepEqual([body.type, body.config.point.terminal_id, body.transactions.payments[0].amount], ['point', 'T1', '43.20']);

  mpOrder = { status: 'created', payment: null };
  assert.equal((await api.call('GET', `/point/charges/${c.json.id}`, { token: cashier() })).json.status, 'pending');
  assert.equal((await counter({ pointChargeId: c.json.id })).status, 409, 'aún no está aprobado');

  mpOrder = paid(TOTAL);
  assert.equal((await api.call('GET', `/point/charges/${c.json.id}`, { token: cashier() })).json.status, 'paid');
  const sale = await counter({ pointChargeId: c.json.id, clientRef: 'ref-1' });
  assert.equal(sale.status, 201, sale.text);
  assert.equal(sale.json.paymentMethod, 'card');
  assert.equal(sale.json.pointChargeId, c.json.id);

  const otra = await counter({ pointChargeId: c.json.id, clientRef: 'ref-2' });
  assert.equal(otra.status, 409);
  assert.match(otra.text, /ya se usó/);
});

test('el monto del cobro debe coincidir y solo vale para tarjeta', async () => {
  mpOrder = paid(10);
  const c = await charge('venta-2', 10);
  await api.call('GET', `/point/charges/${c.json.id}`, { token: cashier() });
  const r = await counter({ pointChargeId: c.json.id });
  assert.equal(r.status, 409);
  assert.match(r.text, /no coincide/);
  assert.equal((await counter({ pointChargeId: c.json.id, paymentMethod: 'cash' })).status, 400);
});

test('cobrar un pedido ya creado con el cobro de la terminal', async () => {
  const order = { id: 'o-mesa', tenantId: 't1', total: TOTAL, paymentStatus: 'unpaid', status: 'pending', channel: 'local' };
  state.orders.push(order);
  mpOrder = paid(TOTAL);
  const c = await charge('o-mesa');
  await api.call('GET', `/point/charges/${c.json.id}`, { token: cashier() });
  const r = await api.call('PUT', '/orders/o-mesa/pay', { token: cashier(), body: { paymentMethod: 'card', pointChargeId: c.json.id } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.paymentStatus, 'paid');
  assert.equal(r.json.pointChargeId, c.json.id);
});

test('tarjeta sin terminal sigue funcionando a mano', async () => {
  const r = await counter({ clientRef: 'ref-manual' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.pointChargeId, undefined);
});

test('varias terminales: cada una con su nombre, y el cobro dice en cuál se hace', async () => {
  const put = (id, name) => api.call('PUT', `/point/terminals/${id}`, { token: admin(), body: { name } });
  // la primera se bautiza y se agrega una segunda
  assert.equal((await put('T1', 'Barra')).status, 200);
  assert.equal((await api.call('POST', '/point/terminal', { token: admin(), body: { terminalId: 'T2', name: 'barra' } })).status, 409, 'nombre repetido');
  assert.equal((await api.call('POST', '/point/terminal', { token: admin(), body: { terminalId: 'T2', name: 'Terraza' } })).status, 200);
  assert.equal((await put('T2', '  ')).status, 400);
  assert.equal((await put('NOPE', 'X')).status, 404);
  assert.equal((await put('T1', 'Barra')).status, 200, 'su propio nombre no cuenta como repetido');

  const st = (await api.call('GET', '/point/status', { token: cashier() })).json;
  assert.deepEqual(st.terminals.map((t) => [t.id, t.name, t.ok]), [['T1', 'Barra', true], ['T2', 'Terraza', true]]);
  assert.doesNotMatch(JSON.stringify(st), /secreto|accessToken/);

  // con dos terminales hay que elegir; con una que no existe, también falla
  const sale = (extra) => api.call('POST', '/point/charges', { token: cashier(), body: { amount: TOTAL, ...extra } });
  const sinElegir = await sale({ clientSaleId: 'multi-0' });
  assert.deepEqual([sinElegir.status, sinElegir.json.code], [400, 'terminal_required']);
  assert.equal((await sale({ clientSaleId: 'multi-0', terminalId: 'NOPE' })).status, 400);

  // cobra en la segunda: la orden va a esa terminal y la venta guarda su nombre
  const c = await sale({ clientSaleId: 'multi-1', terminalId: 'T2' });
  assert.equal(c.status, 201, c.text);
  assert.equal(mpCalls.filter((x) => x.url.endsWith('/v1/orders') && x.method === 'POST').pop().body.config.point.terminal_id, 'T2');
  mpOrder = paid(TOTAL);
  await api.call('GET', `/point/charges/${c.json.id}`, { token: cashier() });
  const venta = await counter({ pointChargeId: c.json.id, clientRef: 'ref-multi' });
  assert.equal(venta.status, 201, venta.text);
  assert.equal(venta.json.pointTerminal, 'Terraza');

  // quitar una deja la otra
  assert.equal((await api.call('DELETE', '/point/terminals/T2', { token: admin() })).status, 204);
  assert.equal((await api.call('DELETE', '/point/terminals/T2', { token: admin() })).status, 404);
  assert.deepEqual((await api.call('GET', '/point/status', { token: cashier() })).json.terminals.map((t) => t.name), ['Barra']);
  assert.equal((await api.call('PUT', '/point/terminals/T1', { token: cashier(), body: { name: 'X' } })).status, 403);
});

test('una conexión de antes (una sola terminal) se sigue leyendo', async () => {
  const conn = state.pointConns.find((c) => c.tenantId === 't1');
  const { terminals, ...rest } = conn;
  Object.keys(conn).forEach((k) => delete conn[k]);
  Object.assign(conn, rest, { terminalId: 'T1', terminalLabel: 'CAJA1' });
  const st = (await api.call('GET', '/point/status', { token: cashier() })).json;
  assert.deepEqual([st.ok, st.terminalLabel, st.terminals.length], [true, 'CAJA1', 1]);
  mpOrder = { status: 'created', payment: null };
  assert.equal((await api.call('POST', '/point/charges', { token: cashier(), body: { clientSaleId: 'legacy-1', amount: TOTAL } })).status, 201, 'sin elegir, usa la única');
});

test('el webhook exige la firma de Mercado Pago', async () => {
  const post = (headers) => realFetch(`${api.base}/point/webhook?data.id=ORD1`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ 'x-signature': 'ts=1,v1=' + 'a'.repeat(64), 'x-request-id': 'r1' })).status, 401);
  const ts = '1700000000';
  const v1 = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(`id:ord1;request-id:r1;ts:${ts};`).digest('hex');
  assert.equal((await post({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1' })).status, 200);
});

test('desconectar borra la conexión', async () => {
  assert.equal((await api.call('DELETE', '/point/connection', { token: admin() })).status, 204);
  assert.equal(state.pointConns.length, 0);
  assert.equal((await api.call('GET', '/point/status', { token: cashier() })).json.code, 'not_connected');
});
