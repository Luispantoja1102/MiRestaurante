const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROLE_DEFS, TENANT_ROLES, ROLES, normalizeRole, isTenantRole } = require('../models/roles');

test('normalizeRole convierte el typo viejo y respeta el resto', () => {
  assert.equal(normalizeRole('hosstess'), 'host');
  assert.equal(normalizeRole('waiter'), 'waiter');
  assert.equal(normalizeRole(undefined), undefined);
  assert.ok(isTenantRole('hosstess'));
  assert.ok(!isTenantRole('platform_admin'));
});

test('cada rol del negocio tiene etiqueta, descripción y pantallas', () => {
  for (const r of ROLE_DEFS) {
    assert.ok(r.label && r.description && r.sees.length, `rol ${r.id} incompleto`);
  }
  assert.deepEqual(ROLES, [...TENANT_ROLES, 'platform_admin', 'platform_support', 'partner_admin', 'partner_staff']);
});

test('el frontend y el backend definen exactamente los mismos roles', async () => {
  const front = await import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'roles.js')).href);
  assert.deepEqual(front.ROLE_DEFS.map((r) => r.id), TENANT_ROLES);
  for (const r of ROLE_DEFS) {
    const f = front.ROLE_DEFS.find((x) => x.id === r.id);
    assert.equal(f.label, r.label, `etiqueta distinta para ${r.id}`);
  }
});

test('todo rol cae en una pantalla a la que sí puede entrar, y esa pantalla existe', async () => {
  const front = await import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'roles.js')).href);
  for (const role of [...TENANT_ROLES, 'platform_admin', 'platform_support', 'partner_admin', 'partner_staff']) {
    const home = front.homeForRole(role);
    const screen = front.SCREENS.find((s) => s.name === home);
    assert.ok(screen, `la pantalla de inicio "${home}" de ${role} no existe`);
    assert.ok(screen.roles.includes(role), `${role} no puede entrar a su propia pantalla de inicio (${home})`);
  }
  // Ninguna pantalla puede mencionar un rol que no existe.
  for (const s of front.SCREENS) {
    for (const r of s.roles) assert.ok(ROLES.includes(r), `pantalla ${s.name} usa el rol desconocido ${r}`);
  }
});

// ——— Enfoque de servicio (solo para llevar / con meseros / completo) ———
const { SERVICE_FOCUSES, FOCUS_ROLES, FOCUS_LABELS, focusOf, modeOf, limitsFor } = require('../models/venueMode');
const frontRoles = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'roles.js')).href);

test('enfoque: el frontend y el backend coinciden en enfoques, etiquetas, roles y modo', async () => {
  const front = await frontRoles();
  assert.deepEqual(front.SERVICE_FOCUSES.map((f) => f.id), SERVICE_FOCUSES);
  for (const f of front.SERVICE_FOCUSES) {
    assert.deepEqual([...f.roles].sort(), [...FOCUS_ROLES[f.id]].sort(), `roles de ${f.id}`);
    assert.equal(f.label, FOCUS_LABELS[f.id], `etiqueta de ${f.id}`);
    assert.equal(f.mode, modeOf({ serviceFocus: f.id }), `modo de ${f.id}`);
    assert.ok(f.tagline && f.description, `${f.id} sin textos`);
  }
  assert.deepEqual(front.LEGACY_TAKEAWAY_TYPES, require('../models/venueMode').LEGACY_TAKEAWAY_TYPES);
});

test('enfoque: ambos lados deducen lo mismo para negocios que no lo tienen guardado', async () => {
  const front = await frontRoles();
  const cases = [
    { businessType: 'cafe' }, { businessType: 'restaurant' }, { businessType: 'bar' }, { businessType: 'hotel' }, { businessType: 'other' },
    {}, undefined, { serviceFocus: 'waiters', businessType: 'cafe' }, { serviceFocus: 'raro', businessType: 'cafe' },
  ];
  for (const settings of cases) {
    assert.equal(front.focusFor(settings), focusOf(settings), JSON.stringify(settings));
  }
  assert.equal(limitsFor({ serviceFocus: 'takeaway' }).maxUsers, null, 'ya no hay tope de personas');
});

test('enfoque: cada rol permitido llega a una pantalla de inicio que existe y le sirve', async () => {
  const front = await frontRoles();
  for (const f of front.SERVICE_FOCUSES) {
    for (const role of f.roles) {
      const home = front.homeForRole(role, f.mode);
      assert.ok(front.SCREENS.some((s) => s.name === home), `${role}/${f.id}: la pantalla "${home}" no existe`);
      assert.ok(front.canAccessScreen(home, role, f.mode, f.id), `${role} no puede entrar a su inicio (${home}) en ${f.id}`);
    }
  }
  assert.ok(front.COUNTER_ROLE_COPY.admin.sees.length && front.COUNTER_ROLE_COPY.cashier.sees.length);
});

