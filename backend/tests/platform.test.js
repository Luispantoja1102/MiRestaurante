const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');

const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const user = (over) => ({ _id: new ObjectId(), name: 'N', lastName: 'L', password: 'x', cellphone: '5555555555', ...over });
state.users.push(
  user({ name: 'Ana', lastName: 'Dueña', username: 'ana', email: 'ana@t1.com', role: 'admin', tenantId: 't1', lastLoginAt: new Date() }),
  user({ username: 'root', email: 'root@p.com', role: 'platform_admin', tenantId: null }),
  user({ username: 'ayuda', email: 'ayuda@p.com', role: 'platform_support', tenantId: null }),
);
state.settings.t1 = { tenantId: 't1', businessName: 'Cafe Uno', phone: '555', address: 'Calle 1', businessType: 'cafe' };
// t2 sin ajustes: aún no termina la configuración inicial
const admin = () => tokenFor('root', 'platform_admin', null);
const support = () => tokenFor('ayuda', 'platform_support', null);
const owner = () => tokenFor('ana', 'admin', 't1');

test('sin sesión o siendo de un negocio no se entra a la plataforma', async () => {
  assert.equal((await api.call('GET', '/platform/tenants')).status, 401);
  assert.equal((await api.call('GET', '/platform/tenants', { token: owner() })).status, 403);
  assert.equal((await api.call('GET', '/platform/overview', { token: owner() })).status, 403);
});

test('soporte consulta clientes pero no cambia nada ni ve resumen ni equipo', async () => {
  const list = await api.call('GET', '/platform/tenants', { token: support() });
  assert.equal(list.status, 200);
  assert.equal((await api.call('GET', '/platform/tenants/t1', { token: support() })).status, 200);
  assert.equal((await api.call('GET', '/platform/tenants/t1/activity', { token: support() })).status, 200);
  for (const [method, url, body] of [
    ['PATCH', '/platform/tenants/t1', { businessName: 'Hack' }],
    ['POST', '/platform/tenants/t1/suspend', {}],
    ['POST', '/platform/tenants/t1/reactivate', {}],
    ['PATCH', '/platform/tenants/t1/plan', { plan: 'pro' }],
    ['GET', '/platform/overview'],
    ['GET', '/platform/activity'],
    ['GET', '/platform/staff'],
    ['POST', '/platform/staff', {}],
  ]) {
    assert.equal((await api.call(method, url, { token: support(), body })).status, 403, `${method} ${url}`);
  }
});

test('la lista de clientes trae negocio, dueño y último acceso, sin contraseñas', async () => {
  const r = await api.call('GET', '/platform/tenants', { token: admin() });
  assert.equal(r.status, 200);
  const t1 = r.json.find((t) => t.id === 't1');
  assert.equal(t1.businessName, 'Cafe Uno');
  assert.equal(t1.ownerName, 'Ana Dueña');
  assert.equal(t1.ownerEmail, 'ana@t1.com');
  assert.ok(t1.lastSeenAt);
  assert.equal(t1.usersCount, 1);
  assert.ok(!JSON.stringify(r.json).includes('"password"'));
  assert.equal(r.json.find((t) => t.id === 't2').businessName, 'T2');
});

test('la ficha del cliente incluye personas y uso', async () => {
  const r = await api.call('GET', '/platform/tenants/t1', { token: admin() });
  assert.equal(r.status, 200);
  assert.equal(r.json.users.length, 1);
  assert.equal(r.json.users[0].username, 'ana');
  assert.ok(r.json.usage);
  assert.equal((await api.call('GET', '/platform/tenants/nope', { token: admin() })).status, 404);
});

