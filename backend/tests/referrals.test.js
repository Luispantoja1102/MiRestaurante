const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');
const tiers = require('../services/referral.tiers');

// ——— Escalera de comisiones (pura) ———
test('la escalera sube con las ventas cerradas y tiene techo', () => {
  assert.equal(tiers.rateFor(0), 0.15);
  assert.equal(tiers.rateFor(4), 0.15);
  assert.equal(tiers.rateFor(5), 0.17);
  assert.equal(tiers.rateFor(20), 0.21);
  assert.equal(tiers.rateFor(50), 0.25);
  assert.equal(tiers.rateFor(500), 0.25);
  assert.equal(tiers.rateFor(-3), 0.15);
  assert.deepEqual(tiers.nextTierFor(3), { from: 5, rate: 0.17, missing: 2 });
  assert.equal(tiers.nextTierFor(50), null);
  assert.deepEqual(tiers.commissionFor(799, 1), { rate: 0.15, commission: 119.85 });
});

// ——— Rutas ———
const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const user = (over) => ({ _id: new ObjectId(), name: 'N', lastName: 'L', password: 'x', cellphone: '5555555555', ...over });
state.users.push(
  user({ username: 'root', email: 'root@p.com', role: 'platform_admin', tenantId: null }),
  user({ username: 'ayuda', email: 'ayuda@p.com', role: 'platform_support', tenantId: null }),
  user({ username: 'ana', email: 'ana@t1.com', role: 'admin', tenantId: 't1' }),
);
const admin = () => tokenFor('root', 'platform_admin', null);
const support = () => tokenFor('ayuda', 'platform_support', null);
const call = (method, url, token, body) => api.call(method, url, { token, body });

const seller = (over = {}) => ({ name: 'Vera Vendedora', email: 'vera@ventas.com', phone: '5512345678', ...over });
const addTenant = (id, over = {}) => { state.tenants.push({ id, name: id, plan: 'basic', billingStatus: 'trialing', createdAt: new Date(), ...over }); };
let vera;

test('crear vendedores es solo del admin y valida sus datos', async () => {
  assert.equal((await call('POST', '/platform/referrers', support(), seller())).status, 403);
  assert.equal((await call('GET', '/platform/referrers', support())).status, 403);
  assert.equal((await call('POST', '/platform/referrers', admin(), seller({ name: 'x' }))).status, 400);
  assert.equal((await call('POST', '/platform/referrers', admin(), seller({ email: 'no-es-correo' }))).status, 400);
  assert.equal((await call('POST', '/platform/referrers', admin(), seller({ payoutClabe: '12345' }))).status, 400);

  const r = await call('POST', '/platform/referrers', admin(), seller());
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.code, /^MR-[A-Z0-9]{6}$/);
  assert.equal(r.json.status, 'active');
  assert.equal(r.json.rate, 0.15);
  vera = r.json;
  assert.equal((await call('POST', '/platform/referrers', admin(), seller())).status, 409, 'correo repetido');
});

test('asignar un vendedor a un negocio valida el código y se puede quitar', async () => {
  addTenant('n1');
  assert.equal((await call('PUT', '/platform/tenants/n1/referrer', admin(), { code: 'MR-ZZZZZZ' })).status, 400);
  assert.equal((await call('PUT', '/platform/tenants/n1/referrer', support(), { code: vera.code })).status, 403);
  const ok = await call('PUT', '/platform/tenants/n1/referrer', admin(), { code: vera.code.toLowerCase() });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.seller, 'Vera Vendedora');
  assert.equal(state.tenants.find((t) => t.id === 'n1').referrerId, vera.id);
  const card = await call('GET', '/platform/tenants/n1', admin());
  assert.equal(card.json.referrer.code, vera.code);

  // un vendedor pausado no sirve para asignar
  await call('PATCH', `/platform/referrers/${vera.id}`, admin(), { status: 'paused' });
  assert.equal((await call('PUT', '/platform/tenants/n1/referrer', admin(), { code: vera.code })).status, 400);
  await call('PATCH', `/platform/referrers/${vera.id}`, admin(), { status: 'active' });

  addTenant('n0');
  await call('PUT', '/platform/tenants/n0/referrer', admin(), { code: vera.code });
  const none = await call('PUT', '/platform/tenants/n0/referrer', admin(), { code: '' });
  assert.equal(none.json.referrerId, null);
});