test('solo para llevar: solo el mostrador, sin ninguna pantalla de salón, ni para el admin', async () => {
  const front = await frontRoles();
  for (const name of ['main', 'kitchen', 'waitlist', 'staff']) {
    for (const role of ['admin', 'cashier', 'waiter', 'kitchen', 'host']) {
      assert.equal(front.canAccessScreen(name, role, 'counter', 'takeaway'), false, `${role} no debería ver "${name}" en solo para llevar`);
    }
  }
  assert.equal(front.canAccessScreen('counter', 'cashier', 'counter', 'takeaway'), true);
  // El menú solo lo edita el admin; el cajero vende desde el mostrador.
  assert.equal(front.canAccessScreen('menu', 'admin', 'counter', 'takeaway'), true);
  assert.equal(front.canAccessScreen('menu', 'cashier', 'counter', 'takeaway'), false);
  for (const name of ['dashboard', 'orders', 'billing', 'printOrder', 'printCash']) {
    assert.equal(front.canAccessScreen(name, 'cashier', 'counter', 'takeaway') || front.canAccessScreen(name, 'admin', 'counter', 'takeaway'), true, name);
  }
  for (const name of ['team', 'settings', 'support']) assert.equal(front.canAccessScreen(name, 'admin', 'counter', 'takeaway'), true, name);
});

test('con meseros: hay mesas y meseros, pero no cocina ni lista de espera', async () => {
  const front = await frontRoles();
  for (const role of ['admin', 'cashier', 'waiter']) {
    assert.equal(front.canAccessScreen('main', role, 'table', 'waiters'), true, `${role} ve las mesas`);
  }
  assert.equal(front.canAccessScreen('menu', 'waiter', 'table', 'waiters'), true, 'el mesero toma el pedido');
  assert.equal(front.canAccessScreen('orders', 'cashier', 'table', 'waiters'), true, 'la caja cobra');
  assert.equal(front.canAccessScreen('staff', 'admin', 'table', 'waiters'), true);
  for (const role of ['admin', 'cashier', 'waiter', 'kitchen', 'host']) {
    assert.equal(front.canAccessScreen('kitchen', role, 'table', 'waiters'), false, `${role} no ve la cocina`);
    assert.equal(front.canAccessScreen('waitlist', role, 'table', 'waiters'), false, `${role} no ve la lista de espera`);
    assert.equal(front.canAccessScreen('counter', role, 'table', 'waiters'), false, `${role} no ve el mostrador`);
  }
});

test('completo: todo el salón sigue igual que siempre', async () => {
  const front = await frontRoles();
  assert.equal(front.canAccessScreen('main', 'waiter', 'table', 'full'), true);
  assert.equal(front.canAccessScreen('kitchen', 'kitchen', 'table', 'full'), true);
  assert.equal(front.canAccessScreen('waitlist', 'host', 'table', 'full'), true);
  assert.equal(front.homeForRole('host', 'table'), 'waitlist');
  assert.equal(front.homeForRole('kitchen', 'table'), 'kitchen');
  assert.equal(front.homeForRole('cashier', 'table'), 'orders');
  // sin enfoque a la mano, el modo da lo de siempre
  assert.equal(front.canAccessScreen('kitchen', 'kitchen', 'table'), true);
  assert.equal(front.canAccessScreen('counter', 'cashier', 'counter'), true);
  for (const role of [...TENANT_ROLES, 'platform_admin']) {
    assert.equal(front.canAccessScreen('counter', role, 'table', 'full'), false, `${role} no debería ver el mostrador en un restaurante`);
  }
  assert.equal(front.homeForRole('platform_admin', 'counter'), 'platform', 'la plataforma no depende del modo');
});

test('cada pantalla declara modos y enfoques válidos, y el mostrador solo existe en modo mostrador', async () => {
  const front = await frontRoles();
  for (const s of front.SCREENS) {
    assert.ok(Array.isArray(s.modes) && s.modes.length, `${s.name} sin modos`);
    for (const m of s.modes) assert.ok(['table', 'counter'].includes(m), `${s.name}: modo "${m}" desconocido`);
    for (const r of s.counterRoles || []) assert.ok(s.roles.includes(r), `${s.name}: counterRoles debe ser un subconjunto de roles`);
    for (const f of s.focuses || []) {
      assert.ok(SERVICE_FOCUSES.includes(f), `${s.name}: enfoque "${f}" desconocido`);
      assert.ok(s.modes.includes(front.modeForFocus(f)), `${s.name}: el enfoque ${f} no encaja con sus modos`);
    }
  }
  assert.deepEqual(front.SCREENS.find((s) => s.name === 'counter').modes, ['counter']);
});
