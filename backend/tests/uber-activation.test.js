// Uber Eats: activar la tienda del comercio por OAuth (autorizar, elegir tienda, activar, quitar y avisos).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');

Object.assign(process.env, {
  UBER_EATS_ENV: 'sandbox',
  UBER_EATS_CLIENT_ID: 'cid',
  UBER_EATS_CLIENT_SECRET: 'secreto-de-prueba',
  UBER_EATS_REDIRECT_URI: 'https://app.test/api/integrations/uber/oauth/callback',
  OAUTH_STATE_SECRET: 'estado-secreto',
  TOKEN_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  APP_URL: 'http://app.test',
});
const SECRET = process.env.UBER_EATS_CLIENT_SECRET;

const { app, state, tokenFor } = loadApp();
const db = require('../database/mongodb'); // la base simulada de loadApp
let api;
const realFetch = global.fetch;
const uberCalls = [];
let userStores = []; // tiendas del comercio que autoriza
let provisionFails = false;
let patchFails = false;
let deleteFails = false;
let integrationEnabled = false; // lo que Uber responde en GET pos_data

const store = (id, name) => ({ store_id: id, name, location: { address: `Calle ${name}`, city: 'CDMX' } });
const headerOf = (opts, name) => Object.entries(opts.headers || {}).find(([k]) => k.toLowerCase() === name)?.[1];

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  const call = { url: u, method: opts.method || 'GET', body: opts.body ? String(opts.body) : null, auth: headerOf(opts, 'authorization') };
  uberCalls.push(call);
  const json = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  if (u.includes('/oauth/v2/token')) {
    const p = new URLSearchParams(call.body);
    if (p.get('grant_type') === 'authorization_code') return p.get('code')?.startsWith('code-ok') ? json(200, { access_token: `user-${p.get('code')}` }) : json(400, { error: 'invalid_grant' });
    return json(200, { access_token: 'app-token', expires_in: 2592000 });
  }
  if (/\/v1\/eats\/stores\/[^/?]+$/.test(u)) return json(200, { name: 'Tienda manual' }); // vincular con el Store ID la verifica con Uber
  if (/\/v1\/eats\/stores\?/.test(u)) {
    if (!call.auth?.startsWith('Bearer user-')) return json(401, {});
    const start = Number(new URL(u).searchParams.get('start_key') || 0);
    const page = userStores.slice(start, start + 2); // páginas de 2 para probar el paso a la siguiente
    return json(200, { stores: page, next_key: start + 2 < userStores.length ? String(start + 2) : '' });
  }
  if (/\/pos_data$/.test(u)) {
    if (call.method === 'POST') return !call.auth?.startsWith('Bearer user-') ? json(401, {}) : provisionFails ? json(400, { message: 'tienda no autorizada' }) : json(204);
    if (call.method === 'PATCH') return patchFails ? json(404, {}) : json(204);
    if (call.method === 'DELETE') return !call.auth?.startsWith('Bearer user-') ? json(401, {}) : deleteFails ? json(403, { message: 'sin permiso' }) : json(204);
    return json(200, { integration_enabled: integrationEnabled });
  }
  return json(500, {});
};

test.before(async () => {
  api = await startServer(app);
  state.users.push(
    { _id: new ObjectId(), name: 'Ana', lastName: 'D', username: 'ana', email: 'ana@t1.com', password: 'x', role: 'admin', tenantId: 't1' },
    { _id: new ObjectId(), name: 'Beto', lastName: 'B', username: 'beto', email: 'beto@t2.com', password: 'x', role: 'admin', tenantId: 't2' },
    { _id: new ObjectId(), name: 'Caro', lastName: 'C', username: 'caro', email: 'caro@t1.com', password: 'x', role: 'cashier', tenantId: 't1' },
  );
});
test.after(async () => { await api.close(); global.fetch = realFetch; });

