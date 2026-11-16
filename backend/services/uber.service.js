// Integración con Uber Eats (Marketplace API): recibe pedidos por webhook y los acepta o rechaza.
// Una sola aplicación de MiRestaurante atiende a todos los negocios; cada negocio vincula su Store ID.
const crypto = require('crypto');
const db = require('../database/mongodb');
const inventory = require('./inventory.service');
const { normalizeOrder } = require('../models/order.model');

const ENVIRONMENTS = {
  sandbox: { auth: 'https://sandbox-login.uber.com/oauth/v2/token', api: 'https://test-api.uber.com' },
  production: { auth: 'https://auth.uber.com/oauth/v2/token', api: 'https://api.uber.com' },
};
const SCOPES = 'eats.order eats.store.orders.read';
// Uber cancela solo el pedido si nadie lo acepta o rechaza en ~11.5 minutos
const ACCEPT_WINDOW_MS = 11.5 * 60 * 1000;
const DENY_CODES = ['STORE_CLOSED', 'ITEM_AVAILABILITY', 'CAPACITY', 'POS_NOT_READY', 'OTHER'];

function config() {
  const env = process.env.UBER_EATS_ENV === 'production' ? 'production' : 'sandbox';
  return {
    env,
    clientId: process.env.UBER_EATS_CLIENT_ID || '',
    clientSecret: process.env.UBER_EATS_CLIENT_SECRET || '',
    authUrl: process.env.UBER_EATS_AUTH_URL || ENVIRONMENTS[env].auth,
    apiUrl: process.env.UBER_EATS_API_URL || ENVIRONMENTS[env].api,
  };
}
const isConfigured = () => !!(config().clientId && config().clientSecret);

