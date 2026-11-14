// Enfoque de servicio: «solo para llevar», «con meseros» o «completo» deciden qué roles puede tener el equipo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');
const mode = require('../models/venueMode');

const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const user = (username, role, tenantId = 't1') => ({ _id: new ObjectId(), name: username, lastName: 'T', username, email: `${username}@x.com`, password: 'x', role, tenantId });
const idOf = (username) => String(state.users.find((u) => u.username === username)._id);
const admin = () => tokenFor('ana', 'admin');
const member = (over = {}) => ({ name: 'Paco', lastName: 'Perez', username: 'paco', password: 'secreta123', role: 'cashier', ...over });
const reset = (settings) => {
  state.users = [user('ana', 'admin'), user('jefe', 'admin', 't2')];
  state.invites = [];
  state.waiters = [];
  state.settings.t1 = settings === undefined ? undefined : { businessName: 'La Casa', ...settings };
  if (settings === undefined) delete state.settings.t1;
  state.settings.t2 = { businessType: 'restaurant', businessName: 'Otro' };
};
const focus = (serviceFocus) => reset({ businessType: 'restaurant', serviceFocus });
const create = (over) => api.call('POST', '/team', { token: admin(), body: member(over) });

// ——— Modelo (puro) ———
test('cada enfoque define sus roles y el flujo de pantallas', () => {
  assert.deepEqual(mode.limitsFor({ serviceFocus: 'takeaway' }), { focus: 'takeaway', mode: 'counter', maxUsers: null, allowedRoles: ['admin', 'cashier'] });
  assert.deepEqual(mode.limitsFor({ serviceFocus: 'waiters' }), { focus: 'waiters', mode: 'table', maxUsers: null, allowedRoles: ['admin', 'cashier', 'waiter'] });
  const full = mode.limitsFor({ serviceFocus: 'full' });
  assert.deepEqual([full.mode, full.maxUsers, full.allowedRoles.length], ['table', null, 5]);
});

test('compatibilidad: sin enfoque guardado, el café sigue como mostrador y el resto como completo', () => {
  assert.equal(mode.focusOf({ businessType: 'cafe' }), 'takeaway');
  assert.equal(mode.focusOf({ businessType: 'restaurant' }), 'full');
  assert.equal(mode.focusOf({ businessType: 'bar' }), 'full');
  assert.equal(mode.focusOf(undefined), 'full');
  assert.equal(mode.focusOf(null), 'full');
  assert.equal(mode.focusOf({ serviceFocus: 'raro', businessType: 'cafe' }), 'takeaway', 'un valor inválido se ignora');
  assert.equal(mode.focusOf({ serviceFocus: 'full', businessType: 'cafe' }), 'full', 'el enfoque guardado manda sobre el tipo');
});

// ——— Equipo ———
test('el listado informa el enfoque y solo ofrece los roles que le tocan', async () => {
  for (const [f, roles] of [['takeaway', ['admin', 'cashier']], ['waiters', ['admin', 'cashier', 'waiter']], ['full', ['admin', 'cashier', 'host', 'kitchen', 'waiter']]]) {
    focus(f);
    const r = await api.call('GET', '/team', { token: admin() });
    assert.equal(r.json.limits.focus, f);
    assert.deepEqual(r.json.roles.map((x) => x.id).sort(), [...roles].sort(), f);
  }
});

test('completo: puede haber varias personas por rol, cada una con su cuenta', async () => {
  focus('full');
  const crear = [];
  for (const [i, role] of ['waiter', 'waiter', 'waiter', 'kitchen', 'kitchen', 'host', 'host', 'cashier', 'cashier'].entries()) {
    crear.push(await create({ username: `usuario${i}`, role, cellphone: `66400000${i}0` }));
  }
  assert.ok(crear.every((c) => c.status === 201), crear.map((c) => c.text).join(' | '));
  const roles = state.users.filter((u) => u.tenantId === 't1').map((u) => u.role);
  assert.equal(roles.filter((r) => r === 'waiter').length, 3);
  assert.equal(roles.filter((r) => r === 'kitchen').length, 2);
  assert.equal(state.users.find((u) => u.username === 'usuario0').tenantId, 't1');
});

test('solo para llevar: sin tope de personas, pero nada de Mesero, Cocina ni Anfitrión', async () => {
  focus('takeaway');
  for (let i = 0; i < 4; i += 1) assert.equal((await create({ username: `caja${i}` })).status, 201, `caja${i}`);
  for (const role of ['waiter', 'kitchen', 'host']) {
    const r = await create({ username: `n_${role}`, role, cellphone: '6641234567' });
    assert.equal(r.status, 400, role);
    assert.match(r.text, /«Solo para llevar» solo hay Administrador y Caja/);
  }
});

test('con meseros: hay meseros, pero no Cocina ni Anfitrión', async () => {
  focus('waiters');
  assert.equal((await create({ username: 'mesero1', role: 'waiter', cellphone: '6641111111' })).status, 201);
  assert.equal((await create({ username: 'mesero2', role: 'waiter', cellphone: '6642222222' })).status, 201);
  for (const role of ['kitchen', 'host']) {
    const r = await create({ username: `n_${role}`, role, cellphone: '6643333333' });
    assert.equal(r.status, 400, role);
    assert.match(r.text, /«Con meseros» solo hay Administrador, Caja y Mesero/);
  }
});

