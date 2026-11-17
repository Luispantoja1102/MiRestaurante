// Base de datos falsa en memoria + app real de Express, para probar rutas sin MongoDB.
process.env.SECRET_KEY = 'test-secret';
process.env.VERCEL = '1'; // app.js no abre puerto
process.env.NODE_ENV = 'test';

const path = require('path');
const { ObjectId } = require('mongodb');

function createFakeDb() {
  const state = { ingredients: [], movements: [], menus: [], failAdjust: new Set(), settings: {}, cash: [], foods: [], orders: [], counters: {}, invites: [], sync: {}, users: [], waiters: [], tenants: [{ id: 't1', name: 'T1', billingStatus: 'active', plan: 'basic' }, { id: 't2', name: 'T2', billingStatus: 'active', plan: 'basic' }] };
  const pub = (u) => { const rest = { ...u }; delete rest.password; delete rest.resetToken; delete rest.resetExpires; return { ...rest, id: String(u._id) }; };
  const impl = {
    ensureConnection: async () => {},
    GetSyncVersions: async (tenantId) => ({ orders: 0, tables: 0, waitlist: 0, inventory: 0, ...(state.sync[tenantId] || {}) }),
    GetTenantById: async (id) => state.tenants.find((t) => t.id === id) || null,
    FindUserByUsername: async (username, tenantId) => state.users.find((u) => u.username === username && (!tenantId || u.tenantId === tenantId)) || null,
    FindUserByEmail: async (email) => state.users.find((u) => u.email === email) || null,
    GetUsersByTenant: async (tenantId) => state.users.filter((u) => u.tenantId === tenantId).map(pub),
    GetUserByIdAndTenant: async (id, tenantId) => state.users.find((u) => String(u._id) === String(id) && u.tenantId === tenantId) || null,
    CountUsersByRole: async (tenantId, role) => state.users.filter((u) => u.tenantId === tenantId && u.role === role).length,
    CreateUser: async (doc) => { const _id = new ObjectId(); state.users.push({ ...doc, _id }); return { insertedId: _id }; },
    UpdateUserById: async (id, data) => { const u = state.users.find((x) => String(x._id) === String(id)); if (!u) return null; Object.assign(u, data); return u; },
    DeleteUserByIdAndTenant: async (id, tenantId) => { const n = state.users.length; state.users = state.users.filter((u) => !(String(u._id) === String(id) && u.tenantId === tenantId)); return { deletedCount: n - state.users.length }; },
    GetWaiterByCellphone: async (c, tenantId) => state.waiters.find((w) => w.cellphone === c && w.tenantId === tenantId) || null,
    AddWaiter: async (w) => { state.waiters.push(w); return { insertedId: new ObjectId() }; },
    // —— ajustes, caja, menú, pedidos e invitaciones (modo mostrador / café)
    GetSettings: async (t) => state.settings[t] || null,
    CreateSettings: async (d) => { state.settings[d.tenantId] = { ...d }; return state.settings[d.tenantId]; },
    UpdateSettings: async (d, t) => { state.settings[t] = { ...(state.settings[t] || {}), ...d }; return state.settings[t]; },
    CountUsersByTenant: async (t) => state.users.filter((u) => u.tenantId === t).length,
    GetOpenCashSession: async (t) => state.cash.find((c) => c.tenantId === t && c.status === 'open') || null,
    CreateCashSession: async (d) => { const c = { ...d, id: `cs${state.cash.length + 1}` }; state.cash.push(c); return c; },
    UpdateCashSession: async (id, patch, t) => { const c = state.cash.find((x) => x.id === id && x.tenantId === t); if (!c) return null; Object.assign(c, patch); return c; },
    GetOrdersByCashSession: async (sid, t) => state.orders.filter((o) => o.cashSessionId === sid && o.tenantId === t),
    GetFoods: async (t) => state.foods.filter((f) => f.tenantId === t),
    GetFoodById: async (id, t) => state.foods.find((f) => f.id === id && f.tenantId === t) || null,
    GetMenuById: async (id, t) => state.menus.find((m) => m.id === id && m.tenantId === t) || null,
    CreateFood: async (d) => { const f = { ...d, id: String(new ObjectId()) }; state.foods.push(f); return f; },
    UpdateFood: async (id, patch, t) => { const f = state.foods.find((x) => x.id === id && x.tenantId === t); if (!f) return null; const clean = { ...patch }; delete clean.id; delete clean._id; delete clean.tenantId; Object.assign(f, clean); return f; },
    GetOrderById: async (id, t) => state.orders.find((o) => o.id === id && o.tenantId === t) || null,
    UpdateOrder: async (id, patch, t) => { const o = state.orders.find((x) => x.id === id && x.tenantId === t); if (!o) return null; Object.assign(o, patch); return o; },
    // —— inventario (misma semántica que database/mongodb.js)
    GetMenus: async (t) => state.menus.filter((m) => m.tenantId === t),
    GetIngredients: async (t) => state.ingredients.filter((i) => i.tenantId === t).sort((a, b) => a.name.localeCompare(b.name)),
    GetIngredientById: async (id, t) => state.ingredients.find((i) => i.id === id && i.tenantId === t) || null,
    CreateIngredient: async (d) => { const i = { ...d, id: String(new ObjectId()) }; state.ingredients.push(i); return i; },
    UpdateIngredient: async (id, patch, t) => { const i = state.ingredients.find((x) => x.id === id && x.tenantId === t); if (!i) return null; const clean = { ...patch }; delete clean.id; delete clean.tenantId; delete clean.stock; Object.assign(i, clean); return i; },
    DeleteIngredient: async (id, t) => { const n = state.ingredients.length; state.ingredients = state.ingredients.filter((i) => !(i.id === id && i.tenantId === t)); return { deletedCount: n - state.ingredients.length }; },
    CountFoodsUsingIngredient: async (id, t) => state.foods.filter((f) => f.tenantId === t && ((f.recipe || []).some((l) => l.ingredientId === String(id)) || (f.extras || []).some((l) => l.ingredientId === String(id)))).length,
    AdjustStock: async (t, id, delta, meta = {}) => {
      if (state.failAdjust.has(String(id))) throw new Error('fallo simulado de inventario');
      const i = state.ingredients.find((x) => x.id === String(id) && x.tenantId === t); if (!i) return null;
      i.stock = Math.round((i.stock + delta + Number.EPSILON) * 1000) / 1000;
      state.movements.push({ id: String(state.movements.length + 1), tenantId: t, ingredientId: i.id, ingredientName: i.name, unit: i.unit, type: meta.type, delta, stockAfter: i.stock, orderId: meta.orderId || null, note: meta.note || '', by: meta.by || null, at: new Date(Date.now() + state.movements.length) });
      state.sync[t] = { ...(state.sync[t] || {}), inventory: ((state.sync[t] || {}).inventory || 0) + 1 };
      return i;
    },
    SetStock: async (t, id, counted, meta = {}) => {
      const i = state.ingredients.find((x) => x.id === String(id) && x.tenantId === t); if (!i) return null;
      const before = i.stock; i.stock = counted;
      state.movements.push({ id: String(state.movements.length + 1), tenantId: t, ingredientId: i.id, ingredientName: i.name, unit: i.unit, type: 'adjust', delta: Math.round((counted - before) * 1000) / 1000, stockAfter: counted, orderId: null, note: meta.note || '', by: meta.by || null, at: new Date(Date.now() + state.movements.length) });
      return i;
    },
    GetStockMovements: async (t, { ingredientId, limit = 50 } = {}) => state.movements.filter((m) => m.tenantId === t && (!ingredientId || m.ingredientId === ingredientId)).sort((a, b) => b.at - a.at).slice(0, limit),
    GetOrderByExternal: async (p, id) => state.orders.find((o) => o.external?.provider === p && o.external?.orderId === String(id)) || null,
    GetIntegrationByStore: async (p, s) => (state.integrations ||= []).find((i) => i.provider === p && i.storeId === String(s)) || null,
    GetIntegrationByTenant: async (p, t) => (state.integrations ||= []).find((i) => i.provider === p && i.tenantId === String(t)) || null,
    SaveIntegration: async (p, t, d) => { const list = (state.integrations ||= []); let i = list.find((x) => x.provider === p && x.tenantId === String(t)); if (!i) { i = { provider: p, tenantId: String(t) }; list.push(i); } Object.assign(i, d); return i; },
    DeleteIntegration: async (p, t) => { state.integrations = (state.integrations || []).filter((i) => !(i.provider === p && i.tenantId === String(t))); },
    AddUberEvent: async (d) => { (state.uberEvents ||= []).push(d); },
    ListUberEvents: async ({ tenantId, limit = 100 } = {}) => [...(state.uberEvents ||= [])].filter((e) => !tenantId || e.tenantId === String(tenantId)).reverse().slice(0, limit),
    ListUberOrdersSince: async (t, since) => state.orders.filter((o) => o.source === 'uber' && (!t || o.tenantId === String(t)) && new Date(o.createdAt) >= since),
    ListIntegrations: async (p) => (state.integrations ||= []).filter((i) => i.provider === p),
    GetPointConnection: async (t) => (state.pointConns ||= []).find((c) => c.tenantId === String(t)) || null,
    SavePointConnection: async (t, d) => { const list = (state.pointConns ||= []); let c = list.find((x) => x.tenantId === String(t)); if (!c) { c = { tenantId: String(t) }; list.push(c); } Object.assign(c, d); return c; },
    DeletePointConnection: async (t) => { state.pointConns = (state.pointConns || []).filter((c) => c.tenantId !== String(t)); },
    CreatePointCharge: async (d) => { const c = { ...d, id: `pc${(state.pointCharges ||= []).length + 1}` }; state.pointCharges.push(c); return c; },
    GetPointCharge: async (id, t) => (state.pointCharges ||= []).find((c) => c.id === String(id) && c.tenantId === String(t)) || null,
    GetPointChargeBySale: async (sid, t) => [...(state.pointCharges ||= [])].reverse().find((c) => c.clientSaleId === String(sid) && c.tenantId === String(t)) || null,
    GetPointChargeByMpOrderId: async (m) => (state.pointCharges ||= []).find((c) => c.mpOrderId === String(m)) || null,
    ListPointChargesSince: async (t, since) => (state.pointCharges ||= []).filter((c) => c.tenantId === String(t) && c.createdAt >= since),
    UpdatePointCharge: async (id, d, t) => { const c = (state.pointCharges ||= []).find((x) => x.id === String(id) && x.tenantId === String(t)); if (!c) return null; Object.assign(c, d); return c; },
    ClaimPointCharge: async (id, t, sid) => { const c = (state.pointCharges ||= []).find((x) => x.id === String(id) && x.tenantId === String(t)); if (!c || c.status !== 'paid' || c.consumedBy) return null; c.consumedBy = String(sid); return c; },
    ReleasePointCharge: async (id, t, sid) => { const c = (state.pointCharges ||= []).find((x) => x.id === String(id) && x.tenantId === String(t)); if (c && c.consumedBy === String(sid)) c.consumedBy = null; },
    GetAwaitingExternalOrders: async (t) => state.orders.filter((o) => o.tenantId === String(t) && o.external?.state === 'awaiting'),
    GetOrderByClientRef: async (t, ref) => { const found = state.orders.find((o) => o.tenantId === t && o.clientRef === ref) || null; if (state.slowLookup) await new Promise((r) => setTimeout(r, 25)); return found; },

    NextCounter: async (t, key) => { const k = `${t}:${key}`; state.counters[k] = (state.counters[k] || 0) + 1; return state.counters[k]; },
    CreateOrder: async (d) => {
      // Igual que el índice único real: dos ventas con el mismo clientRef no pueden coexistir.
      if (d.clientRef && state.orders.some((o) => o.tenantId === d.tenantId && o.clientRef === d.clientRef)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
      if (d.external?.orderId && state.orders.some((o) => o.external?.provider === d.external.provider && o.external?.orderId === d.external.orderId)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
      const o = { ...d, id: String(new ObjectId()) }; state.orders.push(o); return o;
    },
    GetInvites: async (t) => state.invites.filter((i) => i.tenantId === t),
    CreateInvite: async (d) => { const i = { ...d, id: String(new ObjectId()) }; state.invites.push(i); return i; },
    GetInviteByToken: async (token) => state.invites.find((i) => i.token === token) || null,
    UpdateInvite: async (id, data, t) => { const i = state.invites.find((x) => x.id === id && x.tenantId === t); if (!i) return null; Object.assign(i, data); return i; },
    DeleteWaiter: async (c, tenantId) => { state.waiters = state.waiters.filter((w) => !(w.cellphone === c && w.tenantId === tenantId)); return {}; },
    // —— plataforma (mismas formas que database/mongodb.js)
    ListTenants: async () => state.tenants,
    CreateTenant: async (d) => { const t = { ...d, id: String(new ObjectId()) }; state.tenants.push(t); return t; },
    UpdateTenant: async (id, patch) => { const t = state.tenants.find((x) => x.id === id); if (!t) return null; Object.assign(t, patch); return t; },
    GetSettingsMany: async (ids) => new Map(ids.filter((id) => state.settings[id]).map((id) => [String(id), state.settings[id]])),
    ListUsersByTenants: async (ids) => new Map(ids.map((id) => [String(id), state.users.filter((u) => u.tenantId === id).map(pub)])),
    ListPlatformUsers: async () => state.users.filter((u) => ['platform_admin', 'platform_support'].includes(u.role)).map(pub),
    CountPlatformAdmins: async () => state.users.filter((u) => u.role === 'platform_admin').length,
    DeleteUserById: async (id) => { const n = state.users.length; state.users = state.users.filter((u) => String(u._id) !== String(id)); return state.users.length < n; },
    CountTenantUsage: async () => ({ tables: 0, foods: 0, ingredients: 0, orders30d: 0 }),
    CreateSupportTicket: async (d) => { const t = { ...d, id: String(new ObjectId()) }; (state.tickets ||= []).push(t); return t; },
    GetSupportTicket: async (id) => (state.tickets || []).find((t) => t.id === String(id)) || null,
    ListSupportTickets: async ({ tenantId, status } = {}) =>
      (state.tickets || []).filter((t) => (!tenantId || t.tenantId === String(tenantId)) && (!status || t.status === status)).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    AppendSupportMessage: async (id, message, patch = {}) => { const t = (state.tickets || []).find((x) => x.id === String(id)); if (!t) return null; t.messages.push(message); Object.assign(t, patch, { updatedAt: message.at }); return t; },
    UpdateSupportTicket: async (id, patch) => { const t = (state.tickets || []).find((x) => x.id === String(id)); if (!t) return null; Object.assign(t, patch, { updatedAt: new Date() }); return t; },
    CreateBillingEvent: async (d) => { const e = { ...d, tenantId: String(d.tenantId), at: d.at || new Date(), id: String(new ObjectId()) }; (state.billing ||= []).push(e); return e; },
    ListBillingEvents: async (t) => (state.billing || []).filter((e) => e.tenantId === String(t)).slice().reverse(),
    ListPaymentsBetween: async (from, to) => (state.billing || []).filter((e) => e.type === 'payment' && e.at >= from && e.at <= to),
    CreatePlatformExpense: async (d) => { const e = { ...d, id: String(new ObjectId()) }; (state.expenses ||= []).push(e); return e; },
    DeletePlatformExpense: async (id) => { const n = (state.expenses || []).length; state.expenses = (state.expenses || []).filter((e) => e.id !== id); return state.expenses.length < n; },
    ListPlatformExpensesSince: async (month) => (state.expenses || []).filter((e) => e.month >= month),
    CreatePlatformAudit: async (d) => { (state.audit ||= []).push({ ...d, id: String((state.audit || []).length + 1) }); },
    ListPlatformAudit: async ({ tenantId = null } = {}) => (state.audit || []).filter((a) => !tenantId || a.tenantId === String(tenantId)).slice().reverse(),
  };
  // Cualquier otra función de la base que se use por accidente falla de forma explícita.
  const db = new Proxy(impl, { get: (t, k) => (k in t ? t[k] : () => { throw new Error(`db.${String(k)} no está simulada en el test`); }) });
  return { db, state };
}

// Referidos y socios: mismas funciones que database/referral.db.js y database/partner.db.js, en memoria.
function createFakeReferralDb(state) {
  state.referrers ||= []; state.commissions ||= []; state.payouts ||= [];
  const newId = () => String(new ObjectId());
  const byId = (list, id) => list.find((x) => x.id === String(id)) || null;
  const payingIds = (rid) => [...new Set(state.commissions.filter((c) => c.referrerId === String(rid) && c.status !== 'void').map((c) => c.tenantId))];
  const impl = {
    CreateReferrer: async (d) => { const r = { ...d, id: newId() }; state.referrers.push(r); return r; },
    GetReferrerById: async (id) => byId(state.referrers, id),
    GetReferrerByCode: async (code) => state.referrers.find((r) => r.code === String(code)) || null,
    GetReferrerByEmail: async (email) => state.referrers.find((r) => r.email === String(email).toLowerCase()) || null,
    GetReferrerByOwnerEmail: async (email) => state.referrers.find((r) => r.ownerEmail === String(email).toLowerCase()) || null,
    ListReferrers: async () => state.referrers.slice().reverse(),
    UpdateReferrer: async (id, patch) => { const r = byId(state.referrers, id); if (!r) return null; Object.assign(r, patch); return r; },
    DeleteReferrer: async (id) => { state.referrers = state.referrers.filter((r) => r.id !== String(id)); },
    ListTenantsByReferrer: async (rid) => state.tenants.filter((t) => t.referrerId === String(rid)),
    ListReferredTenants: async () => state.tenants.filter((t) => t.referrerId),
    InsertCommission: async (d) => { if (state.commissions.some((c) => c.key === d.key)) return null; const c = { ...d, id: newId() }; state.commissions.push(c); return c; },
    GetCommission: async (id) => byId(state.commissions, id),
    FindCommissionByKey: async (key) => state.commissions.find((c) => c.key === String(key)) || null,
    ListCommissions: async ({ referrerId, tenantId, status } = {}) =>
      state.commissions.filter((c) => (!referrerId || c.referrerId === String(referrerId)) && (!tenantId || c.tenantId === String(tenantId)) && (!status || c.status === status)).slice().reverse(),
    UpdateCommission: async (id, patch, only) => { const c = byId(state.commissions, id); if (!c || (only && c.status !== only)) return null; Object.assign(c, patch); return c; },
    ListPayingTenantIds: async (rid) => payingIds(rid),
    CountClosedTenants: async (rid) => payingIds(rid).length,
    SumCommissions: async () => {
      const groups = new Map();
      for (const c of state.commissions) {
        const k = `${c.referrerId}|${c.status}`;
        const g = groups.get(k) || { referrerId: c.referrerId, status: c.status, total: 0, count: 0 };
        g.total += c.commission; g.count += 1; groups.set(k, g);
      }
      return [...groups.values()];
    },
    SumCommissionsByReferrerBetween: async (from, to) => {
      const byRef = new Map();
      for (const c of state.commissions.filter((x) => x.status !== 'void' && x.createdAt >= from && x.createdAt <= to)) {
        const cur = byRef.get(c.referrerId) || { referrerId: c.referrerId, pending: 0, paid: 0, count: 0 };
        if (c.status === 'paid') cur.paid += c.commission; else cur.pending += c.commission;
        cur.count += 1; byRef.set(c.referrerId, cur);
      }
      return [...byRef.values()];
    },
    CreatePayout: async (d) => { const p = { ...d, id: String(d._id || newId()) }; state.payouts.push(p); return p; },
    ListPayouts: async (rid) => state.payouts.filter((p) => p.referrerId === String(rid)).slice().reverse(),
    MarkPendingPaid: async (rid, payoutId, paidAt) => {
      const done = [];
      for (const c of state.commissions.filter((x) => x.referrerId === String(rid) && x.status === 'pending')) { Object.assign(c, { status: 'paid', paidAt, payoutId: String(payoutId) }); done.push(c); }
      return done;
    },
  };
  return impl;
}

function createFakePartnerDb(state) {
  state.notes ||= [];
  const PARTNER = ['partner_admin', 'partner_staff'];
  const mine = (pid) => state.users.filter((u) => u.partnerId === String(pid) && PARTNER.includes(u.role));
  const pub = (u) => ({ id: String(u._id), name: u.name || '', lastName: u.lastName || '', username: u.username, email: u.email, cellphone: u.cellphone || '', role: u.role, disabled: Boolean(u.disabled), lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt || null });
  return {
    ListPartnerUsers: async (pid) => mine(pid).map(pub),
    FindPartnerUser: async (id, pid) => mine(pid).find((u) => String(u._id) === String(id)) || null,
    FindPartnerUserByUsername: async (username, pid) => mine(pid).find((u) => u.username === String(username)) || null,
    CountActivePartnerAdmins: async (pid) => mine(pid).filter((u) => u.role === 'partner_admin' && !u.disabled).length,
    GetPartnerTenant: async (tid, pid) => state.tenants.find((t) => t.id === String(tid) && t.referrerId === String(pid)) || null,
    SetTenantAssignee: async (tid, pid, username) => { const t = state.tenants.find((x) => x.id === String(tid) && x.referrerId === String(pid)); if (!t) return false; t.partnerAssignee = username || null; return true; },
    ClearAssignee: async (pid, username) => { state.tenants.filter((t) => t.referrerId === String(pid) && t.partnerAssignee === username).forEach((t) => { t.partnerAssignee = null; }); },
    ListNotes: async (pid, tid) => state.notes.filter((n) => n.partnerId === String(pid) && n.tenantId === String(tid)).slice().reverse().map((n, i) => ({ id: String(i), text: n.text, author: n.author, authorName: n.authorName, createdAt: n.createdAt })),
    CreateNote: async (d) => { state.notes.push(d); return { id: String(state.notes.length), text: d.text, author: d.author, authorName: d.authorName, createdAt: d.createdAt }; },
    LastNotes: async (pid) => new Map(state.notes.filter((n) => n.partnerId === String(pid)).map((n) => [n.tenantId, n.createdAt])),
  };
}

function loadApp() {
  const { db, state } = createFakeDb();
  const dbPath = require.resolve(path.join(__dirname, '..', 'database', 'mongodb.js'));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  const stub = (file, exports) => {
    const p = require.resolve(path.join(__dirname, '..', 'database', file));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  stub('referral.db.js', createFakeReferralDb(state));
  stub('partner.db.js', createFakePartnerDb(state));
  const app = require('../app');
  const { generateJWT } = require('../utils/jwt.utils');
  const tokenFor = (username, role, tenantId = 't1') => 'Bearer ' + generateJWT({ userId: username, userRole: role, tenantId });
  return { app, state, tokenFor };
}

async function startServer(app) {
  const server = require('http').createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* texto plano */ }
    return { status: res.status, json, text };
  };
  return { call, base, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { loadApp, startServer };