test('el admin edita un cliente, queda en la bitácora y no crea ajustes a medias', async () => {
  const r = await api.call('PATCH', '/platform/tenants/t1', {
    token: admin(),
    body: { businessName: 'Cafe Dos', phone: '777', address: 'Av 2', plan: 'pro', billingStatus: 'active' },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.plan, 'pro');
  assert.equal(r.json.billingStatus, 'active');
  assert.equal(state.settings.t1.businessName, 'Cafe Dos');
  assert.equal(state.settings.t1.phone, '777');
  const log = await api.call('GET', '/platform/tenants/t1/activity', { token: admin() });
  assert.ok(log.json.items.some((i) => /plan Básico → Pro/.test(i.message)), JSON.stringify(log.json));
  assert.equal(log.json.items[0].actor, 'root');

  // t2 no tenía ajustes: editar el cliente no debe inventarle una configuración
  const t2 = await api.call('PATCH', '/platform/tenants/t2', { token: admin(), body: { businessName: 'Dos' } });
  assert.equal(t2.status, 200);
  assert.equal(state.settings.t2, undefined);
});

test('editar valida nombre, plan, estado y fecha', async () => {
  const bad = (body) => api.call('PATCH', '/platform/tenants/t1', { token: admin(), body: { businessName: 'Ok', ...body } });
  assert.equal((await bad({ businessName: 'x' })).status, 400);
  assert.equal((await bad({ plan: 'gold' })).status, 400);
  assert.equal((await bad({ billingStatus: 'raro' })).status, 400);
  assert.equal((await bad({ trialEndsOn: 'ayer' })).status, 400);
});

test('suspender y reactivar cambian el estado y dejan huella', async () => {
  const s = await api.call('POST', '/platform/tenants/t1/suspend', { token: admin(), body: { reason: 'falta de pago' } });
  assert.equal(s.status, 200);
  assert.equal(state.tenants[0].billingStatus, 'suspended');
  const r = await api.call('POST', '/platform/tenants/t1/reactivate', { token: admin(), body: { mode: 'trial' } });
  assert.equal(r.status, 200);
  assert.equal(state.tenants[0].billingStatus, 'trialing');
  assert.ok(state.tenants[0].trialEndsAt);
  const kinds = state.audit.filter((a) => a.tenantId === 't1').map((a) => a.type);
  assert.ok(kinds.includes('tenant_suspended') && kinds.includes('tenant_reactivated'));
});

test('el resumen cuenta clientes y avisa de pruebas por vencer', async () => {
  state.tenants[1].billingStatus = 'trialing';
  state.tenants[1].trialEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const r = await api.call('GET', '/platform/overview', { token: admin() });
  assert.equal(r.status, 200);
  assert.equal(r.json.clients.total, 2);
  assert.ok(r.json.attention.some((a) => a.id === 't2' && a.kind === 'trial_ending'), JSON.stringify(r.json.attention));
});

test('equipo: crear, listar y quitar con sus protecciones', async () => {
  const body = { name: 'Eva', lastName: 'Soporte', email: 'eva@p.com', username: 'eva', password: 'clave-segura-1', role: 'platform_support' };
  const created = await api.call('POST', '/platform/staff', { token: admin(), body });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.role, 'platform_support');
  assert.equal(created.json.password, undefined);
  assert.match(state.users.find((u) => u.username === 'eva').password, /^\$2[aby]\$/);

  assert.equal((await api.call('POST', '/platform/staff', { token: admin(), body })).status, 400, 'usuario repetido');
  assert.equal((await api.call('POST', '/platform/staff', { token: admin(), body: { ...body, username: 'otra', email: 'o@p.com', password: 'corta' } })).status, 400);

  const list = await api.call('GET', '/platform/staff', { token: admin() });
  assert.deepEqual(list.json.map((p) => p.username).sort(), ['ayuda', 'eva', 'root']);

  const evaId = String(state.users.find((u) => u.username === 'eva')._id);
  assert.equal((await api.call('DELETE', `/platform/staff/${evaId}`, { token: admin() })).status, 200);
  const rootId = String(state.users.find((u) => u.username === 'root')._id);
  assert.equal((await api.call('DELETE', `/platform/staff/${rootId}`, { token: admin() })).status, 400, 'no puede quitarse a sí mismo');
});

test('no se puede quitar al último admin', async () => {
  const other = user({ username: 'otroadmin', email: 'oa@p.com', role: 'platform_admin', tenantId: null });
  state.users.push(other);
  // otroadmin intenta quitar a root, que sí es admin, pero quedaría otro: permitido; luego root ya no existe
  const rootId = String(state.users.find((u) => u.username === 'root')._id);
  const r1 = await api.call('DELETE', `/platform/staff/${rootId}`, { token: tokenFor('otroadmin', 'platform_admin', null) });
  assert.equal(r1.status, 200);
  const solo = await api.call('DELETE', `/platform/staff/${String(other._id)}`, { token: tokenFor('ayuda', 'platform_admin', null) });
  assert.equal(solo.status, 400, 'debe quedar al menos un admin');
});
