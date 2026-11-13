/**
 * Números de la plataforma: lo realmente cobrado, gastos, utilidad y tendencia.
 * Lo cobrado sale del registro de cobros (`billing_events`, tipo `payment`), no de una estimación por plan;
 * lo "esperado" sí es una estimación: los planes activos × su precio.
 * Funciones puras: reciben lo que ya leyó la base.
 */

// Ciudad de México no tiene horario de verano desde 2022: UTC-6 todo el año.
const TZ_OFFSET_HOURS = 6;
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TREND_MONTHS = 6;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** «AAAA-MM» de una fecha, en hora de Ciudad de México. */
function monthKey(date = new Date()) {
  return new Date(new Date(date).getTime() - TZ_OFFSET_HOURS * 3600 * 1000).toISOString().slice(0, 7);
}

/** Rango [from, to] de un mes «AAAA-MM» en hora de Ciudad de México (null si el texto no es válido). */
function monthRange(key) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key || ''));
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return {
    from: new Date(Date.UTC(y, mo - 1, 1, TZ_OFFSET_HOURS)),
    to: new Date(Date.UTC(y, mo, 1, TZ_OFFSET_HOURS) - 1),
  };
}

/** Los últimos `count` meses terminando en `current`, del más viejo al más nuevo. */
function recentMonthKeys(current, count = TREND_MONTHS) {
  const [year, month] = String(current).split('-').map(Number);
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function addTo(map, key, amount) {
  if (key) map.set(key, (map.get(key) || 0) + amount);
}

/**
 * @param month     «AAAA-MM» que se está mirando
 * @param tenants   negocios
 * @param names     Map tenantId → nombre del negocio
 * @param events    cobros (type payment) de la ventana de la tendencia
 * @param expenses  gastos de la ventana ({ month, amount, ... })
 * @param prices    { basic: n, pro: n } precio mensual de cada plan
 * @param commissions comisiones de vendedores generadas en el mes (referral.commissionsBook); salen de la utilidad antes de repartirla
 * @param partners  cuántos socios se reparten la utilidad (partes iguales)
 */
function buildBooks({ month, tenants, names = new Map(), events = [], expenses = [], prices = {}, commissions = null, partners = 1 }) {
  const range = monthRange(month);
  const planNames = { basic: 'Básico', pro: 'Pro' };
  const nameOf = (t) => names.get(String(t.id)) || t.name || 'Sin nombre';

  const clients = { total: tenants.length, active: 0, trialing: 0, pastDue: 0, suspended: 0 };
  const byPlan = Object.fromEntries(Object.keys(planNames).map((id) => [id, { clients: 0, amount: 0 }]));
  const payers = [];
  const signups = new Map();
  for (const t of tenants) {
    const status = t.billingStatus || 'trialing';
    if (status === 'active') clients.active += 1;
    else if (status === 'past_due') clients.pastDue += 1;
    else if (status === 'suspended') clients.suspended += 1;
    else clients.trialing += 1;
    if (t.createdAt) addTo(signups, monthKey(t.createdAt), 1);
    if (status === 'active') {
      const plan = byPlan[t.plan] ? t.plan : 'basic';
      const amount = Number(prices[plan]) || 0;
      byPlan[plan].clients += 1;
      byPlan[plan].amount += amount;
      payers.push({ id: t.id, businessName: nameOf(t), plan, planName: planNames[plan], amount });
    }
  }
  payers.sort((a, b) => b.amount - a.amount);
  const expected = round2(payers.reduce((sum, p) => sum + p.amount, 0));

  const paid = events.filter((e) => Number(e.amount) > 0);
  const inMonth = paid.filter((e) => range && new Date(e.at) >= range.from && new Date(e.at) <= range.to);
  const payments = inMonth
    .map((e) => ({
      id: String(e.id),
      at: e.at,
      tenantId: String(e.tenantId),
      businessName: names.get(String(e.tenantId)) || 'Negocio eliminado',
      planName: planNames[e.plan] || '',
      months: e.months || null,
      amount: round2(e.amount),
      note: e.note || '',
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const collected = round2(payments.reduce((sum, p) => sum + p.amount, 0));

  const monthExpenses = expenses.filter((e) => e.month === month);
  const expensesTotal = round2(monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0));
  const commissionsTotal = round2(commissions ? commissions.total : 0);
  const profit = round2(collected - expensesTotal - commissionsTotal);

  const revenueBy = new Map();
  paid.forEach((e) => addTo(revenueBy, monthKey(e.at), Number(e.amount)));
  const spentBy = new Map();
  expenses.forEach((e) => addTo(spentBy, e.month, Number(e.amount)));
  const trend = recentMonthKeys(month).map((key) => {
    const revenue = round2(revenueBy.get(key) || 0);
    const spent = round2(spentBy.get(key) || 0);
    return {
      month: key,
      label: SHORT_MONTHS[Number(key.slice(5, 7)) - 1] || key,
      revenue,
      expenses: spent,
      profit: round2(revenue - spent),
      signups: signups.get(key) || 0,
    };
  });

  const n = Math.max(1, Math.floor(Number(partners)) || 1);
  return {
    month,
    clients,
    collected,
    expected,
    expensesTotal,
    commissions: commissions
      ? { total: commissionsTotal, pending: round2(commissions.pending), paid: round2(commissions.paid), count: commissions.count || 0, bySeller: commissions.bySeller || [] }
      : { total: 0, pending: 0, paid: 0, count: 0, bySeller: [] },
    profit,
    byPlan: Object.keys(planNames).map((id) => ({
      id,
      name: planNames[id],
      price: Number(prices[id]) || 0,
      clients: byPlan[id].clients,
      amount: round2(byPlan[id].amount),
    })),
    payers,
    payments,
    expenses: monthExpenses
      .map((e) => ({ id: String(e.id), label: e.label, amount: round2(e.amount), note: e.note || '', createdAt: e.createdAt }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    trend,
    partners: n,
    perPartner: round2(collected / n),
    profitPerPartner: round2(profit / n),
  };
}

function csvOf(books) {
  const cell = (v) => {
    const t = String(v ?? '');
    return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = books.payments.map((p) =>
    [new Date(p.at).toISOString().slice(0, 10), p.businessName, p.planName, p.months || '', p.amount.toFixed(2), p.note].map(cell).join(',')
  );
  return '﻿' + ['Fecha,Negocio,Plan,Meses,Monto,Nota', ...rows].join('\n');
}

module.exports = { monthKey, monthRange, recentMonthKeys, buildBooks, csvOf, round2, TREND_MONTHS };
