const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');
const fin = require('../services/platform-finance.service');

// ——— Servicio (funciones puras) ———
test('el mes se calcula en hora de Ciudad de México', () => {
  // 31 de octubre 20:00 en CDMX ya es 1 de noviembre en UTC: sigue contando como octubre
  assert.equal(fin.monthKey(new Date('2026-11-01T02:00:00Z')), '2026-10');
  assert.equal(fin.monthKey(new Date('2026-11-01T07:00:00Z')), '2026-11');
  const r = fin.monthRange('2026-11');
  assert.equal(r.from.toISOString(), '2026-11-01T06:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-12-01T05:59:59.999Z');
  assert.equal(fin.monthRange('2026-13'), null);
  assert.equal(fin.monthRange('hola'), null);
});

test('los últimos 6 meses cruzan el cambio de año', () => {
  assert.deepEqual(fin.recentMonthKeys('2026-02'), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
});

test('buildBooks separa lo cobrado de lo esperado y calcula utilidad y reparto', () => {
  const tenants = [
    { id: 'a', name: 'A', plan: 'basic', billingStatus: 'active', createdAt: '2026-11-03T12:00:00Z' },
    { id: 'b', name: 'B', plan: 'pro', billingStatus: 'active', createdAt: '2026-09-10T12:00:00Z' },
    { id: 'c', name: 'C', plan: 'basic', billingStatus: 'trialing', createdAt: '2026-11-05T12:00:00Z' },
    { id: 'd', name: 'D', plan: 'basic', billingStatus: 'past_due' },
  ];
  const events = [
    { id: '1', tenantId: 'a', type: 'payment', plan: 'basic', amount: 799, months: 1, at: '2026-11-04T12:00:00Z' },
    { id: '2', tenantId: 'b', type: 'payment', plan: 'pro', amount: 1499, months: 1, at: '2026-10-20T12:00:00Z' },
    { id: '3', tenantId: 'a', type: 'support', amount: 0, at: '2026-11-04T12:00:00Z' },
  ];
  const expenses = [
    { id: 'x', month: '2026-11', amount: 300, label: 'Hosting', createdAt: '2026-11-02T12:00:00Z' },
    { id: 'y', month: '2026-10', amount: 100, label: 'Dominio', createdAt: '2026-10-02T12:00:00Z' },
  ];
  const b = fin.buildBooks({ month: '2026-11', tenants, events, expenses, prices: { basic: 799, pro: 1499 }, partners: 2 });
  assert.deepEqual(b.clients, { total: 4, active: 2, trialing: 1, pastDue: 1, suspended: 0 });
  assert.equal(b.expected, 799 + 1499, 'lo esperado: planes activos × precio');
  assert.equal(b.collected, 799, 'solo cuenta lo cobrado dentro del mes');
  assert.equal(b.expensesTotal, 300);
  assert.equal(b.profit, 499);
  assert.equal(b.perPartner, 399.5);
  assert.equal(b.profitPerPartner, 249.5);
  assert.equal(b.payments.length, 1);
  assert.equal(b.byPlan.find((p) => p.id === 'pro').clients, 1);
  assert.equal(b.trend.length, 6);
  const oct = b.trend.find((t) => t.month === '2026-10');
  assert.equal(oct.revenue, 1499);
  assert.equal(oct.profit, 1399);
  assert.equal(b.trend.find((t) => t.month === '2026-11').signups, 2);
});

test('sin socios configurados la utilidad no se divide', () => {
  const b = fin.buildBooks({ month: '2026-11', tenants: [], partners: undefined });
  assert.equal(b.partners, 1);
});

test('el CSV escapa comas y comillas y lleva BOM para Excel', () => {
  const csv = fin.csvOf({ payments: [{ at: '2026-11-04T12:00:00Z', businessName: 'Taquería "El, Güero"', planName: 'Básico', months: 1, amount: 799, note: '' }] });
  assert.ok(csv.startsWith('﻿Fecha,Negocio'));
  assert.ok(csv.includes('"Taquería ""El, Güero"""'));
});

// ——— Rutas ———
const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

state.users.push(
  { _id: new ObjectId(), username: 'root', email: 'root@p.com', password: 'x', role: 'platform_admin', tenantId: null },
  { _id: new ObjectId(), username: 'ayuda', email: 'ayuda@p.com', password: 'x', role: 'platform_support', tenantId: null },
);
const admin = () => tokenFor('root', 'platform_admin', null);
const support = () => tokenFor('ayuda', 'platform_support', null);

test('finanzas, gastos y pagos son solo del admin', async () => {
  for (const [method, url, body] of [
    ['GET', '/platform/finance'],
    ['POST', '/platform/expenses', { label: 'x', amount: 1 }],
    ['DELETE', '/platform/expenses/abc'],
    ['POST', '/platform/tenants/t1/manual-payment', { amount: 1 }],
  ]) {
    assert.equal((await api.call(method, url, { body })).status, 401, `${method} ${url} sin sesión`);
    assert.equal((await api.call(method, url, { token: support(), body })).status, 403, `${method} ${url} soporte`);
    assert.equal((await api.call(method, url, { token: tokenFor('ana', 'admin', 't1'), body })).status, 403, `${method} ${url} negocio`);
  }
});

test('un pago manual activa el negocio, extiende el periodo y suma a lo cobrado', async () => {
  state.tenants[0].billingStatus = 'suspended';
  const r = await api.call('POST', '/platform/tenants/t1/manual-payment', { token: admin(), body: { amount: 1500, months: 2, note: 'Transferencia' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(state.tenants[0].billingStatus, 'active');
  assert.equal(state.tenants[0].suspendedAt, null);
  const expected = new Date();
  expected.setMonth(expected.getMonth() + 2);
  assert.equal(r.json.currentPeriodEnd.slice(0, 10), expected.toISOString().slice(0, 10), 'paga hasta hoy + 2 meses');

  const books = await api.call('GET', '/platform/finance', { token: admin() });
  assert.equal(books.status, 200);
  assert.equal(books.json.collected, 1500);
  assert.equal(books.json.payments[0].businessName, 'T1');
  assert.equal(books.json.payments[0].note, 'Transferencia');

  const log = await api.call('GET', '/platform/tenants/t1/activity', { token: admin() });
  assert.ok(log.json.items.some((i) => i.amount === 1500), 'el cobro aparece en la actividad del cliente');
});

test('un segundo pago suma desde el fin del periodo vigente, no desde hoy', async () => {
  const before = new Date(state.tenants[0].currentPeriodEnd);
  await api.call('POST', '/platform/tenants/t1/manual-payment', { token: admin(), body: { amount: 700, months: 1 } });
  const after = new Date(state.tenants[0].currentPeriodEnd);
  const expected = new Date(before); expected.setMonth(expected.getMonth() + 1);
  assert.equal(after.toISOString(), expected.toISOString());
});

test('el pago manual valida monto, meses y negocio', async () => {
  const pay = (id, body) => api.call('POST', `/platform/tenants/${id}/manual-payment`, { token: admin(), body });
  assert.equal((await pay('t1', { amount: 0 })).status, 400);
  assert.equal((await pay('t1', { amount: 'mucho' })).status, 400);
  assert.equal((await pay('t1', { amount: 100, months: 0 })).status, 400);
  assert.equal((await pay('t1', { amount: 100, months: 1.5 })).status, 400);
  assert.equal((await pay('t1', { amount: 100, months: 37 })).status, 400);
  assert.equal((await pay('nope', { amount: 100 })).status, 404);
});

test('gastos: se crean, restan de la utilidad y se pueden quitar', async () => {
  const bad = await api.call('POST', '/platform/expenses', { token: admin(), body: { label: 'x', amount: 5 } });
  assert.equal(bad.status, 400);
  assert.equal((await api.call('POST', '/platform/expenses', { token: admin(), body: { label: 'Hosting', amount: -3 } })).status, 400);
  const ok = await api.call('POST', '/platform/expenses', { token: admin(), body: { label: 'Hosting', amount: 300 } });
  assert.equal(ok.status, 201, ok.text);
  const books = await api.call('GET', '/platform/finance', { token: admin() });
  assert.equal(books.json.expensesTotal, 300);
  assert.equal(books.json.profit, books.json.collected - 300);
  assert.equal((await api.call('DELETE', `/platform/expenses/${ok.json.id}`, { token: admin() })).status, 200);
  assert.equal((await api.call('DELETE', `/platform/expenses/${ok.json.id}`, { token: admin() })).status, 404);
});

test('el mes se valida y el CSV se descarga', async () => {
  assert.equal((await api.call('GET', '/platform/finance?month=2026-13', { token: admin() })).status, 400);
  const res = await fetch(`${api.base}/platform/finance?format=csv`, { headers: { Authorization: admin() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /cobros_\d{4}-\d{2}\.csv/);
  assert.match(await res.text(), /Fecha,Negocio,Plan,Meses,Monto,Nota/);
});