test('un cobro de un negocio referido genera comisión del 15% y no se duplica la venta cerrada', async () => {
  const pay = (id, amount) => call('POST', `/platform/tenants/${id}/manual-payment`, admin(), { amount, months: 1 });
  const first = await pay('n1', 799);
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.commission.commission, 119.85);
  assert.equal(first.json.commission.rate, 0.15);
  assert.equal(first.json.commission.closedSales, 1);
  const second = await pay('n1', 799);
  assert.equal(second.json.commission.closedSales, 1, 'mismo negocio: sigue siendo una venta cerrada');
  const d = (await call('GET', `/platform/referrers/${vera.id}`, admin())).json;
  assert.equal(d.pending, 239.7);
  assert.equal(d.closedSales, 1);
  assert.equal(d.clients, 1);
  assert.equal(d.commissions.length, 2);
  // un negocio sin vendedor no genera nada
  addTenant('libre');
  assert.equal((await pay('libre', 500)).json.commission, null);
});

test('al llegar a 5 ventas cerradas la tasa sube a 17% solo para los cobros nuevos', async () => {
  for (const id of ['n2', 'n3', 'n4', 'n5']) {
    addTenant(id);
    await call('PUT', `/platform/tenants/${id}/referrer`, admin(), { code: vera.code });
    const r = await call('POST', `/platform/tenants/${id}/manual-payment`, admin(), { amount: 1000, months: 1 });
    assert.equal(r.json.commission.rate, id === 'n5' ? 0.17 : 0.15, `${id}`);
  }
  const d = (await call('GET', `/platform/referrers/${vera.id}`, admin())).json;
  assert.equal(d.closedSales, 5);
  assert.equal(d.rate, 0.17);
  assert.equal(d.tier, 1);
  assert.deepEqual(d.next, { from: 10, rate: 0.19, missing: 5 });
  const old = d.commissions.find((c) => c.tenantId === 'n1');
  assert.equal(old.rate, 0.15, 'las comisiones ya generadas no cambian');
});

test('anular comisiones y liquidar al vendedor', async () => {
  const before = (await call('GET', `/platform/referrers/${vera.id}`, admin())).json;
  const target = before.commissions.find((c) => c.tenantId === 'n2');
  assert.equal((await call('POST', `/platform/commissions/${target.id}/void`, support(), {})).status, 403);
  assert.equal((await call('POST', `/platform/commissions/${target.id}/void`, admin(), { reason: 'cobro devuelto' })).status, 200);
  const mid = (await call('GET', `/platform/referrers/${vera.id}`, admin())).json;
  assert.equal(mid.closedSales, 4, 'una venta anulada ya no cuenta');
  assert.equal(mid.pending, before.pending - target.commission);

  const payout = await call('POST', `/platform/referrers/${vera.id}/payouts`, admin(), { note: 'SPEI' });
  assert.equal(payout.status, 201, payout.text);
  const after = payout.json;
  assert.equal(after.pending, 0);
  assert.equal(after.paid, mid.pending);
  assert.equal(after.payouts.length, 1);
  assert.equal(after.payouts[0].total, mid.pending);

  assert.equal((await call('POST', `/platform/referrers/${vera.id}/payouts`, admin(), {})).status, 409, 'nada pendiente');
  const paid = after.commissions.find((c) => c.status === 'paid');
  assert.equal((await call('POST', `/platform/commissions/${paid.id}/void`, admin(), {})).status, 409, 'una comisión pagada no se anula');
});

test('las comisiones del mes se descuentan de la utilidad en finanzas', async () => {
  const books = (await call('GET', '/platform/finance', admin())).json;
  assert.ok(books.commissions.total > 0);
  assert.equal(books.profit, Math.round((books.collected - books.expensesTotal - books.commissions.total) * 100) / 100);
  assert.equal(books.commissions.bySeller[0].name, 'Vera Vendedora');
});

