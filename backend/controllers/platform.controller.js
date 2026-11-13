const db = require('../database/mongodb');
const { PLANS, BILLING_STATUSES, trialEndsFrom } = require('../models/tenant.model');
const { PLATFORM_ROLES } = require('../models/roles');
const hasher = require('../utils/bcrypt.utils');
const audit = require('../services/platform-audit.service');
const finance = require('../services/platform-finance.service');
const mp = require('../services/mercadopago.service');
const referrals = require('../services/referral.service');
const partners = require('../services/partner.service');
const support = require('../services/support.service');

const PLAN_NAMES = { basic: 'Básico', pro: 'Pro' };
const STATUS_NAMES = {
  trialing: 'Prueba',
  active: 'Activo',
  past_due: 'Pago atrasado',
  suspended: 'Suspendido',
};
const STAFF_ROLE_NAMES = { platform_admin: 'Admin', platform_support: 'Soporte' };
const DAY_MS = 24 * 60 * 60 * 1000;
// Una prueba que vence pronto merece que alguien escriba al cliente
const TRIAL_WARNING_DAYS = 3;

const ownerOf = (users) => users.find((user) => user.role === 'admin') || users[0] || null;

function dateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

const latestLogin = (users) =>
  users.reduce((latest, user) => {
    const at = user.lastLoginAt ? new Date(user.lastLoginAt) : null;
    return at && (!latest || at > latest) ? at : latest;
  }, null);

/**
 * Ficha de un cliente. `pre` trae lo ya leído en lote (lista de clientes) para no hacer
 * dos consultas por negocio.
 */
async function clientCard(tenant, { withUsers = false, pre = null } = {}) {
  const [settings, users] = pre
    ? [pre.settings.get(String(tenant.id)) || null, pre.users.get(String(tenant.id)) || []]
    : await Promise.all([db.GetSettings(tenant.id), db.ListUsersByTenants([tenant.id]).then((m) => m.get(String(tenant.id)) || [])]);
  const owner = ownerOf(users);
  const plan = tenant.plan || 'basic';
  const status = tenant.billingStatus || 'trialing';
  const card = {
    id: tenant.id,
    businessName: settings?.businessName || tenant.name || 'Sin nombre',
    businessType: settings?.businessType || '',
    phone: settings?.phone || owner?.cellphone || '',
    address: settings?.address || '',
    plan,
    planName: PLAN_NAMES[plan] || 'Básico',
    billingStatus: status,
    billingStatusName: STATUS_NAMES[status] || 'Prueba',
    trialEndsAt: tenant.trialEndsAt || null,
    trialEndsOn: dateInput(tenant.trialEndsAt),
    currentPeriodEnd: tenant.currentPeriodEnd || null,
    suspendedReason: tenant.suspendedReason || '',
    mpPayerEmail: tenant.mpPayerEmail || '',
    createdAt: tenant.createdAt || null,
    lastSeenAt: latestLogin(users),
    usersCount: users.length,
    ownerName: owner ? `${owner.name || ''} ${owner.lastName || ''}`.trim() : '',
    ownerEmail: owner?.email || '',
    ownerUsername: owner?.username || '',
    ownerPhone: owner?.cellphone || '',
    referrerId: tenant.referrerId || null,
    referralCode: tenant.referralCode || '',
  };
  if (withUsers) {
    card.users = users.map((u) => ({
      id: u.id || String(u._id || ''),
      name: u.name || '',
      lastName: u.lastName || '',
      username: u.username || '',
      email: u.email || '',
      role: u.role || '',
      createdAt: u.createdAt || null,
      lastLoginAt: u.lastLoginAt || null,
    }));
  }
  return card;
}

async function listTenants(req, res) {
  try {
    const tenants = await db.ListTenants();
    const ids = tenants.map((t) => t.id);
    const [settings, users] = await Promise.all([db.GetSettingsMany(ids), db.ListUsersByTenants(ids)]);
    const pre = { settings, users };
    const { map: waiting } = await support.waitingByTenant();
    const cards = await Promise.all(tenants.map((tenant) => clientCard(tenant, { pre })));
    // Cuántos tickets de cada negocio esperan respuesta del equipo
    return res.status(200).json(cards.map((card) => ({ ...card, waiting: waiting.get(String(card.id)) || 0 })));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude cargar los clientes.');
  }
}

