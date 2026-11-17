// Integración con Uber Eats (Marketplace API): recibe pedidos por webhook y los acepta o rechaza.
// Una sola aplicación de MiRestaurante atiende a todos los negocios; cada negocio vincula su Store ID.
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('../database/mongodb');
const inventory = require('./inventory.service');
const { normalizeOrder } = require('../models/order.model');

const ENVIRONMENTS = {
  sandbox: { auth: 'https://sandbox-login.uber.com/oauth/v2/token', api: 'https://test-api.uber.com' },
  production: { auth: 'https://auth.uber.com/oauth/v2/token', api: 'https://api.uber.com' },
};
const SCOPES = 'eats.order eats.store.orders.read';
// El estado de entrega del restaurante usa un scope aparte: se pide solo cuando hace falta (si Uber no lo ha habilitado, no afecta al resto)
const DELIVERY_SCOPE = 'eats.store.orders.restaurantdelivery.status';
// Leer el estado de la tienda y cambiarlo son permisos distintos
const STORE_READ_SCOPE = 'eats.store';
const STORE_WRITE_SCOPE = 'eats.store.status.write';
// Uber cancela solo el pedido si nadie lo acepta o rechaza en ~11.5 minutos
const ACCEPT_WINDOW_MS = 11.5 * 60 * 1000;
const DENY_CODES = ['STORE_CLOSED', 'ITEM_AVAILABILITY', 'CAPACITY', 'POS_NOT_READY', 'SPECIAL_INSTRUCTIONS', 'OTHER'];
const CANCEL_REASONS = ['OUT_OF_ITEMS', 'KITCHEN_CLOSED', 'RESTAURANT_TOO_BUSY', 'CANNOT_COMPLETE_CUSTOMER_NOTE', 'OTHER'];
const DELIVERY_STATUSES = ['started', 'arriving', 'delivered'];

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
const tokenCache = new Map(); // scope -> { key, value, expiresAt }
async function getToken(force = false, scope = SCOPES) {
  const cfg = config();
  const key = `${cfg.authUrl}|${cfg.clientId}`;
  const cached = tokenCache.get(scope);
  if (!force && cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) {
    return cached.value;
  }
  const res = await fetch(cfg.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials', scope }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw httpError('No se pudo autenticar con Uber Eats', res.status);
  const data = await res.json();
  tokenCache.set(scope, { key, value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// gzip: para cuerpos grandes (el menú); Uber lo pide comprimido
async function api(path, { method = 'GET', body, scope, gzip } = {}, retried = false) {
  const token = await getToken(retried, scope);
  const json = body ? JSON.stringify(body) : undefined;
  const res = await fetch(`${config().apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) },
    body: json && gzip ? zlib.gzipSync(json) : json,
    signal: AbortSignal.timeout(gzip ? 30_000 : 10_000),
  });
  if (res.status === 401 && !retried) return api(path, { method, body, scope, gzip }, true);
  if (!res.ok) {
    const e = httpError(`Uber Eats respondió ${res.status}`, res.status);
    e.detail = (await res.text().catch(() => '')).slice(0, 300); // lo que Uber dice que está mal
    throw e;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const fetchOrder = (orderId) => api(`/v2/eats/order/${encodeURIComponent(orderId)}`);
// fields_relayed le dice a Uber qué indicaciones del cliente sí mostramos (alergias, notas del pedido y de cada producto)
const FIELDS_RELAYED = { order_special_instructions: true, item_special_instructions: true, item_special_requests: true };
const acceptOrder = (orderId, { reason = 'Aceptado', externalRef, pickupTime } = {}) =>
  api(`/v1/eats/orders/${encodeURIComponent(orderId)}/accept_pos_order`, {
    method: 'POST',
    body: {
      reason,
      fields_relayed: FIELDS_RELAYED,
      ...(pickupTime ? { pickup_time: Math.floor(Number(pickupTime)) } : {}), // segundos Unix: cuándo estará listo
      ...(externalRef ? { external_reference_id: String(externalRef) } : {}),
    },
  });
const denyOrder = (orderId, { code = 'OTHER', explanation = 'No se puede preparar' } = {}) =>
  api(`/v1/eats/orders/${encodeURIComponent(orderId)}/deny_pos_order`, {
    method: 'POST',
    body: { reason: { code: DENY_CODES.includes(code) ? code : 'OTHER', explanation: String(explanation).slice(0, 200) } },
  });

// Cancelar un pedido que ya se aceptó (Uber exige un motivo de su lista)
const cancelOrder = (orderId, { reason = 'OTHER', details = '' } = {}) => {
  const code = CANCEL_REASONS.includes(reason) ? reason : 'OTHER';
  return api(`/v1/eats/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: { reason: code, ...(details ? { details: String(details).slice(0, 200) } : {}) },
  });
};
// Solo para pedidos que entrega el propio restaurante (DELIVERY_BY_RESTAURANT)
const restaurantDeliveryStatus = (orderId, status) =>
  api(`/v1/eats/orders/${encodeURIComponent(orderId)}/restaurantdelivery/status`, { method: 'POST', body: { status }, scope: DELIVERY_SCOPE });

// Estado de la tienda en la app de Uber: ONLINE (recibe pedidos) o PAUSED (aparece «no disponible»)
const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z'); // Uber pide AAAA-MM-DDThh:mm:ssZ
const storeStatus = (storeId) => api(`/v1/eats/store/${encodeURIComponent(storeId)}/status`, { scope: STORE_READ_SCOPE });
const setStoreStatus = (storeId, { status, pausedUntil, reason } = {}) =>
  api(`/v1/eats/store/${encodeURIComponent(storeId)}/status`, {
    method: 'POST',
    scope: STORE_WRITE_SCOPE,
    body: {
      status,
      ...(pausedUntil ? { paused_until: isoSeconds(pausedUntil) } : {}),
      ...(reason ? { reason: String(reason).slice(0, 100) } : {}),
    },
  });

/**
 * Con la caja cerrada nadie puede aceptar un pedido (y a los 11 min Uber lo cancela, lo que baja la tasa de aceptación):
 * al cerrar la caja se pausa la tienda y al abrirla se reanuda, pero SOLO si la pausa la pusimos nosotros
 * (una pausa manual, de Uber o el horario del restaurante no se tocan). Nunca debe estorbar a la caja.
 */
async function syncStoreWithCash(tenantId, cashOpen) {
  if (!isConfigured()) return;
  try {
    const link = await db.GetIntegrationByTenant('uber', tenantId);
    if (!link?.storeId || link.autoPause === false) return;
    if (!cashOpen) {
      const now = await storeStatus(link.storeId).catch(() => null);
      if (now?.status && String(now.status).toUpperCase() !== 'ONLINE') return; // ya no recibe pedidos
      await setStoreStatus(link.storeId, { status: 'PAUSED', reason: 'Caja cerrada' });
      await db.SaveIntegration('uber', tenantId, { pausedByCash: true });
    } else if (link.pausedByCash) {
      await setStoreStatus(link.storeId, { status: 'ONLINE' });
      await db.SaveIntegration('uber', tenantId, { pausedByCash: false });
    }
  } catch (err) {
    console.error('[uber] estado de la tienda:', err.message);
  }
}

// —— De pedido de Uber a pedido de MiRestaurante
const money = (m) => (m && Number.isFinite(Number(m.amount)) ? Number(m.amount) / 100 : null); // Uber manda centavos

const ALLERGENS = { DAIRY: 'lácteos', EGGS: 'huevo', FISH: 'pescado', SHELLFISH: 'mariscos', TREENUTS: 'nueces', PEANUTS: 'cacahuate', GLUTEN: 'gluten', SOY: 'soya' };

/** Alergias que el cliente pidió para un producto, en texto: «lácteos, gluten · sin trazas». */
function allergyText(item) {
  return (item.special_requests || [])
    .map((r) => r.allergy)
    .filter(Boolean)
    .map((a) => {
      const names = (a.allergens_to_exclude || []).map((x) => (x.type === 'OTHER' ? x.freeform_text : ALLERGENS[x.type])).filter(Boolean);
      return [names.join(', '), a.allergy_instructions].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .join(' · ');
}

const utensils = (u) => {
  const include = u.packaging?.disposable_items?.should_include;
  return include === true ? 'Con cubiertos' : include === false ? 'Sin cubiertos' : '';
};

function mapOrder(u) {
  let allergy = false;
  const items = (u.cart?.items || []).map((i) => {
    const mods = (i.selected_modifier_groups || []).flatMap((g) =>
      (g.selected_items || []).map((s) => `+ ${s.title}${s.quantity > 1 ? ` x${s.quantity}` : ''}`)
    );
    const alerg = allergyText(i);
    if (alerg) allergy = true;
    // Las alergias van primero: son lo último que debe cortarse
    const notes = [alerg && `ALERGIA: ${alerg}`, ...mods, i.special_instructions].filter(Boolean).join(' · ').slice(0, 200);
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
    allergy,
    notes: [u.cart?.special_instructions ?? u.special_instructions, utensils(u)].filter(Boolean).join(' · ').slice(0, 200),
  };
}

const normName = (s) => String(s || '').trim().toLowerCase();

/** Guarda un pedido nuevo de Uber (una sola vez por pedido). Devuelve el pedido o null si se ignora. */
async function ingestOrder(storeId, orderId) {
  const link = await db.GetIntegrationByStore('uber', storeId);
  if (!link) return { skipped: 'tienda sin vincular' }; // la tienda no pertenece a ningún negocio
  if (await db.GetOrderByExternal('uber', orderId)) return { skipped: 'repetido' }; // reintento del webhook

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
      allergy: m.allergy,
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
    if (err?.code === 11000) return { skipped: 'repetido' }; // dos entregas a la vez: gana la primera
    throw err;
  }
  await inventory
    .applySale({ tenantId, order: created, foodsById, by: 'uber' })
    .catch((e) => console.error('[uber] inventario:', e.message));
  return { order: created };
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
  // Si ya estaba aceptado (cobrado como «Plataforma»), Uber no lo pagará: sale del cierre de caja
  if (order.paymentStatus === 'paid') patch.paymentStatus = 'refunded';
  const restored = await inventory.restoreSale({ tenantId: order.tenantId, order, by: 'uber' }).catch(() => false);
  if (restored) patch.stockRestored = true;
  return db.UpdateOrder(order.id, patch, order.tenantId);
}

/** Atiende un aviso de Uber y dice qué pasó: { eventType, orderId, storeId, tenantId, outcome: 'ok' | 'ignored', detail }. */
async function handleEvent(ev) {
  const info = { eventType: ev?.event_type || 'desconocido', orderId: ev?.meta?.resource_id || null, storeId: ev?.meta?.user_id || null };
  if (!info.orderId) return { ...info, outcome: 'ignored', detail: 'sin pedido' };
  if (info.eventType === 'orders.notification') {
    const r = await ingestOrder(info.storeId, info.orderId);
    return r.order ? { ...info, tenantId: r.order.tenantId, outcome: 'ok' } : { ...info, outcome: 'ignored', detail: r.skipped };
  }
  if (info.eventType === 'orders.cancel' || info.eventType === 'orders.failure') {
    const o = await cancelFromUber(info.orderId);
    return o ? { ...info, tenantId: o.tenantId, outcome: 'ok' } : { ...info, outcome: 'ignored', detail: 'pedido desconocido o ya cancelado' };
  }
  return { ...info, outcome: 'ignored', detail: 'evento no atendido' }; // store.provisioned, etc.
}

/** Bitácora: nunca debe estorbar al aviso ni a la acción que la origina. */
function recordEvent(ev) {
  db.AddUberEvent({ at: new Date(), ...ev }).catch((e) => console.error('[uber] bitácora:', e.message));
}

// —— Tasa de aceptación (la que mide Uber: pedidos aceptados / pedidos enviados) y pedidos perdidos
/** Un pedido cuenta como «perdido» si Uber lo canceló sin que lo aceptáramos o se acabó el tiempo sin respuesta. */
function acceptanceStats(orders, now = Date.now()) {
  const stats = { received: orders.length, accepted: 0, denied: 0, missed: 0, pending: 0 };
  const missedOrders = [];
  for (const o of orders) {
    const e = o.external || {};
    if (e.acceptedAt) stats.accepted++;
    else if (e.state === 'denied') stats.denied++;
    else if (e.state === 'awaiting' && new Date(e.deadline).getTime() > now) stats.pending++;
    else {
      stats.missed++;
      missedOrders.push({ id: o.id, displayId: e.displayId, receivedAt: e.receivedAt || o.createdAt, reason: e.state === 'awaiting' ? 'sin respuesta' : 'cancelado por Uber' });
    }
  }
  const decided = stats.accepted + stats.denied + stats.missed; // lo pendiente aún no cuenta
  stats.rate = decided ? Number((stats.accepted / decided).toFixed(4)) : null;
  stats.missedOrders = missedOrders.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 5);
  return stats;
}

/**
 * Pone al día una tienda cuando un aviso pudo perderse: trae los pedidos que Uber tiene sin atender (el aviso no llegó)
 * y cierra los que seguimos esperando pero Uber ya canceló o se atendieron en su tableta.
 */
async function reconcileStore(link) {
  const out = { recovered: 0, closed: 0 };
  const created = await api(`/v1/eats/stores/${encodeURIComponent(link.storeId)}/created-orders?limit=50`);
  for (const o of created?.orders || []) {
    const r = await ingestOrder(link.storeId, o.id);
    if (r.order) {
      out.recovered++;
      recordEvent({ eventType: 'recuperado', orderId: o.id, storeId: link.storeId, tenantId: link.tenantId, outcome: 'ok', detail: 'el aviso no había llegado' });
    }
  }
  for (const o of await db.GetAwaitingExternalOrders(link.tenantId)) {
    const u = await fetchOrder(o.external.orderId).catch(() => null);
    if (u && ['CANCELED', 'DENIED'].includes(String(u.current_state).toUpperCase())) {
      if (await cancelFromUber(o.external.orderId)) {
        out.closed++;
        recordEvent({ eventType: 'cerrado', orderId: o.external.orderId, storeId: link.storeId, tenantId: link.tenantId, outcome: 'ok', detail: `Uber lo tiene como ${u.current_state}` });
      }
    }
  }
  return out;
}

/** Al abrir la caja: reanuda la tienda y revisa si faltan pedidos. Todo sin esperar y sin estorbar. */
async function onCashOpened(tenantId) {
  require('./uber.menu.service').syncAvailability(tenantId, { force: true }); // renueva los agotados (vencen a las 24 h)
  await syncStoreWithCash(tenantId, true);
  try {
    const link = isConfigured() ? await db.GetIntegrationByTenant('uber', tenantId) : null;
    if (link?.storeId) await reconcileStore(link);
  } catch (err) {
    console.error('[uber] revisión de pedidos:', err.message);
  }
}

module.exports = {
  config,
  isConfigured,
  verifySignature,
  fetchOrder,
  acceptOrder,
  denyOrder,
  cancelOrder,
  restaurantDeliveryStatus,
  storeStatus,
  setStoreStatus,
  request: api,
  syncStoreWithCash,
  onCashOpened,
  reconcileStore,
  acceptanceStats,
  recordEvent,
  mapOrder,
  ingestOrder,
  cancelFromUber,
  handleEvent,
  DENY_CODES,
  CANCEL_REASONS,
  DELIVERY_STATUSES,
  DELIVERY_SCOPE,
  ACCEPT_WINDOW_MS,
};