test('el código de vendedor al registrarse: se valida antes de crear nada y liga el negocio', async () => {
  const body = (over = {}) => ({ name: 'Luis', lastName: 'Nuevo', email: 'luis@nuevo.com', username: 'luis', password: 'Clave12345', cellphone: '5511112222', businessName: 'Taquería Luis', ...over });
  const tenantsBefore = state.tenants.length;
  const bad = await call('POST', '/usuarios/register', null, body({ referralCode: 'MR-NOEXIS' }));
  assert.equal(bad.status, 400);
  assert.equal(state.tenants.length, tenantsBefore, 'un código inválido no deja un negocio a medias');
  const own = await call('POST', '/usuarios/register', null, body({ referralCode: vera.code, email: 'vera@ventas.com', username: 'otro' }));
  assert.equal(own.status, 400, 'no puede usar su propio código');

  const ok = await call('POST', '/usuarios/register', null, body({ referralCode: vera.code }));
  assert.equal(ok.status, 201, ok.text);
  const tenant = state.tenants.find((t) => t.id === ok.json.tenantId);
  assert.equal(tenant.referrerId, vera.id);
  assert.equal(tenant.referralCode, vera.code);

  const plain = await call('POST', '/usuarios/register', null, body({ username: 'sin', email: 'sin@codigo.com' }));
  assert.equal(plain.status, 201);
  assert.equal(state.tenants.find((t) => t.id === plain.json.tenantId).referrerId, undefined);

  assert.deepEqual((await call('GET', `/usuarios/referral/${vera.code}`)).json, { valid: true, code: vera.code, seller: 'Vera Vendedora' });
  assert.equal((await call('GET', '/usuarios/referral/MR-NOEXIS')).json.valid, false);
});

// ——— Mi código de vendedor (admin de la plataforma) ———
test('el admin activa su propio código de vendedor con el correo de su cuenta', async () => {
  state.users.push(user({ name: 'Rosa', lastName: 'Admin', username: 'rosa', email: 'rosa@p.com', role: 'platform_admin', tenantId: null, cellphone: '5599998888' }));
  const rosa = tokenFor('rosa', 'platform_admin', null);

  assert.equal((await call('GET', '/platform/my-seller', support())).status, 403);
  assert.equal((await call('POST', '/platform/my-seller', support())).status, 403);
  assert.equal((await call('POST', '/platform/my-seller', tokenFor('ana', 'admin', 't1'))).status, 403);

  const before = await call('GET', '/platform/my-seller', rosa);
  assert.deepEqual(before.json, { linked: false, seller: null });

  const count = state.referrers.length;
  const a = await call('POST', '/platform/my-seller', rosa);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.linked, true);
  assert.match(a.json.seller.code, /^MR-[A-Z0-9]{6}$/);
  assert.equal(a.json.seller.email, 'rosa@p.com');
  assert.equal(a.json.seller.name, 'Rosa Admin');
  assert.equal(a.json.seller.isOwner, true);
  assert.equal(state.referrers.length, count + 1);

  // activarlo otra vez devuelve el mismo, no crea otro
  const b = await call('POST', '/platform/my-seller', rosa);
  assert.equal(b.json.seller.code, a.json.seller.code);
  assert.equal(state.referrers.length, count + 1);
  assert.equal((await call('GET', '/platform/my-seller', rosa)).json.seller.id, a.json.seller.id);

  // otro admin no ve el código de Rosa
  assert.equal((await call('GET', '/platform/my-seller', admin())).json.linked, false);

  // su código sirve para referir, pero no con su propio correo
  const code = a.json.seller.code;
  const reg = (over) => call('POST', '/usuarios/register', null, { name: 'Z', lastName: 'Z', email: 'z@z.com', username: 'zeta', password: 'Clave12345', cellphone: '5511112222', referralCode: code, ...over });
  assert.equal((await reg({ email: 'rosa@p.com', username: 'zeta2' })).status, 400);
  const ok = await reg({});
  assert.equal(ok.status, 201, ok.text);
  assert.equal(state.tenants.find((t) => t.id === ok.json.tenantId).referrerId, a.json.seller.id);
});