async function getTenant(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    const [card, usage, referrer] = await Promise.all([
      clientCard(tenant, { withUsers: true }),
      db.CountTenantUsage(tenant.id).catch(() => null),
      referrals.brief(tenant.referrerId).catch(() => null),
    ]);
    return res.status(200).json({ ...card, usage, referrer });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude abrir ese cliente.');
  }
}

async function updateTenant(req, res) {
  try {
    const current = await db.GetTenantById(req.params.id);
    if (!current) return res.status(404).send('No encontré ese cliente.');
    const tenant = { ...current }; // foto de "antes" para la bitácora

    const body = req.body || {};
    const businessName = String(body.businessName || '').trim();
    if (businessName.length < 2) return res.status(400).send('Escribe el nombre del negocio.');

    const plan = String(body.plan || tenant.plan || 'basic');
    if (!PLANS.includes(plan)) return res.status(400).send('Ese plan no existe.');

    const billingStatus = String(body.billingStatus || tenant.billingStatus || 'trialing');
    if (!BILLING_STATUSES.includes(billingStatus)) return res.status(400).send('Ese estado no existe.');

    const patch = { name: businessName, plan, billingStatus };
    if (body.trialEndsOn) {
      const trial = new Date(`${body.trialEndsOn}T12:00:00`);
      if (Number.isNaN(trial.getTime())) return res.status(400).send('La fecha de prueba no es válida.');
      patch.trialEndsAt = trial;
    }
    if (billingStatus === 'suspended') {
      patch.suspendedAt = tenant.suspendedAt || new Date();
      patch.suspendedReason = String(body.suspendedReason || tenant.suspendedReason || 'soporte').slice(0, 200);
    } else {
      patch.suspendedAt = null;
      patch.suspendedReason = null;
    }
    if (billingStatus === 'active' && !tenant.currentPeriodEnd) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      patch.currentPeriodEnd = periodEnd;
    }

    await db.UpdateTenant(tenant.id, patch);
    const changes = audit.describeChanges(tenant, { ...tenant, ...patch }, { plan: PLAN_NAMES, status: STATUS_NAMES });
    if (changes.length) {
      await audit.record(req, {
        tenantId: tenant.id,
        type: 'tenant_updated',
        message: `Cambió ${changes.join(', ')}`,
        meta: { changes },
      });
    }
    // Teléfono y dirección viven en los ajustes del negocio; si aún no los configuró, no se crean a medias
    if (await db.GetSettings(tenant.id)) {
      await db.UpdateSettings(
        {
          businessName,
          phone: String(body.phone || '').trim().slice(0, 30),
          address: String(body.address || '').trim().slice(0, 200),
          updatedAt: new Date(),
        },
        tenant.id
      );
    }

    return res.status(200).json(await clientCard(await db.GetTenantById(tenant.id), { withUsers: true }));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude guardar los cambios.');
  }
}

async function suspend(req, res) {
  try {
    const reason = String(req.body?.reason || 'manual').slice(0, 200);
    const updated = await db.UpdateTenant(req.params.id, {
      billingStatus: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: reason,
    });
    if (!updated) return res.status(404).send('Tenant no encontrado');
    await audit.record(req, {
      tenantId: req.params.id,
      type: 'tenant_suspended',
      message: `Suspendió el negocio (${reason})`,
      meta: { reason },
    });
    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al suspender');
  }
}