const admin = () => tokenFor('ana', 'admin', 't1');
const cashier = () => tokenFor('caro', 'cashier', 't1');
const other = () => tokenFor('beto', 'admin', 't2');
const connectUrl = async (token = admin()) => new URL((await api.call('GET', '/integrations/uber/connect', { token })).json.url);
const callback = (params) => realFetch(`${api.base}/integrations/uber/oauth/callback?${new URLSearchParams(params)}`, { redirect: 'manual' });
// El comercio autoriza: Uber devuelve el state que le dimos
const authorize = async (code = 'code-ok', token = admin()) => callback({ code, state: (await connectUrl(token)).searchParams.get('state') });
const landed = (r) => r.headers.get('location');
const integ = (t = 't1') => state.integrations?.find((i) => i.provider === 'uber' && i.tenantId === t);
const lastCall = (re, method) => uberCalls.filter((c) => re.test(c.url) && (!method || c.method === method)).pop();
const hook = (ev) => {
  const raw = JSON.stringify(ev);
  return realFetch(`${api.base}/integrations/uber/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Uber-Signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }, body: raw });
};

test('conectar: solo el administrador, con la dirección de autorización de Uber y un state firmado', async () => {
  assert.equal((await api.call('GET', '/integrations/uber/connect', { token: cashier() })).status, 403);
  const url = await connectUrl();
  assert.equal(`${url.origin}${url.pathname}`, 'https://sandbox-login.uber.com/oauth/v2/authorize');
  assert.deepEqual(
    ['response_type', 'scope', 'client_id', 'redirect_uri'].map((k) => url.searchParams.get(k)),
    ['code', 'eats.pos_provisioning', 'cid', process.env.UBER_EATS_REDIRECT_URI],
  );
  assert.ok(url.searchParams.get('state'));

  const redirect = process.env.UBER_EATS_REDIRECT_URI;
  delete process.env.UBER_EATS_REDIRECT_URI;
  const sinConfig = await api.call('GET', '/integrations/uber/connect', { token: admin() });
  process.env.UBER_EATS_REDIRECT_URI = redirect;
  assert.equal(sinConfig.status, 503);
  assert.equal((await api.call('GET', '/integrations/uber', { token: admin() })).json.oauth, true);
});

test('al volver de Uber: un state falso o una autorización cancelada no activan nada', async () => {
  assert.equal(landed(await callback({ code: 'code-ok', state: 't1.x.firmafalsa' })), 'http://app.test/settings?s=integraciones&uber=error&reason=state');
  assert.equal(landed(await callback({ error: 'access_denied', state: 'x' })), 'http://app.test/settings?s=integraciones&uber=error&reason=cancelled');
  assert.equal(landed(await authorize('codigo-malo')), 'http://app.test/settings?s=integraciones&uber=error&reason=unknown', 'Uber rechaza el código');
  assert.equal(integ(), undefined);
});

test('con una sola tienda se activa sola, con el token del comercio y sin guardarlo', async () => {
  userStores = [store('11111111-aaaa', 'Centro')];
  integrationEnabled = false;
  assert.equal(landed(await authorize()), 'http://app.test/settings?s=integraciones&uber=activated');

  const post = lastCall(/\/stores\/11111111-aaaa\/pos_data$/, 'POST');
  assert.equal(post.auth, 'Bearer user-code-ok', 'activar usa el token del comercio');
  assert.deepEqual(JSON.parse(post.body), { is_order_manager: true, integrator_store_id: 't1' });
  assert.equal(uberCalls.find((c) => c.method === 'GET' && /\/pos_data$/.test(c.url)).auth, 'Bearer app-token', 'consultar usa el token de la aplicación');
  assert.deepEqual([integ().storeId, integ().storeName, integ().storeAddress, integ().linkedVia, integ().integrationEnabled], ['11111111-aaaa', 'Centro', 'Calle Centro, CDMX', 'oauth', false]);
  assert.doesNotMatch(JSON.stringify(state.integrations), /user-code-ok/, 'el token del comercio no se guarda');

  const st = (await api.call('GET', '/integrations/uber', { token: admin() })).json;
  assert.deepEqual([st.storeId, st.storeName, st.linkedVia, st.integrationEnabled, st.deprovisioned], ['11111111-aaaa', 'Centro', 'oauth', false, false]);
});

test('Uber avisa que activó o retiró el acceso a la tienda', async () => {
  const ev = (type) => ({ event_type: type, store_id: '11111111-aaaa' });
  assert.equal((await hook(ev('store.provisioned'))).status, 200);
  assert.ok(integ().provisionedAt);
  assert.equal((await hook(ev('store.deprovisioned'))).status, 200);
  assert.equal((await api.call('GET', '/integrations/uber', { token: admin() })).json.deprovisioned, true);
  // También por meta.user_id, y una tienda desconocida se responde 200 sin hacer nada
  assert.equal((await hook({ event_type: 'store.provisioned', meta: { user_id: '11111111-aaaa' } })).status, 200);
  assert.equal(integ().deprovisioned, false);
  assert.equal((await hook(ev('store.provisioned'))).status, 200);
  assert.equal((await hook({ event_type: 'store.deprovisioned', store_id: 'tienda-ajena' })).status, 200);
  assert.equal(integ().deprovisioned, false);
});

test('con varias tiendas elige una; la anterior se apaga y el token queda cifrado y oculto', async () => {
  userStores = [store('22222222-bbbb', 'Norte'), store('33333333-cccc', 'Sur'), store('44444444-dddd', 'Este')]; // 2 páginas
  assert.equal(landed(await authorize('code-ok-2')), 'http://app.test/settings?s=integraciones&uber=choose');
  assert.ok(uberCalls.some((c) => /start_key=2/.test(c.url)), 'pasó a la segunda página');
  assert.notEqual(state.uberPending.t1.token, 'user-code-ok-2');
  assert.doesNotMatch(JSON.stringify(state.uberPending.t1.token), /user-/);
  assert.equal(integ().storeId, '11111111-aaaa', 'aún no cambia nada');

  assert.equal((await api.call('GET', '/integrations/uber/pending', { token: cashier() })).status, 403);
  const pending = await api.call('GET', '/integrations/uber/pending', { token: admin() });
  assert.deepEqual(pending.json.stores.map((s) => s.name), ['Norte', 'Sur', 'Este']);
  assert.doesNotMatch(pending.text, /token|user-/);

  assert.equal((await api.call('POST', '/integrations/uber/activate', { token: admin(), body: { storeId: 'ajena' } })).status, 400);
  assert.equal((await api.call('POST', '/integrations/uber/activate', { token: other(), body: { storeId: '33333333-cccc' } })).status, 400, 'cada negocio con su propia autorización');
  const r = await api.call('POST', '/integrations/uber/activate', { token: admin(), body: { storeId: '33333333-cccc' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(lastCall(/\/stores\/33333333-cccc\/pos_data$/, 'POST').auth, 'Bearer user-code-ok-2');
  assert.equal(integ().storeId, '33333333-cccc');
  assert.deepEqual(JSON.parse(lastCall(/\/stores\/11111111-aaaa\/pos_data$/, 'PATCH').body), { integration_enabled: false }, 'la tienda anterior se apagó');
  assert.equal(state.uberPending.t1, undefined, 'la autorización pendiente se borra');
});

test('una tienda ya vinculada a otro negocio no se puede activar', async () => {
  userStores = [store('33333333-cccc', 'Sur')]; // la tiene t1
  assert.equal(landed(await authorize('code-ok-3', other())), 'http://app.test/settings?s=integraciones&uber=taken');
  assert.equal(integ('t2'), undefined);
  userStores = [];
  assert.equal(landed(await authorize('code-ok-4', other())), 'http://app.test/settings?s=integraciones&uber=none');
});

test('si Uber rechaza la activación, el vínculo queda como estaba y se dice por qué', async () => {
  userStores = [store('55555555-eeee', 'Oeste')];
  provisionFails = true;
  const r = await authorize('code-ok-5');
  provisionFails = false;
  assert.equal(landed(r), 'http://app.test/settings?s=integraciones&uber=error&reason=unknown');
  assert.equal(integ().storeId, '33333333-cccc');
  assert.ok(state.uberEvents.some((e) => e.eventType === 'api.activate' && e.outcome === 'error' && /no autorizada/.test(e.detail)));

  // Con varias tiendas, el mismo rechazo se ve en pantalla
  userStores = [store('55555555-eeee', 'Oeste'), store('66666666-ffff', 'Centro 2')];
  await authorize('code-ok-6');
  provisionFails = true;
  const act = await api.call('POST', '/integrations/uber/activate', { token: admin(), body: { storeId: '55555555-eeee' } });
  provisionFails = false;
  assert.equal(act.status, 502);
  assert.match(act.text, /tienda no autorizada/);
  assert.equal(integ().storeId, '33333333-cccc');
});

test('la autorización pendiente caduca a los 15 minutos', async () => {
  state.uberPending.t1.createdAt = new Date(Date.now() - 16 * 60_000);
  assert.deepEqual((await api.call('GET', '/integrations/uber/pending', { token: admin() })).json.stores, []);
  const r = await api.call('POST', '/integrations/uber/activate', { token: admin(), body: { storeId: '55555555-eeee' } });
  assert.equal(r.status, 400);
  assert.match(r.text, /caducó/);
});

test('desvincular apaga la integración en Uber si la activamos nosotros, y avisa si no se pudo', async () => {
  const n = uberCalls.length;
  const r = await api.call('DELETE', '/integrations/uber', { token: admin() });
  assert.deepEqual([r.status, r.json.deactivated], [200, true]);
  assert.deepEqual(JSON.parse(lastCall(/\/stores\/33333333-cccc\/pos_data$/, 'PATCH').body), { integration_enabled: false });
  assert.equal(integ(), undefined);
  assert.ok(uberCalls.length > n);

  userStores = [store('77777777-gggg', 'Poniente')];
  await authorize('code-ok-7');
  patchFails = true;
  const r2 = await api.call('DELETE', '/integrations/uber', { token: admin() });
  patchFails = false;
  assert.deepEqual([r2.status, r2.json.deactivated], [200, false], 'se desvincula igual, pero se avisa');
  assert.equal(integ(), undefined);
  assert.ok(state.uberEvents.some((e) => e.eventType === 'api.deactivate' && e.outcome === 'error'));
});

test('quitar la integración del todo: pide autorizar de nuevo y borra la tienda en Uber con el token del comercio', async () => {
  // Una tienda vinculada a mano no se quita desde aquí
  await db.SaveIntegration('uber', 't1', { storeId: 'store-manual-0002', linkedVia: 'manual', deprovisioned: false }); // vinculación vieja, de cuando se escribía el Store ID
  assert.equal((await api.call('POST', '/integrations/uber/remove', { token: admin() })).status, 400);
  await api.call('DELETE', '/integrations/uber', { token: admin() });

  userStores = [store('88888888-hhhh', 'Quitar')];
  await authorize('code-ok-8');
  assert.equal(integ().storeId, '88888888-hhhh');

  assert.equal((await api.call('POST', '/integrations/uber/remove', { token: cashier() })).status, 403);
  const r = await api.call('POST', '/integrations/uber/remove', { token: admin() });
  assert.equal(r.status, 200, r.text);
  assert.equal(new URL(r.json.url).searchParams.get('scope'), 'eats.pos_provisioning');
  assert.equal(state.uberPending.t1.intent, 'remove');
  assert.equal(integ().storeId, '88888888-hhhh', 'todavía no se quita nada');

  // Uber lo rechaza: la tienda sigue vinculada
  deleteFails = true;
  const bad = await callback({ code: 'code-ok-9', state: new URL(r.json.url).searchParams.get('state') });
  deleteFails = false;
  assert.equal(landed(bad), 'http://app.test/settings?s=integraciones&uber=error&reason=unknown');
  assert.equal(integ().storeId, '88888888-hhhh');
  assert.equal(state.uberPending.t1, undefined, 'la intención se borra aunque falle');

  // Autoriza el comercio: se quita en Uber y aquí
  const again = await api.call('POST', '/integrations/uber/remove', { token: admin() });
  const ok = await callback({ code: 'code-ok-10', state: new URL(again.json.url).searchParams.get('state') });
  assert.equal(landed(ok), 'http://app.test/settings?s=integraciones&uber=removed');
  const del = lastCall(/\/stores\/88888888-hhhh\/pos_data$/, 'DELETE');
  assert.equal(del.auth, 'Bearer user-code-ok-10');
  assert.equal(integ(), undefined);
  assert.equal(state.uberPending.t1, undefined);
});

test('una intención de quitar vieja no secuestra una conexión nueva', async () => {
  state.uberPending = { t1: { tenantId: 't1', intent: 'remove', createdAt: new Date(Date.now() - 16 * 60_000) } };
  userStores = [store('99999999-iiii', 'Nueva')];
  assert.equal(landed(await authorize('code-ok-11')), 'http://app.test/settings?s=integraciones&uber=activated');
  assert.equal(integ().storeId, '99999999-iiii');
  assert.equal(lastCall(/\/stores\/99999999-iiii\/pos_data$/, 'DELETE'), undefined);
  // y una autorización pendiente de «quitar» no deja elegir tiendas
  await api.call('POST', '/integrations/uber/remove', { token: admin() });
  assert.deepEqual((await api.call('GET', '/integrations/uber/pending', { token: admin() })).json.stores, []);
  assert.equal((await api.call('POST', '/integrations/uber/activate', { token: admin(), body: { storeId: '99999999-iiii' } })).status, 400);
  await api.call('DELETE', '/integrations/uber', { token: admin() });
});
