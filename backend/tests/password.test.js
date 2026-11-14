const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');
const hasher = require('../utils/bcrypt.utils');

const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => {
  api = await startServer(app);
  state.users.push(
    { _id: new ObjectId(), name: 'Ana', lastName: 'D', username: 'ana', email: 'ana@t1.com', password: await hasher.hashPassword('ClaveActual1'), role: 'admin', tenantId: 't1' },
    { _id: new ObjectId(), name: 'Raúl', lastName: 'A', username: 'root', email: 'root@p.com', password: await hasher.hashPassword('ClaveRoot123'), role: 'platform_admin', tenantId: null },
  );
});
test.after(async () => { await api.close(); });

const change = (token, body) => api.call('PUT', '/usuarios/password', { token, body });
const ana = () => tokenFor('ana', 'admin', 't1');
const stored = (username) => state.users.find((u) => u.username === username).password;

test('hay que tener sesión para cambiar la contraseña', async () => {
  assert.equal((await change(undefined, { currentPassword: 'ClaveActual1', newPassword: 'NuevaClave99' })).status, 401);
});

test('valida la contraseña actual y la nueva sin cambiar nada', async () => {
  const before = stored('ana');
  const cases = [
    [{ currentPassword: 'incorrecta', newPassword: 'NuevaClave99' }, /actual no es correcta/],
    [{ currentPassword: '', newPassword: 'NuevaClave99' }, /actual no es correcta/],
    [{ currentPassword: 'ClaveActual1', newPassword: 'corta' }, /al menos 8/],
    [{ currentPassword: 'ClaveActual1', newPassword: 'ClaveActual1' }, /distinta/],
    [{ currentPassword: 'ClaveActual1', newPassword: 'MiAna12345' }, /usuario/],
  ];
  for (const [body, expected] of cases) {
    const r = await change(ana(), body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.text, expected);
  }
  assert.equal(stored('ana'), before, 'la contraseña no cambió');
});

test('cambia la contraseña: la nueva sirve, la vieja ya no, y se guarda cifrada', async () => {
  const r = await change(ana(), { currentPassword: 'ClaveActual1', newPassword: 'NuevaClave99' });
  assert.equal(r.status, 200, r.text);
  assert.match(stored('ana'), /^\$2[aby]\$/);
  assert.equal(await hasher.checkPassword('NuevaClave99', stored('ana')), true);
  assert.equal(await hasher.checkPassword('ClaveActual1', stored('ana')), false);
  // y repetirlo con la contraseña vieja ya no funciona
  assert.equal((await change(ana(), { currentPassword: 'ClaveActual1', newPassword: 'OtraClave123' })).status, 400);
});

test('también lo puede hacer una cuenta que no pertenece a un negocio (plataforma)', async () => {
  const r = await change(tokenFor('root', 'platform_admin', null), { currentPassword: 'ClaveRoot123', newPassword: 'ClaveNueva456' });
  assert.equal(r.status, 200, r.text);
  assert.equal(await hasher.checkPassword('ClaveNueva456', stored('root')), true);
});

test('cada cuenta cambia solo la suya', async () => {
  // con la sesión de Ana no se puede tocar la contraseña de otra persona: el cuerpo no acepta usuario
  const before = stored('root');
  const r = await change(ana(), { currentPassword: 'NuevaClave99', newPassword: 'Distinta12345', username: 'root' });
  assert.equal(r.status, 200);
  assert.equal(stored('root'), before);
});