async function reactivate(req, res) {
  try {
    const mode = String(req.body?.mode || 'active'); // active | trial
    const patch = { suspendedAt: null, suspendedReason: null };
    if (mode === 'trial') {
      patch.billingStatus = 'trialing';
      patch.trialEndsAt = trialEndsFrom(new Date());
    } else {
      patch.billingStatus = 'active';
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      patch.currentPeriodEnd = periodEnd;
    }
    const updated = await db.UpdateTenant(req.params.id, patch);
    if (!updated) return res.status(404).send('Tenant no encontrado');
    await audit.record(req, {
      tenantId: req.params.id,
      type: 'tenant_reactivated',
      message: mode === 'trial' ? 'Reactivó el negocio con una prueba nueva' : 'Reactivó el negocio',
      meta: { mode },
    });
    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al reactivar');
  }
}

async function setPlan(req, res) {
  try {
    const plan = String(req.body?.plan || '');
    if (!PLANS.includes(plan)) return res.status(400).send('plan debe ser basic o pro');
    const current = await db.GetTenantById(req.params.id);
    if (!current) return res.status(404).send('Tenant no encontrado');
    const tenant = { ...current }; // foto de "antes" para la bitácora
    const updated = await db.UpdateTenant(req.params.id, { plan });
    if (!updated) return res.status(404).send('Tenant no encontrado');
    await audit.record(req, {
      tenantId: req.params.id,
      type: 'tenant_plan_changed',
      message: `Cambió el plan ${PLAN_NAMES[tenant.plan] || tenant.plan} → ${PLAN_NAMES[plan] || plan}`,
      meta: { from: tenant.plan, to: plan },
    });
    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cambiar plan');
  }
}

/**
 * Resumen del día: cuántos clientes hay por estado y a quién hay que atender hoy
 * (pruebas por vencer, pagos atrasados, negocios suspendidos, altas recientes).
 */
async function overview(req, res) {
  try {
    const tenants = await db.ListTenants();
    const ids = tenants.map((t) => t.id);
    const [settings, users] = await Promise.all([db.GetSettingsMany(ids), db.ListUsersByTenants(ids)]);
    const nameOf = (t) => settings.get(String(t.id))?.businessName || t.name || 'Sin nombre';
    const now = Date.now();
    const clients = { total: tenants.length, active: 0, trialing: 0, pastDue: 0, suspended: 0 };
    const attention = [];
    let signupsWeek = 0;
    let signupsMonth = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    for (const t of tenants) {
      const status = t.billingStatus || 'trialing';
      if (status === 'active') clients.active += 1;
      else if (status === 'past_due') clients.pastDue += 1;
      else if (status === 'suspended') clients.suspended += 1;
      else clients.trialing += 1;

      const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (created >= now - 7 * DAY_MS) signupsWeek += 1;
      if (created >= monthStart.getTime()) signupsMonth += 1;

      const item = { id: t.id, businessName: nameOf(t), plan: t.plan || 'basic', planName: PLAN_NAMES[t.plan] || 'Básico' };
      if (status === 'past_due') attention.push({ ...item, kind: 'past_due', label: 'Pago atrasado', at: t.pastDueSince || null });
      else if (status === 'trialing' && t.trialEndsAt) {
        const left = new Date(t.trialEndsAt).getTime() - now;
        if (left <= 0) attention.push({ ...item, kind: 'trial_expired', label: 'Prueba vencida', at: t.trialEndsAt });
        else if (left <= TRIAL_WARNING_DAYS * DAY_MS) attention.push({ ...item, kind: 'trial_ending', label: 'Prueba por vencer', at: t.trialEndsAt });
      }
      const people = users.get(String(t.id)) || [];
      if (status !== 'suspended' && people.length && !latestLogin(people) && created < now - 3 * DAY_MS) {
        attention.push({ ...item, kind: 'never_logged', label: 'Nunca ha entrado', at: t.createdAt || null });
      }
    }

    const order = { past_due: 0, trial_expired: 1, trial_ending: 2, never_logged: 3 };
    attention.sort((a, b) => order[a.kind] - order[b.kind]);

    // Tickets que esperan al equipo, los más viejos primero
    const { open } = await support.waitingByTenant();
    const tenantName = new Map(tenants.map((t) => [String(t.id), nameOf(t)]));
    const waiting = open
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))
      .slice(0, 8)
      .map((t) => ({ id: t.id, tenantId: t.tenantId, businessName: tenantName.get(t.tenantId) || 'Cliente', subject: t.subject, at: t.updatedAt }));
    return res.status(200).json({ clients, signupsWeek, signupsMonth, attention, tickets: { open: open.length }, waiting });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude armar el resumen.');
  }
}