test('un negocio sin ajustes guardados todavía se trata como completo', async () => {
  reset(undefined);
  const r = await create({ role: 'kitchen', cellphone: '6641111111' });
  assert.equal(r.status, 201, r.text);
});

test('los límites son por negocio: otro negocio no los afecta', async () => {
  focus('takeaway');
  state.settings.t2 = { businessName: 'Otro', serviceFocus: 'full' };
  const r = await api.call('POST', '/team', { token: tokenFor('jefe', 'admin', 't2'), body: member({ username: 'cocinero', role: 'kitchen', cellphone: '6649999999' }) });
  assert.equal(r.status, 201, r.text);
});

test('cambiar el rol de alguien solo entre los roles del enfoque', async () => {
  focus('takeaway');
  await create();
  const put = (role) => api.call('PUT', `/team/${idOf('paco')}/role`, { token: admin(), body: { role } });
  assert.equal((await put('waiter')).status, 400);
  assert.equal((await put('admin')).status, 200);

  focus('waiters');
  await create({ username: 'paco2' });
  const put2 = (role) => api.call('PUT', `/team/${idOf('paco2')}/role`, { token: admin(), body: { role } });
  assert.equal((await put2('kitchen')).status, 400);
  assert.equal((await put2('waiter')).status, 200);
});

test('invitaciones: respetan los roles del enfoque y se vuelven a comprobar al aceptar', async () => {
  focus('waiters');
  const invite = (email, role) => api.call('POST', '/invites', { token: admin(), body: { email, role } });
  assert.equal((await invite('a@x.com', 'kitchen')).status, 400, 'cocina no existe en «con meseros»');
  assert.equal((await invite('b@x.com', 'waiter')).status, 201);
  assert.equal((await invite('c@x.com', 'waiter')).status, 201, 'sin tope: caben todas las que quiera');

  const token = state.invites[0].token;
  state.settings.t1.serviceFocus = 'takeaway'; // cambió de enfoque después de invitar
  const r = await api.call('POST', '/invites/accept', { body: { token, name: 'N', lastName: 'M', username: 'nuevo', password: 'secreta123' } });
  assert.equal(r.status, 400);
  assert.match(r.text, /solo hay Administrador y Caja/);
  assert.ok(!state.users.some((u) => u.username === 'nuevo'));
});

// ——— Ajustes ———
const save = (body) => api.call('POST', '/settings', { token: admin(), body: { businessName: 'La Casa', businessType: 'restaurant', ...body } });

test('cambiar de enfoque se rechaza si el equipo actual no cabe, y se acepta si cabe', async () => {
  focus('full');
  state.users.push(user('marta', 'waiter'), user('rene', 'kitchen'));

  const aLlevar = await save({ serviceFocus: 'takeaway' });
  assert.equal(aLlevar.status, 400);
  assert.match(aLlevar.text, /«Solo para llevar»/);
  assert.match(aLlevar.text, /Mesero/);
  assert.match(aLlevar.text, /Cocina/);
  assert.equal(state.settings.t1.serviceFocus, 'full', 'no se guardó');

  const conMeseros = await save({ serviceFocus: 'waiters' });
  assert.equal(conMeseros.status, 400);
  assert.match(conMeseros.text, /Cocina/);
  assert.doesNotMatch(conMeseros.text, /Mesero/);

  state.users = state.users.filter((u) => u.username !== 'rene');
  const ok = await save({ serviceFocus: 'waiters' });
  assert.ok([200, 201].includes(ok.status), ok.text);
  assert.equal(state.settings.t1.serviceFocus, 'waiters');

  // Y pasar a un enfoque con más roles siempre se puede.
  assert.ok([200, 201].includes((await save({ serviceFocus: 'full' })).status));
});

test('guardar sin mandar el enfoque conserva el que ya tenía', async () => {
  focus('waiters');
  const r = await save({ businessType: 'bar' });
  assert.ok([200, 201].includes(r.status), r.text);
  assert.equal(state.settings.t1.serviceFocus, 'waiters');
});

test('un negocio antiguo (café sin enfoque) queda guardado como «solo para llevar»; uno de salón como «completo»', async () => {
  reset({ businessType: 'cafe' });
  assert.ok([200, 201].includes((await save({ businessType: 'cafe' })).status));
  assert.equal(state.settings.t1.serviceFocus, 'takeaway');

  reset({ businessType: 'restaurant' });
  assert.ok([200, 201].includes((await save({})).status));
  assert.equal(state.settings.t1.serviceFocus, 'full');
});

test('un enfoque inválido se rechaza', async () => {
  focus('full');
  const r = await save({ serviceFocus: 'volando' });
  assert.equal(r.status, 400);
  assert.equal(state.settings.t1.serviceFocus, 'full');
});

test('solo el administrador cambia el enfoque', async () => {
  focus('full');
  state.users.push(user('caja', 'cashier'));
  const r = await api.call('POST', '/settings', { token: tokenFor('caja', 'cashier'), body: { businessName: 'La Casa', serviceFocus: 'takeaway' } });
  assert.ok([401, 403].includes(r.status), String(r.status));
  assert.equal(state.settings.t1.serviceFocus, 'full');
});