test('si ya existía un vendedor con el correo del admin, se liga ese mismo y no se duplica', async () => {
  state.users.push(user({ name: 'Omar', lastName: 'Admin', username: 'omar', email: 'omar@ventas.com', role: 'platform_admin', tenantId: null }));
  const created = await call('POST', '/platform/referrers', admin(), { name: 'Omar Ventas', email: 'omar@ventas.com' });
  assert.equal(created.status, 201);
  const count = state.referrers.length;
  const r = await call('POST', '/platform/my-seller', tokenFor('omar', 'platform_admin', null));
  assert.equal(r.status, 200);
  assert.equal(r.json.seller.id, created.json.id, 'liga el vendedor existente');
  assert.equal(r.json.seller.name, 'Omar Ventas', 'respeta sus datos');
  assert.equal(state.referrers.length, count);
});

// ——— Portal de socios ———
let partnerA;
let partnerB;
test('el admin da de alta un vendedor con su acceso de dueño en un solo paso', async () => {
  const r = await call('POST', '/platform/referrers', admin(), {
    ...seller({ name: 'Pablo Socio', email: 'pablo@socio.com' }),
    access: { username: 'pablo', password: 'ClaveSegura1' },
  });
  assert.equal(r.status, 201, r.text);
  partnerA = r.json;
  const owner = state.users.find((u) => u.username === 'pablo');
  assert.equal(owner.role, 'partner_admin');
  assert.equal(owner.partnerId, partnerA.id);
  assert.equal(owner.tenantId, null);
  assert.match(owner.password, /^\$2[aby]\$/);

  // si el acceso es inválido no queda un vendedor a medias
  const count = state.referrers.length;
  const weak = await call('POST', '/platform/referrers', admin(), { ...seller({ name: 'Otro Socio', email: 'otro@socio.com' }), access: { username: 'otro', password: 'corta' } });
  assert.equal(weak.status, 400);
  assert.equal(state.referrers.length, count);
  const dup = await call('POST', '/platform/referrers', admin(), { ...seller({ name: 'Otro Socio', email: 'otro@socio.com' }), access: { username: 'pablo', password: 'ClaveSegura1' } });
  assert.equal(dup.status, 409);
  assert.equal(state.referrers.length, count);

  const b = await call('POST', '/platform/referrers', admin(), { ...seller({ name: 'Bea Socia', email: 'bea@socia.com' }), access: { username: 'bea', password: 'ClaveSegura2' } });
  partnerB = b.json;
});

test('un socio solo ve sus propios negocios', async () => {
  addTenant('pa1', { referrerId: partnerA.id, referralCode: partnerA.code, name: 'Cafe de Pablo' });
  addTenant('pb1', { referrerId: partnerB.id, referralCode: partnerB.code, name: 'Cafe de Bea' });
  const pablo = tokenFor('pablo', 'partner_admin', null);

  const clients = await call('GET', '/partner/clients', pablo);
  assert.equal(clients.status, 200, clients.text);
  assert.deepEqual(clients.json.map((c) => c.id), ['pa1']);
  assert.equal((await call('GET', '/partner/clients/pa1', pablo)).status, 200);
  assert.equal((await call('GET', '/partner/clients/pb1', pablo)).status, 404, 'no ve los negocios de otro socio');
  assert.equal((await call('POST', '/partner/clients/pb1/notes', pablo, { text: 'intento' })).status, 404);

  const home = await call('GET', '/partner/home', pablo);
  assert.equal(home.json.counts.total, 1);
  assert.equal(home.json.partner.code, partnerA.code);
  assert.ok(home.json.money, 'el dueño ve el dinero');
});

test('quien no es socio no entra al portal, y un socio no entra a lo demás', async () => {
  for (const token of [undefined, tokenFor('ana', 'admin', 't1'), admin(), support()]) {
    assert.ok([401, 403].includes((await call('GET', '/partner/home', token)).status));
  }
  const pablo = tokenFor('pablo', 'partner_admin', null);
  assert.equal((await call('GET', '/platform/tenants', pablo)).status, 403);
  assert.equal((await call('GET', '/platform/referrers', pablo)).status, 403);
  assert.equal((await call('GET', '/team', pablo)).status, 403);
  assert.equal((await call('GET', '/orders', pablo)).status, 403);
});