/** Historia de un cliente: cobros recibidos junto con lo que hizo el equipo sobre su negocio. */
async function tenantActivity(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    const [events, actions] = await Promise.all([
      db.ListBillingEvents(tenant.id, 40),
      db.ListPlatformAudit({ tenantId: tenant.id, limit: 60 }),
    ]);
    const items = [
      ...events.map((e) => ({
        id: `b${e.id}`,
        type: e.type,
        message: e.note || e.type,
        amount: e.amount ?? null,
        actor: '',
        at: e.at,
      })),
      ...actions.map((a) => ({ id: `a${a.id}`, type: a.type, message: a.message, amount: null, actor: a.actor || '', at: a.createdAt })),
    ]
      .filter((i) => i.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 60);
    return res.status(200).json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude leer la actividad.');
  }
}

/** Últimos movimientos del equipo en toda la plataforma (solo admin). */
async function activity(req, res) {
  try {
    const rows = await db.ListPlatformAudit({ limit: Number(req.query.limit) || 60 });
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter(Boolean))];
    const [tenants, settings] = await Promise.all([db.ListTenants(), db.GetSettingsMany(tenantIds)]);
    const byId = new Map(tenants.map((t) => [String(t.id), t]));
    const nameOf = (id) => settings.get(id)?.businessName || byId.get(id)?.name || 'Cliente';
    return res.status(200).json({
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        actor: r.actor || '',
        tenantId: r.tenantId || null,
        businessName: r.tenantId ? nameOf(r.tenantId) : '',
        at: r.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude leer la actividad.');
  }
}

// ——— Finanzas ———
async function financeBooks(month) {
  const keys = finance.recentMonthKeys(month);
  const window = { from: finance.monthRange(keys[0]).from, to: finance.monthRange(month).to };
  const [tenants, events, expenses, commissions] = await Promise.all([
    db.ListTenants(),
    db.ListPaymentsBetween(window.from, window.to),
    db.ListPlatformExpensesSince(keys[0]),
    referrals.commissionsBook(finance.monthRange(month)),
  ]);
  const settings = await db.GetSettingsMany(tenants.map((t) => t.id));
  const names = new Map(tenants.map((t) => [String(t.id), settings.get(String(t.id))?.businessName || t.name || 'Sin nombre']));
  const prices = Object.fromEntries(mp.listPlans().map((p) => [p.id, p.price]));
  return finance.buildBooks({
    month,
    tenants,
    names,
    events,
    expenses: expenses.filter((e) => e.month <= month),
    prices,
    commissions,
    partners: process.env.PLATFORM_PARTNERS,
  });
}