/** Uber firma el cuerpo EXACTO con HMAC-SHA256 (hex) usando el Client Secret. */
function verifySignature(rawBody, signature, secret = config().clientSecret) {
  if (!secret || !rawBody || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// —— Cliente HTTP (el token dura 30 días; se guarda en memoria)
let tokenCache = null;
async function getToken(force = false) {
  const cfg = config();
  const key = `${cfg.authUrl}|${cfg.clientId}`;
  if (!force && tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }
  const res = await fetch(cfg.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials', scope: SCOPES }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw httpError('No se pudo autenticar con Uber Eats', res.status);
  const data = await res.json();
  tokenCache = { key, value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function api(path, { method = 'GET', body } = {}, retried = false) {
  const token = await getToken(retried);
  const res = await fetch(`${config().apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 && !retried) return api(path, { method, body }, true);
  if (!res.ok) throw httpError(`Uber Eats respondió ${res.status}`, res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const fetchOrder = (orderId) => api(`/v2/eats/order/${encodeURIComponent(orderId)}`);
const acceptOrder = (orderId, { reason = 'Aceptado', externalRef } = {}) =>
  api(`/v1/eats/orders/${encodeURIComponent(orderId)}/accept_pos_order`, {
    method: 'POST',
    body: { reason, ...(externalRef ? { external_reference_id: String(externalRef) } : {}) },
  });
const denyOrder = (orderId, { code = 'OTHER', explanation = 'No se puede preparar' } = {}) =>
  api(`/v1/eats/orders/${encodeURIComponent(orderId)}/deny_pos_order`, {
    method: 'POST',
    body: { reason: { code: DENY_CODES.includes(code) ? code : 'OTHER', explanation: String(explanation).slice(0, 200) } },
  });

// —— De pedido de Uber a pedido de MiRestaurante
const money = (m) => (m && Number.isFinite(Number(m.amount)) ? Number(m.amount) / 100 : null); // Uber manda centavos

function mapOrder(u) {
  const items = (u.cart?.items || []).map((i) => {
    const mods = (i.selected_modifier_groups || []).flatMap((g) =>
      (g.selected_items || []).map((s) => `+ ${s.title}${s.quantity > 1 ? ` x${s.quantity}` : ''}`)
    );
    const notes = [...mods, i.special_instructions].filter(Boolean).join(' · ').slice(0, 200);
    return { foodId: null, name: i.title || 'Producto', price: money(i.price?.unit_price) ?? 0, quantity: Number(i.quantity) || 1, notes };
  });
  const eater = u.eater || {};
  const name = [eater.first_name, eater.last_name].filter(Boolean).join(' ').trim() || 'Cliente Uber Eats';
  const pickup = ['PICK_UP', 'DINE_IN'].includes(u.type);
  const charges = u.payment?.charges || {};
  const sum = items.reduce((n, i) => n + i.price * i.quantity, 0);
  return {
    items,
    name,
    modality: pickup ? 'takeaway' : 'delivery',
    phone: [eater.phone_code, eater.phone].filter(Boolean).join(' ').trim(),
    displayId: u.display_id || String(u.id || '').slice(-5).toUpperCase(),
    subtotal: money(charges.sub_total) ?? sum,
    tax: money(charges.tax) ?? 0,
    total: money(charges.total) ?? sum,
    type: u.type || null,
    notes: String(u.special_instructions || '').slice(0, 200),
  };
}

const normName = (s) => String(s || '').trim().toLowerCase();

/** Guarda un pedido nuevo de Uber (una sola vez por pedido). Devuelve el pedido o null si se ignora. */
async function ingestOrder(storeId, orderId) {
  const link = await db.GetIntegrationByStore('uber', storeId);
  if (!link) return null; // tienda sin vincular a ningún negocio
  if (await db.GetOrderByExternal('uber', orderId)) return null; // reintento del webhook

  const u = await fetchOrder(orderId);
  const m = mapOrder(u);
  const tenantId = link.tenantId;

  // Si el nombre del producto coincide con el del menú, se descuenta su inventario
  const foods = await db.GetFoods(tenantId);
  const byName = new Map(foods.map((f) => [normName(f.name), f]));
  for (const it of m.items) it.foodId = byName.get(normName(it.name))?.id ?? null;
  const foodsById = new Map(foods.map((f) => [String(f.id), f]));

  const payload = normalizeOrder({ items: m.items, modality: m.modality, channel: 'uber' });
  const now = new Date();
  Object.assign(payload, {
    tenantId,
    source: 'uber',
    tableId: null,
    customerName: m.name,
    tableName: `Uber Eats · ${m.name} #${m.displayId}`,
    status: 'pending',
    paymentStatus: 'unpaid',
    paymentMethod: null,
    subtotal: m.subtotal,
    tax: m.tax,
    deliveryFee: 0,
    total: m.total,
    notes: m.notes,
    external: {
      provider: 'uber',
      orderId,
      storeId,
      displayId: m.displayId,
      type: m.type,
      state: 'awaiting',
      receivedAt: now,
      deadline: new Date(now.getTime() + ACCEPT_WINDOW_MS),
    },
    createdAt: now,
    updatedAt: now,
  });
  if (m.modality === 'delivery') {
    payload.delivery = { name: m.name, phone: m.phone, address: '', reference: `Uber Eats #${m.displayId}` };
  }

  let created;
  try {
    created = await db.CreateOrder(payload);
  } catch (err) {
    if (err?.code === 11000) return null; // dos entregas a la vez: gana la primera
    throw err;
  }
  await inventory
    .applySale({ tenantId, order: created, foodsById, by: 'uber' })
    .catch((e) => console.error('[uber] inventario:', e.message));
  return created;
}

/** Uber canceló el pedido: se cancela aquí y se devuelve el inventario. */
async function cancelFromUber(orderId) {
  const order = await db.GetOrderByExternal('uber', orderId);
  if (!order || order.status === 'cancelled') return null;
  const patch = {
    status: 'cancelled',
    external: { ...order.external, state: 'canceled_by_uber', closedAt: new Date() },
    updatedAt: new Date(),
  };
  const restored = await inventory.restoreSale({ tenantId: order.tenantId, order, by: 'uber' }).catch(() => false);
  if (restored) patch.stockRestored = true;
  return db.UpdateOrder(order.id, patch, order.tenantId);
}

async function handleEvent(ev) {
  const type = ev?.event_type;
  const orderId = ev?.meta?.resource_id;
  if (!orderId) return null;
  if (type === 'orders.notification') return ingestOrder(ev.meta.user_id, orderId);
  if (type === 'orders.cancel' || type === 'orders.failure') return cancelFromUber(orderId);
  return null; // otros eventos (store.provisioned, etc.) no hacen falta todavía
}

module.exports = {
  config,
  isConfigured,
  verifySignature,
  fetchOrder,
  acceptOrder,
  denyOrder,
  mapOrder,
  ingestOrder,
  cancelFromUber,
  handleEvent,
  DENY_CODES,
  ACCEPT_WINDOW_MS,
};