test('notas, asignación y equipo del socio', async () => {
  const pablo = tokenFor('pablo', 'partner_admin', null);
  const note = await call('POST', '/partner/clients/pa1/notes', pablo, { text: 'Llamé al dueño, quiere demo' });
  assert.equal(note.status, 201);
  assert.equal((await call('POST', '/partner/clients/pa1/notes', pablo, { text: 'x' })).status, 400);
  assert.equal((await call('GET', '/partner/clients/pa1', pablo)).json.notes.length, 1);

  const member = await call('POST', '/partner/team', pablo, { name: 'Ana', lastName: 'Asesora', email: 'ana@socio.com', username: 'anaasesora', password: 'ClaveSegura3', role: 'partner_staff' });
  assert.equal(member.status, 201, member.text);
  assert.equal(state.users.find((u) => u.username === 'anaasesora').partnerId, partnerA.id);
  assert.equal((await call('PUT', '/partner/clients/pa1/assignee', pablo, { username: 'anaasesora' })).status, 200);
  assert.equal((await call('PUT', '/partner/clients/pa1/assignee', pablo, { username: 'bea' })).status, 400, 'solo gente de su equipo');

  const staff = tokenFor('anaasesora', 'partner_staff', null);
  assert.equal((await call('GET', '/partner/clients', staff)).status, 200);
  assert.equal((await call('GET', '/partner/clients/pa1', staff)).json.commissions, null, 'el asesor no ve dinero');
  assert.equal((await call('GET', '/partner/home', staff)).json.money, undefined);
  for (const [method, url, body] of [['GET', '/partner/commissions'], ['POST', '/partner/team', {}], ['PUT', '/partner/clients/pa1/assignee', { username: null }]]) {
    assert.equal((await call(method, url, staff, body)).status, 403, `${method} ${url}`);
  }
});

test('desactivar a alguien le corta el acceso, y siempre queda un dueño', async () => {
  const pablo = tokenFor('pablo', 'partner_admin', null);
  const staff = tokenFor('anaasesora', 'partner_staff', null);
  const asesora = state.users.find((u) => u.username === 'anaasesora');
  assert.equal((await call('PUT', `/partner/team/${asesora._id}/deactivate`, pablo)).status, 200);
  assert.equal((await call('GET', '/partner/clients', staff)).status, 403, 'su sesión vieja ya no sirve');
  assert.equal(state.tenants.find((t) => t.id === 'pa1').partnerAssignee, null, 'sus negocios quedan sin responsable');
  assert.equal((await call('PUT', `/partner/team/${asesora._id}/reactivate`, pablo)).status, 200);
  assert.equal((await call('GET', '/partner/clients', staff)).status, 200);

  // cambiar el rol de un asesor a dueño y luego intentar dejar al socio sin dueños
  assert.equal((await call('PUT', `/partner/team/${asesora._id}/role`, pablo, { role: 'partner_admin' })).status, 200);
  const pabloUser = state.users.find((u) => u.username === 'pablo');
  const otherOwner = tokenFor('anaasesora', 'partner_admin', null);
  assert.equal((await call('PUT', `/partner/team/${pabloUser._id}/deactivate`, otherOwner)).status, 200, 'queda ella como dueña');
  const last = await call('PUT', `/partner/team/${pabloUser._id}/role`, otherOwner, { role: 'partner_staff' });
  assert.equal(last.status, 200, 'pablo ya estaba desactivado: cambiarle el rol no deja sin dueños');
  assert.equal((await call('PUT', `/partner/team/${asesora._id}/deactivate`, pablo)).status, 403, 'pablo ya no tiene permiso');
});

test('un socio desactivado o con otro rol no puede ni iniciar sesión', async () => {
  const bea = state.users.find((u) => u.username === 'bea');
  bea.disabled = true;
  const r = await call('GET', '/partner/home', tokenFor('bea', 'partner_admin', null));
  assert.equal(r.status, 403);
});

test('la lista de vendedores trae totales y las cuentas del portal por vendedor', async () => {
  const list = await call('GET', '/platform/referrers', admin());
  assert.equal(list.status, 200);
  assert.ok(list.json.totals.sellers >= 3);
  assert.ok(list.json.items.some((i) => i.code === vera.code && i.clients >= 5));
  const users = await call('GET', `/platform/referrers/${partnerA.id}/users`, admin());
  // Pablo quedó como asesor en la prueba anterior; la dueña ahora es Ana
  assert.deepEqual(users.json.map((u) => `${u.username}:${u.roleName}`).sort(), ['anaasesora:Dueño', 'pablo:Asesor']);
});