/** Números del mes: cobrado, esperado, gastos, utilidad, tendencia. `?format=csv` baja los cobros del mes. */
async function financeSummary(req, res) {
  try {
    const month = String(req.query.month || finance.monthKey());
    if (!finance.monthRange(month)) return res.status(400).send('El mes debe ser AAAA-MM.');
    const books = await financeBooks(month);
    if (req.query.format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="cobros_${month}.csv"`);
      return res.status(200).send(finance.csvOf(books));
    }
    return res.status(200).json(books);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude armar las finanzas.');
  }
}

async function createExpense(req, res) {
  try {
    const label = String(req.body?.label || '').trim();
    const amount = Number(req.body?.amount);
    if (label.length < 2) return res.status(400).send('Escribe qué gasto es.');
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send('Escribe un monto mayor a cero.');
    const created = await db.CreatePlatformExpense({
      label: label.slice(0, 80),
      amount: finance.round2(amount),
      note: String(req.body?.note || '').trim().slice(0, 200),
      month: finance.monthKey(),
      createdAt: new Date(),
    });
    await audit.record(req, {
      type: 'expense_created',
      message: `Anotó el gasto «${created.label}» por $${Number(created.amount).toFixed(2)}`,
      meta: { id: created.id, amount: created.amount },
    });
    return res.status(201).json({ id: created.id, label: created.label, amount: created.amount, note: created.note, month: created.month, createdAt: created.createdAt });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude guardar el gasto.');
  }
}

async function deleteExpense(req, res) {
  try {
    if (!(await db.DeletePlatformExpense(req.params.id))) return res.status(404).send('No encontré ese gasto.');
    await audit.record(req, { type: 'expense_deleted', message: 'Quitó un gasto', meta: { id: req.params.id } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude quitar el gasto.');
  }
}

/**
 * Pago recibido fuera de la app (transferencia, efectivo). Activa el negocio y extiende su periodo pagado
 * por los meses indicados (se cuenta desde el fin del periodo vigente, o desde hoy si ya venció).
 */
async function manualPayment(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send('Escribe un monto mayor a cero.');
    const months = req.body?.months == null || req.body.months === '' ? 1 : Number(req.body.months);
    if (!Number.isInteger(months) || months < 1 || months > 36) {
      return res.status(400).send('Los meses deben ser un número entero de 1 a 36.');
    }
    const note = String(req.body?.note || '').trim().slice(0, 200) || 'Cobro registrado a mano';

    await db.CreateBillingEvent({ tenantId: tenant.id, type: 'payment', plan: tenant.plan, amount: finance.round2(amount), months, note });

    const now = new Date();
    const current = tenant.currentPeriodEnd ? new Date(tenant.currentPeriodEnd) : null;
    const stillPaid = current && !Number.isNaN(current.getTime()) && current > now && tenant.billingStatus === 'active';
    const periodEnd = new Date(stillPaid ? current : now);
    periodEnd.setMonth(periodEnd.getMonth() + months);
    await db.UpdateTenant(tenant.id, { billingStatus: 'active', suspendedAt: null, suspendedReason: null, currentPeriodEnd: periodEnd });

    // Si el negocio llegó con un vendedor, este cobro le genera su comisión
    const commission = await referrals
      .recordPayment({ tenant, amount, source: 'manual', key: `manual:${tenant.id}:${Date.now()}`, note })
      .catch((e) => {
        console.warn('[referidos] no se pudo registrar la comisión:', e.message);
        return null;
      });

    await audit.record(req, {
      tenantId: tenant.id,
      type: 'manual_payment',
      message: `Registró un pago de $${amount.toFixed(2)} por ${months} ${months === 1 ? 'mes' : 'meses'} (paga hasta ${periodEnd.toISOString().slice(0, 10)})${commission ? ` (comisión $${commission.commission.toFixed(2)})` : ''}`,
      meta: { amount, months },
    });
    return res.status(201).json({ ok: true, currentPeriodEnd: periodEnd, commission });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude registrar el pago.');
  }
}

// ——— Soporte: bandeja y tickets (admin y soporte) ———
const supportFail = (res, err) => {
  if (err instanceof support.SupportError) return res.status(err.status).send(err.message);
  console.error('[soporte]', err);
  return res.status(500).send(err.message || 'No pude completar la acción.');
};

async function supportBoard(req, res) {
  try {
    return res.status(200).json(await support.board({ status: String(req.query.status || 'all'), q: req.query.q, limit: req.query.limit }));
  } catch (err) {
    return supportFail(res, err);
  }
}

/** Quien escribe desde la plataforma: su cuenta (nombre y usuario). */
const staffAuthor = (req) => db.FindUserByUsername(req.user.username);

async function tenantTickets(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    return res.status(200).json(await support.listForStaff(tenant.id));
  } catch (err) {
    return supportFail(res, err);
  }
}

async function getTicket(req, res) {
  try {
    return res.status(200).json(await support.getForStaff(req.params.id));
  } catch (err) {
    return supportFail(res, err);
  }
}

async function createTenantTicket(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    const ticket = await support.openByStaff({ tenant, user: await staffAuthor(req), subject: req.body?.subject, message: req.body?.message });
    await audit.record(req, { tenantId: tenant.id, type: 'ticket_opened', message: `Abrió el ticket «${ticket.subject}»`, meta: { ticketId: ticket.id } });
    return res.status(201).json(ticket);
  } catch (err) {
    return supportFail(res, err);
  }
}

async function replyTicket(req, res) {
  try {
    const out = await support.replyByStaff({ id: req.params.id, user: await staffAuthor(req), message: req.body?.message });
    await audit.record(req, { tenantId: out.tenantId, type: 'ticket_replied', message: `Respondió el ticket «${out.subject}»`, meta: { ticketId: req.params.id } });
    return res.status(201).json(out.ticket);
  } catch (err) {
    return supportFail(res, err);
  }
}

const setTicketClosed = (closed) => async (req, res) => {
  try {
    const out = await support.setClosed(req.params.id, closed);
    await audit.record(req, {
      tenantId: out.tenantId,
      type: closed ? 'ticket_closed' : 'ticket_reopened',
      message: `${closed ? 'Cerró' : 'Reabrió'} el ticket «${out.subject}»`,
      meta: { ticketId: req.params.id },
    });
    return res.status(200).json(out.ticket);
  } catch (err) {
    return supportFail(res, err);
  }
};

// ——— Vendedores (referidos) y su acceso al portal de socios ———
const refFail = (res, err) => {
  if (err instanceof referrals.ReferralError || err instanceof partners.PartnerError) return res.status(err.status).send(err.message);
  console.error(err);
  return res.status(500).send(err.message || 'No pude completar la acción.');
};

async function listReferrers(req, res) {
  try {
    const items = await referrals.listSummaries();
    return res.status(200).json({
      items,
      totals: {
        sellers: items.length,
        clients: items.reduce((n, r) => n + r.clients, 0),
        pending: finance.round2(items.reduce((n, r) => n + r.pending, 0)),
        paid: finance.round2(items.reduce((n, r) => n + r.paid, 0)),
      },
    });
  } catch (err) {
    return refFail(res, err);
  }
}

/** La cuenta del admin que consulta (para ligar su vendedor por el correo de su cuenta). */
async function currentAdminAccount(req) {
  const user = await db.FindUserByUsername(req.user.username);
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email.includes('@')) throw new referrals.ReferralError(400, 'Tu cuenta no tiene un correo asignado.');
  return { email, name: `${user.name || ''} ${user.lastName || ''}`.trim() || req.user.username, phone: user.cellphone || '' };
}

/** Mi código de vendedor: el vendedor ligado a mi cuenta de admin, o que aún no lo he activado. */
async function mySeller(req, res) {
  try {
    const { email } = await currentAdminAccount(req);
    const linked = await referrals.ownerSeller(email);
    return res.status(200).json({ linked: Boolean(linked), seller: linked ? await referrals.detail(linked.id) : null });
  } catch (err) {
    return refFail(res, err);
  }
}

/** Activa mi código de vendedor: crea mi registro (o liga el que ya tenga con mi correo). */
async function activateMySeller(req, res) {
  try {
    const account = await currentAdminAccount(req);
    const seller = await referrals.linkOwner(account);
    await audit.record(req, { type: 'owner_seller_linked', message: `Activó su código de vendedor (${seller.code})`, meta: { referrerId: seller.id } });
    return res.status(200).json({ linked: true, seller: await referrals.detail(seller.id) });
  } catch (err) {
    return refFail(res, err);
  }
}

async function getReferrer(req, res) {
  try {
    return res.status(200).json(await referrals.detail(req.params.id));
  } catch (err) {
    return refFail(res, err);
  }
}

async function createReferrer(req, res) {
  try {
    const { access, ...input } = req.body || {};
    let created;
    let owner = null;
    if (access && (access.username || access.password)) {
      // Con acceso al portal: se crea el vendedor y su cuenta de Dueño con los mismos datos, en un solo paso
      const out = await partners.createWithOwner(input, access);
      created = out.partner;
      owner = out.user;
    } else {
      created = await referrals.createReferrer(input);
    }
    await audit.record(req, {
      type: 'referrer_created',
      message: `Dio de alta al vendedor ${created.name} (${created.code})${owner ? ` con acceso al portal (${owner.username})` : ''}`,
      meta: { referrerId: created.id },
    });
    return res.status(201).json(await referrals.detail(created.id));
  } catch (err) {
    return refFail(res, err);
  }
}

async function updateReferrer(req, res) {
  try {
    const updated = await referrals.updateReferrer(req.params.id, req.body || {});
    const paused = req.body?.status === 'paused';
    await audit.record(req, {
      type: paused ? 'referrer_paused' : 'referrer_updated',
      message: `${paused ? 'Pausó' : 'Actualizó'} al vendedor ${updated.name}`,
      meta: { referrerId: updated.id },
    });
    return res.status(200).json(await referrals.detail(updated.id));
  } catch (err) {
    return refFail(res, err);
  }
}

async function payReferrer(req, res) {
  try {
    const payout = await referrals.payOut(req.params.id, { by: req.user?.username, note: req.body?.note });
    await audit.record(req, {
      type: 'referrer_paid',
      message: `Liquidó $${Number(payout.total).toFixed(2)} en comisiones (${payout.count} cobros)`,
      meta: { referrerId: req.params.id, payoutId: payout.id, total: payout.total },
    });
    return res.status(201).json(await referrals.detail(req.params.id));
  } catch (err) {
    return refFail(res, err);
  }
}

async function voidCommission(req, res) {
  try {
    const updated = await referrals.voidCommission(req.params.id, { reason: req.body?.reason });
    await audit.record(req, {
      tenantId: updated.tenantId,
      type: 'commission_voided',
      message: `Anuló una comisión de $${Number(updated.commission).toFixed(2)}`,
      meta: { commissionId: updated.id },
    });
    return res.status(200).json(updated);
  } catch (err) {
    return refFail(res, err);
  }
}

async function referrerUsers(req, res) {
  try {
    return res.status(200).json(await partners.listTeam(req.params.id));
  } catch (err) {
    return refFail(res, err);
  }
}

async function createReferrerUser(req, res) {
  try {
    const created = await partners.createMember(req.params.id, req.body || {});
    await audit.record(req, {
      type: 'partner_user_created',
      message: `Dio acceso al portal de socios a ${created.username} (${created.roleName})`,
      meta: { referrerId: req.params.id, userId: created.id },
    });
    return res.status(201).json(created);
  } catch (err) {
    return refFail(res, err);
  }
}

async function setReferrerUserActive(req, res) {
  try {
    const active = req.body?.active !== false;
    await partners.setActive(req.params.id, req.params.userId, active, null);
    await audit.record(req, {
      type: active ? 'partner_user_reactivated' : 'partner_user_disabled',
      message: `${active ? 'Reactivó' : 'Desactivó'} un acceso al portal de socios`,
      meta: { referrerId: req.params.id, userId: req.params.userId },
    });
    return res.status(200).json(await partners.listTeam(req.params.id));
  } catch (err) {
    return refFail(res, err);
  }
}

/** Asigna (o quita) el vendedor de un negocio que ya existe. */
async function setTenantReferrer(req, res) {
  try {
    const tenant = await db.GetTenantById(req.params.id);
    if (!tenant) return res.status(404).send('No encontré ese cliente.');
    const raw = req.body?.code;
    if (raw === null || raw === '' || raw === undefined) {
      await db.UpdateTenant(tenant.id, { referrerId: null, referralCode: '', referredAt: null });
      await audit.record(req, { tenantId: tenant.id, type: 'referrer_removed', message: 'Quitó el vendedor de este negocio' });
      return res.status(200).json({ referrerId: null, referralCode: '' });
    }
    const referrer = await referrals.findActiveByCode(raw);
    if (!referrer) return res.status(400).send('Ese código no existe o el vendedor está pausado.');
    await db.UpdateTenant(tenant.id, referrals.referralFields(referrer));
    await audit.record(req, {
      tenantId: tenant.id,
      type: 'referrer_assigned',
      message: `Asignó el negocio al vendedor ${referrer.name} (${referrer.code})`,
      meta: { referrerId: referrer.id },
    });
    return res.status(200).json({ referrerId: referrer.id, referralCode: referrer.code, seller: referrer.name });
  } catch (err) {
    return refFail(res, err);
  }
}

// ——— Equipo de la plataforma ———
function publicStaff(user) {
  const role = PLATFORM_ROLES.includes(user.role) ? user.role : 'platform_admin';
  return {
    id: user.id || String(user._id || ''),
    name: user.name || '',
    lastName: user.lastName || '',
    username: user.username || '',
    email: user.email || '',
    role,
    roleName: STAFF_ROLE_NAMES[role],
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function listStaff(req, res) {
  try {
    return res.status(200).json((await db.ListPlatformUsers()).map(publicStaff));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude cargar el equipo.');
  }
}

async function createStaff(req, res) {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const lastName = String(body.lastName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'platform_support' ? 'platform_support' : 'platform_admin';
    if (name.length < 2) return res.status(400).send('Escribe el nombre.');
    if (!lastName) return res.status(400).send('Escribe el apellido.');
    if (!email.includes('@')) return res.status(400).send('Escribe un correo válido.');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return res.status(400).send('El usuario debe tener 3 a 30 letras, números, punto o guion.');
    }
    if (password.length < 8) return res.status(400).send('La contraseña debe tener al menos 8 caracteres.');
    if (password.toLowerCase().includes(username)) return res.status(400).send('La contraseña no puede contener el usuario.');
    if (await db.FindUserByUsername(username)) return res.status(400).send('Ese usuario ya existe.');
    if (await db.FindUserByEmail(email)) return res.status(400).send('Ese correo ya está registrado.');

    const now = new Date();
    const result = await db.CreateUser({
      name,
      lastName,
      email,
      username,
      password: await hasher.hashPassword(password),
      cellphone: String(body.cellphone || '').replace(/\D/g, '').slice(0, 10) || '0000000000',
      role,
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    });
    await audit.record(req, {
      type: 'staff_created',
      message: `Agregó a ${name} ${lastName} al equipo como ${STAFF_ROLE_NAMES[role]}`,
      meta: { username, role },
    });
    return res.status(201).json(publicStaff({ id: String(result.insertedId), name, lastName, username, email, role, createdAt: now }));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude crear a esa persona.');
  }
}

async function deleteStaff(req, res) {
  try {
    const id = String(req.params.id || '');
    const target = (await db.ListPlatformUsers()).find((user) => user.id === id);
    if (!target) return res.status(404).send('No encontré a esa persona.');
    if (target.username === req.user.username) return res.status(400).send('No puedes quitarte a ti mismo.');
    if (target.role === 'platform_admin' && (await db.CountPlatformAdmins()) <= 1) {
      return res.status(400).send('Debe quedar al menos un admin.');
    }
    if (!(await db.DeleteUserById(id))) return res.status(404).send('No encontré a esa persona.');
    await audit.record(req, {
      type: 'staff_removed',
      message: `Quitó a ${target.name} ${target.lastName} del equipo`,
      meta: { username: target.username, role: target.role },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'No pude quitar a esa persona.');
  }
}

module.exports = {
  overview,
  listTenants,
  getTenant,
  updateTenant,
  suspend,
  reactivate,
  setPlan,
  manualPayment,
  supportBoard,
  tenantTickets,
  getTicket,
  createTenantTicket,
  replyTicket,
  closeTicket: setTicketClosed(true),
  reopenTicket: setTicketClosed(false),
  listReferrers,
  mySeller,
  activateMySeller,
  getReferrer,
  createReferrer,
  updateReferrer,
  payReferrer,
  voidCommission,
  referrerUsers,
  createReferrerUser,
  setReferrerUserActive,
  setTenantReferrer,
  financeSummary,
  createExpense,
  deleteExpense,
  tenantActivity,
  activity,
  listStaff,
  createStaff,
  deleteStaff,
};
