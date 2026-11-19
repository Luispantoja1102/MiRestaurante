// Integración con Uber Eats (Marketplace API): recibe pedidos por webhook y los acepta o rechaza.
// Una sola aplicación de MiRestaurante atiende a todos los negocios; cada negocio vincula su Store ID.
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('../database/mongodb');
const inventory = require('./inventory.service');
const { normalizeOrder } = require('../models/order.model');
const { extraItemId } = require('../models/uberIds');

const ENVIRONMENTS = {
  sandbox: { auth: 'https://sandbox-login.uber.com/oauth/v2/token', authorize: 'https://sandbox-login.uber.com/oauth/v2/authorize', api: 'https://test-api.uber.com' },
  production: { auth: 'https://auth.uber.com/oauth/v2/token', authorize: 'https://auth.uber.com/oauth/v2/authorize', api: 'https://api.uber.com' },
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
const CANCEL_REASONS = ['OUT_OF_ITEMS', 'KITCHEN_CLOSED', 'CUSTOMER_CALLED_TO_CANCEL', 'RESTAURANT_TOO_BUSY', 'CANNOT_COMPLETE_CUSTOMER_NOTE', 'OTHER'];
const DELIVERY_STATUSES = ['started', 'arriving', 'delivered'];

function config() {
  const env = process.env.UBER_EATS_ENV === 'production' ? 'production' : 'sandbox';
  return {
    env,
    clientId: process.env.UBER_EATS_CLIENT_ID || '',
    clientSecret: process.env.UBER_EATS_CLIENT_SECRET || '',
    authUrl: process.env.UBER_EATS_AUTH_URL || ENVIRONMENTS[env].auth,
    authorizeUrl: process.env.UBER_EATS_AUTHORIZE_URL || ENVIRONMENTS[env].authorize,
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
async function api(path, { method = 'GET', body, scope, gzip, token: userToken } = {}, retried = false) {
  const token = userToken || (await getToken(retried, scope)); // userToken: el del comercio, solo para activar tiendas
  const json = body ? JSON.stringify(body) : undefined;
  const res = await fetch(`${config().apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) },
    body: json && gzip ? zlib.gzipSync(json) : json,
    signal: AbortSignal.timeout(gzip ? 30_000 : 10_000),
  });
  if (res.status === 401 && !retried && !userToken) return api(path, { method, body, scope, gzip }, true);
  if (!res.ok) {
    const e = httpError(`Uber Eats respondió ${res.status}`, res.status);
    e.detail = (await res.text().catch(() => '')).slice(0, 300); // lo que Uber dice que está mal
    throw e;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// —— Pedidos: «Order Fulfillment API» (openapi.json de Uber). Todas las rutas cuelgan de /v1/delivery/order/{id}, permiso `eats.order`.
const orderPath = (orderId, tail = '') => `/v1/delivery/order/${encodeURIComponent(orderId)}${tail}`;

/**
 * Detalle del pedido. Primero con la ruta nueva (con carritos, entregas y pago); si Uber la rechaza o responde con otra forma,
 * se cae a la ruta vieja (v2) para no dejar de recibir pedidos. Quitar la caída cuando el sandbox confirme la nueva.
 */
async function fetchOrder(orderId) {
  try {
    const u = await api(`${orderPath(orderId)}?expand=carts,deliveries,payment`);
    if (u?.order) return u;
  } catch (err) {
    console.error('[uber] detalle del pedido (ruta nueva):', err.message);
  }
  return api(`/v2/eats/order/${encodeURIComponent(orderId)}`);
}

// Los motivos que ve el usuario siguen siendo los nuestros; Uber pide su lista de `type` (el resto de nuestros códigos se llaman igual)
const DENY_TYPE = { ITEM_AVAILABILITY: 'ITEM_ISSUE' };
const CANCEL_INFO = {
  OUT_OF_ITEMS: 'Producto agotado',
  KITCHEN_CLOSED: 'La cocina cerró',
  CUSTOMER_CALLED_TO_CANCEL: 'El cliente llamó para cancelar',
  RESTAURANT_TOO_BUSY: 'El restaurante tiene mucho trabajo',
  CANNOT_COMPLETE_CUSTOMER_NOTE: 'No se puede cumplir la nota del cliente',
  OTHER: 'Otro motivo',
};
const CANCEL_TYPE = { OUT_OF_ITEMS: 'ITEM_ISSUE', CANNOT_COMPLETE_CUSTOMER_NOTE: 'SPECIAL_INSTRUCTIONS' };

const acceptOrder = (orderId, { externalRef, pickupTime, acceptedBy, pickupInstructions } = {}) =>
  api(orderPath(orderId, '/accept'), {
    method: 'POST',
    body: {
      ...(pickupTime ? { ready_for_pickup_time: new Date(Math.floor(Number(pickupTime)) * 1000).toISOString() } : {}), // cuándo estará listo
      ...(externalRef ? { external_reference_id: String(externalRef) } : {}),
      ...(acceptedBy ? { accepted_by: String(acceptedBy).slice(0, 100) } : {}),
      ...(pickupInstructions ? { order_pickup_instructions: String(pickupInstructions).slice(0, 200) } : {}), // para el repartidor
    },
  });
// `items`: los productos con problema, para que Uber sepa cuáles fueron: [{ id (el de Uber), externalId }]
const denyOrder = (orderId, { code = 'OTHER', explanation = 'No se puede preparar', items = [] } = {}) => {
  const known = DENY_CODES.includes(code) ? code : 'OTHER';
  const invalid = items.filter((i) => i?.id).map((i) => ({ id: String(i.id), type: 'OUT_OF_ITEM', ...(i.externalId ? { external_id: String(i.externalId) } : {}) }));
  return api(orderPath(orderId, '/deny'), {
    method: 'POST',
    body: { deny_reason: { type: DENY_TYPE[known] || known, info: String(explanation).slice(0, 200), ...(invalid.length ? { item_metadata: { invalid_item: invalid } } : {}) } },
  });
};

// Cancelar un pedido que ya se aceptó (Uber exige un motivo de su lista)
const cancelOrder = (orderId, { reason = 'OTHER', details = '' } = {}) => {
  const code = CANCEL_REASONS.includes(reason) ? reason : 'OTHER';
  return api(orderPath(orderId, '/cancel'), {
    method: 'POST',
    // Uber exige `info` (texto libre): el detalle que escribió el cajero o, si no, el nombre del motivo
    body: { cancellation_reason: { type: CANCEL_TYPE[code] || code, info: String(details || CANCEL_INFO[code]).slice(0, 200) } },
  });
};
// «Mark Order Ready» (documentado en el openapi): avisa a Uber que el pedido ya está listo para recoger. Cuerpo vacío.
// Si Uber la rechaza, queda en la bitácora (`api.ready`) y el pedido se marca listo igual.
const markOrderReady = (orderId) => api(orderPath(orderId, '/ready'), { method: 'POST', body: {} });
// Cambia la hora en que estará listo (solo si el pedido lo permite: `action_eligibility.adjust_ready_for_pickup_time`)
const updateReadyTime = (orderId, readyAt) => api(orderPath(orderId, '/update-ready-time'), { method: 'POST', body: { ready_for_pickup_time: readyAt.toISOString() } });
// Producto agotado sin rechazar todo el pedido: Uber le pregunta al cliente si lo cambia, lo quita o cancela (solo restaurantes)
const ISSUE_TYPES = ['OUT_OF_ITEM', 'CANNOT_FULFILL_ALLERGY_REQUEST', 'CANNOT_FULFILL_MERCHANT_INSTRUCTION']; // lo que Uber admite para restaurantes
const askCustomerAboutItem = (orderId, { cartItemId, message = '', issueType = 'OUT_OF_ITEM' }) =>
  api(orderPath(orderId, '/resolve-fulfillment-issues'), {
    method: 'POST',
    body: {
      fulfillment_issues: [{
        issue_type: ISSUE_TYPES.includes(issueType) ? issueType : 'OUT_OF_ITEM',
        action_type: 'ASK_CUSTOMER',
        ...(cartItemId ? { item: { cart_item_id: String(cartItemId) } } : {}), // la nota del pedido no es de un producto
        ...(message ? { store_response: String(message).slice(0, 200) } : {}),
      }],
    },
  });

// Cambia el precio de un pedido activo (más o menos); el cliente tiene que aceptarlo en su app.
// Uber limita el monto (por defecto 50 en la moneda local) y en regiones con IVA incluido exige la tasa.
const ADJUST_REASONS = ['REQUESTED_ADD_ONS', 'BIGGER_SIZE', 'NEW_ITEM_ADDED', 'ITEM_SOLD_OUT', 'REMOVED_ITEM', 'ADD_ON_UNAVAILABLE', 'OTHER'];
const adjustPrice = (orderId, { amount, taxRate, reason = 'OTHER', customReason = '' }) => {
  const known = ADJUST_REASONS.includes(reason) ? reason : 'OTHER';
  return api(orderPath(orderId, '/adjust-price'), {
    method: 'POST',
    body: {
      amount_e5: Math.round(Number(amount) * 100_000),
      ...(taxRate !== undefined && taxRate !== null && taxRate !== '' ? { tax_rate: String(taxRate) } : {}),
      reason: known,
      ...(known === 'OTHER' ? { custom_reason: String(customReason).slice(0, 200) } : {}),
    },
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

// Tiempo de preparación de la tienda. Lo que Uber documenta es solo LEER (`avg_prep_time`, en minutos, en los datos de la
// tienda). Para CAMBIARLO la página oficial no carga: ruta y cuerpo salen de fuentes de terceros, sin confirmar.
// Horarios especiales (festivos, cierres). El POST reemplaza TODOS los que tenga la tienda.
const holidayHours = (storeId) => api(`/v1/eats/stores/${encodeURIComponent(storeId)}/holiday-hours`, { scope: STORE_READ_SCOPE });
const setHolidayHours = (storeId, holiday_hours) =>
  api(`/v1/eats/stores/${encodeURIComponent(storeId)}/holiday-hours`, { method: 'POST', body: { holiday_hours }, scope: STORE_READ_SCOPE });
const storeDetails = (storeId) => api(`/v1/eats/stores/${encodeURIComponent(storeId)}`, { scope: STORE_READ_SCOPE });
const setPrepTime = (storeId, minutes) =>
  api(`/v1/delivery/store/${encodeURIComponent(storeId)}/update-store-prep-time`, {
    method: 'POST',
    scope: STORE_READ_SCOPE,
    body: { default_prep_time: Math.round(Number(minutes) * 60) }, // segundos (tope 10 800 = 3 h según esas fuentes)
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

const ALLERGENS = { DAIRY: 'lácteos', EGGS: 'huevo', EGG: 'huevo', FISH: 'pescado', SHELLFISH: 'mariscos', TREENUTS: 'nueces', PEANUTS: 'cacahuate', GLUTEN: 'gluten', SOY: 'soya' };

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

// —— Pedido en el formato nuevo (`{ order: {...} }`): los precios no van en el producto sino en `payment`, en e5 (importe × 100 000)
const e5 = (m) => (m && Number.isFinite(Number(m.amount_e5)) ? Number(m.amount_e5) / 100_000 : null);
const FULFILLMENT_TYPE = { DELIVERY_BY_MERCHANT: 'DELIVERY_BY_RESTAURANT', PICKUP: 'PICK_UP' }; // el resto del sistema usa los nombres de siempre

function mapFulfillmentOrder(o) {
  let allergy = false;
  const unitPrice = new Map();
  for (const p of o.payment?.payment_detail?.item_charges?.price_breakdown || []) {
    if (p.cart_item_id && !unitPrice.has(p.cart_item_id)) unitPrice.set(p.cart_item_id, e5(p.unit?.net) ?? e5(p.unit?.gross));
  }
  const carts = o.carts || [];
  const items = carts.flatMap((c) => c.items || []).map((i) => {
    const mods = (i.selected_modifier_groups || []).flatMap((g) =>
      (g.selected_items || []).map((s) => `+ ${s.title}${s.quantity?.amount > 1 ? ` x${s.quantity.amount}` : ''}`)
    );
    const a = i.customer_request?.allergy;
    const alerg = a ? [(a.allergens || []).map((x) => ALLERGENS[x] || String(x).toLowerCase()).join(', '), a.instructions].filter(Boolean).join(' · ') : '';
    if (alerg) allergy = true;
    const notes = [alerg && `ALERGIA: ${alerg}`, ...mods, i.customer_request?.special_instructions].filter(Boolean).join(' · ').slice(0, 200);
    const picked = (i.selected_modifier_groups || []).flatMap((g) => (g.selected_items || []).map((s) => ({ id: String(s.id || ''), quantity: Number(s.quantity?.amount) || 1 })));
    return { foodId: null, uberId: i.id ? String(i.id) : null, cartItemId: i.cart_item_id || null, picked, name: i.title || 'Producto', price: unitPrice.get(i.cart_item_id) ?? 0, quantity: Number(i.quantity?.amount) || 1, notes };
  });
  const customer = (o.customers || [])[0] || {};
  const n = customer.name || {};
  const name = [n.first_name, n.last_name].filter(Boolean).join(' ').trim() || n.display_name || 'Cliente Uber Eats';
  const type = FULFILLMENT_TYPE[o.fulfillment_type] || o.fulfillment_type || null;
  const pay = o.payment?.payment_detail || {};
  const sum = items.reduce((t, i) => t + i.price * i.quantity, 0);
  const single = carts[0]?.include_single_use_items;
  return {
    items,
    name,
    modality: ['PICK_UP', 'DINE_IN'].includes(type) ? 'takeaway' : 'delivery',
    phone: customer.contact?.phone?.number || '',
    displayId: o.display_id || String(o.id || '').slice(-5).toUpperCase(),
    subtotal: e5(pay.item_charges?.total?.net) ?? sum,
    tax: e5(pay.order_total?.tax) ?? 0,
    total: e5(pay.order_total?.gross) ?? sum,
    type,
    readyAt: o.preparation_time?.ready_for_pickup_time ? new Date(o.preparation_time.ready_for_pickup_time) : null,
    allergy,
    notes: [carts[0]?.special_instructions ?? o.store_instructions, single === true ? 'Con cubiertos' : single === false ? 'Sin cubiertos' : ''].filter(Boolean).join(' · ').slice(0, 200),
  };
}

const mapOrder = (u) => (u?.order ? mapFulfillmentOrder(u.order) : mapLegacyOrder(u));

function mapLegacyOrder(u) {
  let allergy = false;
  const items = (u.cart?.items || []).map((i) => {
    const mods = (i.selected_modifier_groups || []).flatMap((g) =>
      (g.selected_items || []).map((s) => `+ ${s.title}${s.quantity > 1 ? ` x${s.quantity}` : ''}`)
    );
    const alerg = allergyText(i);
    if (alerg) allergy = true;
    // Las alergias van primero: son lo último que debe cortarse
    const notes = [alerg && `ALERGIA: ${alerg}`, ...mods, i.special_instructions].filter(Boolean).join(' · ').slice(0, 200);
    const picked = (i.selected_modifier_groups || []).flatMap((g) => (g.selected_items || []).map((s) => ({ id: String(s.id || ''), quantity: Number(s.quantity) || 1 })));
    return { foodId: null, uberId: i.id ? String(i.id) : null, picked, name: i.title || 'Producto', price: money(i.price?.unit_price) ?? 0, quantity: Number(i.quantity) || 1, notes };
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
    readyAt: u.estimated_ready_for_pickup_at ? new Date(u.estimated_ready_for_pickup_at) : null, // lo mejor que dice Uber de cuándo se recoge
    allergy,
    notes: [u.cart?.special_instructions ?? u.special_instructions, utensils(u)].filter(Boolean).join(' · ').slice(0, 200),
  };
}

const normName = (s) => String(s || '').trim().toLowerCase();

/** Guarda un pedido nuevo de Uber (una sola vez por pedido). Devuelve el pedido o null si se ignora. */
/** Extras que el cliente eligió en Uber, en el formato de una venta nuestra (sirve para descontar sus ingredientes). */
function optionsFrom(food, picked) {
  const byId = new Map((food.extras || []).map((e) => [extraItemId(food, e), e]));
  const totals = new Map();
  for (const p of picked || []) if (byId.has(p.id)) totals.set(p.id, (totals.get(p.id) || 0) + p.quantity);
  return [...totals].map(([id, quantity]) => {
    const e = byId.get(id);
    return { ingredientId: String(e.ingredientId), label: e.label, quantity, unitPrice: Number(e.price) || 0, amount: Number(e.amount) || 0 };
  });
}

/** El producto se reconoce por el id del menú que publicamos (o, si no, por su nombre) y así se descuenta su inventario y el de sus extras. */
async function resolveItems(tenantId, items) {
  const foods = await db.GetFoods(tenantId);
  const byName = new Map(foods.map((f) => [normName(f.name), f]));
  const foodsById = new Map(foods.map((f) => [String(f.id), f]));
  for (const it of items) {
    const food = foodsById.get(it.uberId) || byName.get(normName(it.name));
    it.foodId = food?.id ?? null;
    it.options = food ? optionsFrom(food, it.picked) : [];
    if (it.uberId) it.uberItemId = it.uberId; // se necesita para decirle a Uber qué producto falló
    delete it.uberId;
    delete it.picked;
  }
  return foodsById;
}

async function ingestOrder(storeId, orderId, { scheduled = false } = {}) {
  const link = await db.GetIntegrationByStore('uber', storeId);
  if (!link) return { skipped: 'tienda sin vincular' }; // la tienda no pertenece a ningún negocio
  if (await db.GetOrderByExternal('uber', orderId)) return { skipped: 'repetido' }; // reintento del webhook

  const u = await fetchOrder(orderId);
  const m = mapOrder(u);
  const tenantId = link.tenantId;
  const foodsById = await resolveItems(tenantId, m.items);

  const payload = normalizeOrder({ items: m.items, modality: m.modality, channel: 'uber' });
  payload.items = m.items; // normalizeOrder solo conserva los campos básicos; aquí también van los extras
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
    // Los importes de un pedido de Uber son los que Uber calculó (el IVA va aparte): no son «precios con IVA incluido»
    pricesWithTax: false,
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
      scheduled,
      readyAt: m.readyAt,
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

/**
 * Pedido programado: se acepta dos veces. Al llegar su hora Uber manda otro `orders.notification` y hay que volver a aceptarlo
 * (si no, Uber lo cancela a los 11.5 minutos). Lo dejamos otra vez «esperando respuesta».
 */
async function reopenScheduled(orderId) {
  const order = await db.GetOrderByExternal('uber', orderId);
  if (!order || order.external?.state !== 'scheduled' || order.status === 'cancelled') return null;
  const now = new Date();
  return db.UpdateOrder(
    order.id,
    { status: 'pending', external: { ...order.external, state: 'awaiting', secondRound: true, receivedAt: now, deadline: new Date(now.getTime() + ACCEPT_WINDOW_MS) }, updatedAt: now },
    order.tenantId
  );
}

/** El cliente cambió el pedido después de pagar (agregó, quitó o cambió cantidades): se actualizan platillos e importes y el inventario. */
async function editFromUber(orderId) {
  const order = await db.GetOrderByExternal('uber', orderId);
  if (!order || ['cancelled', 'served'].includes(order.status)) return null;
  const m = mapOrder(await fetchOrder(orderId));
  const foodsById = await resolveItems(order.tenantId, m.items);
  const now = new Date();
  const updated = await db.UpdateOrder(
    order.id,
    { items: m.items, subtotal: m.subtotal, tax: m.tax, total: m.total, notes: m.notes, external: { ...order.external, allergy: m.allergy, editedAt: now, askingCustomer: null, priceAdjust: null }, updatedAt: now },
    order.tenantId
  );
  await inventory.restoreSale({ tenantId: order.tenantId, order, by: 'uber', note: 'Pedido editado por el cliente' });
  await inventory.applySale({ tenantId: order.tenantId, order: updated, foodsById, by: 'uber' });
  return updated;
}

// —— Lo que Uber dice del pedido (formato nuevo): estado de la preparación, qué acciones permite y dónde va el repartidor
const eligibility = (x) => (x && typeof x.is_eligible === 'boolean' ? { eligible: x.is_eligible, reason: x.reason || '' } : null);

function uberStatusOf(u) {
  const o = u?.order;
  if (!o) return null;
  return {
    state: o.state || null,
    preparationStatus: o.preparation_status || null, // READY_FOR_HANDOFF = Uber ya sabe que está listo
    cancel: eligibility(o.action_eligibility?.cancel),
    adjustReadyTime: eligibility(o.action_eligibility?.adjust_ready_for_pickup_time),
    outOfItem: eligibility(o.action_eligibility?.mark_out_of_item),
    cannotFulfill: eligibility(o.action_eligibility?.mark_cannot_fulfill),
    canAskCustomer: (o.customers || []).some((c) => c.can_respond_to_fulfillment_issues === true),
    courier: (o.deliveries || [])[0]?.status || null,
    at: new Date(),
  };
}

// Cuando el repartidor ya recogió el pedido (va hacia el cliente), el pedido se cierra solo. No aplica si lo reparte el restaurante.
const PICKED_UP = ['EN_ROUTE_TO_DROPOFF', 'ARRIVED_AT_DROPOFF', 'COMPLETED'];

async function applyCourier(order, status) {
  const ext = order.external || {};
  const now = new Date();
  const patch = { external: { ...ext, courier: { status, at: now } }, updatedAt: now };
  if (PICKED_UP.includes(status) && ext.state === 'accepted' && ext.type !== 'DELIVERY_BY_RESTAURANT' && !['served', 'cancelled'].includes(order.status)) {
    patch.status = 'served';
  }
  return db.UpdateOrder(order.id, patch, order.tenantId);
}

const fetchStatus = async (orderId) => uberStatusOf(await fetchOrder(orderId));

/** Pide a Uber el estado del pedido y lo guarda (`external.sync`). Devuelve null si Uber no contestó en el formato nuevo. */
async function syncOrder(order) {
  const st = await fetchStatus(order.external.orderId);
  if (!st) return null;
  const now = new Date();
  const ext = { ...order.external, sync: st, ...(st.courier ? { courier: { status: st.courier, at: now } } : {}) };
  const patch = { external: ext, updatedAt: now };
  if (st.courier && PICKED_UP.includes(st.courier) && ext.state === 'accepted' && ext.type !== 'DELIVERY_BY_RESTAURANT' && !['served', 'cancelled'].includes(order.status)) patch.status = 'served';
  return db.UpdateOrder(order.id, patch, order.tenantId);
}

/** Atiende un aviso de Uber y dice qué pasó: { eventType, orderId, storeId, tenantId, outcome: 'ok' | 'ignored', detail }. */
async function handleEvent(ev) {
  // El aviso del repartidor trae el pedido y la tienda en otros campos (order_id, store_id)
  const info = { eventType: ev?.event_type || 'desconocido', orderId: ev?.meta?.resource_id || ev?.meta?.order_id || null, storeId: ev?.meta?.user_id || ev?.meta?.store_id || null };
  if (!info.orderId) return { ...info, outcome: 'ignored', detail: 'sin pedido' };
  if (info.eventType === 'delivery.state_changed') {
    const order = await db.GetOrderByExternal('uber', info.orderId);
    const status = ev?.meta?.status;
    if (!order || !status) return { ...info, outcome: 'ignored', detail: 'pedido desconocido' };
    await applyCourier(order, status);
    return { ...info, tenantId: order.tenantId, outcome: 'ok', detail: `repartidor: ${status}` };
  }
  if (info.eventType === 'orders.release') {
    // El repartidor llegó al perímetro del local: el pedido tiene que estar listo ya
    const order = await db.GetOrderByExternal('uber', info.orderId);
    if (!order || ['served', 'cancelled'].includes(order.status)) return { ...info, outcome: 'ignored', detail: 'pedido desconocido o ya terminado' };
    await db.UpdateOrder(order.id, { external: { ...order.external, releaseAt: new Date() }, updatedAt: new Date() }, order.tenantId);
    return { ...info, tenantId: order.tenantId, outcome: 'ok', detail: 'el repartidor está cerca' };
  }
  if (info.eventType === 'orders.fulfillment_issues.resolved') {
    // El cliente respondió (cambió o quitó el producto agotado): se vuelve a leer el pedido
    const o = await editFromUber(info.orderId);
    return o ? { ...info, tenantId: o.tenantId, outcome: 'ok', detail: 'el cliente respondió por el producto agotado' } : { ...info, outcome: 'ignored', detail: 'pedido desconocido o ya terminado' };
  }
  if (info.eventType === 'orders.notification') {
    const again = await reopenScheduled(info.orderId);
    if (again) return { ...info, tenantId: again.tenantId, outcome: 'ok', detail: 'pedido programado: hay que aceptarlo otra vez' };
  }
  if (info.eventType === 'orders.customer_order_edit') {
    const o = await editFromUber(info.orderId);
    return o ? { ...info, tenantId: o.tenantId, outcome: 'ok', detail: 'el cliente editó el pedido' } : { ...info, outcome: 'ignored', detail: 'pedido desconocido o ya terminado' };
  }
  if (info.eventType === 'orders.notification' || info.eventType === 'orders.scheduled.notification') {
    // Pedido programado: Uber no documenta cuándo se entrega; se guarda marcado y con la hora estimada de recogida
    const r = await ingestOrder(info.storeId, info.orderId, { scheduled: info.eventType === 'orders.scheduled.notification' });
    return r.order ? { ...info, tenantId: r.order.tenantId, outcome: 'ok' } : { ...info, outcome: 'ignored', detail: r.skipped };
  }
  if (['orders.cancel', 'orders.cancelled', 'orders.failure'].includes(info.eventType)) {
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
/** Pedidos que Uber ofreció y nadie atendió: con la lista nueva (estado OFFERED) y, si Uber la rechaza, con la vieja (created-orders). */
async function offeredOrderIds(storeId) {
  try {
    const r = await api(`/v1/delivery/store/${encodeURIComponent(storeId)}/orders?state=OFFERED&page_size=50`);
    if (Array.isArray(r?.data)) return r.data.map((x) => x.order?.id).filter(Boolean);
  } catch (err) {
    console.error('[uber] lista de pedidos (ruta nueva):', err.message);
  }
  const created = await api(`/v1/eats/stores/${encodeURIComponent(storeId)}/created-orders?limit=50`);
  return (created?.orders || []).map((o) => o.id);
}

/** Cómo dice Uber que terminó un pedido sin atender (formato nuevo: estado FAILED; viejo: CANCELED o DENIED), o null si sigue vivo. */
function closedByUber(u) {
  if (u?.order) return u.order.state === 'FAILED' ? `FAILED${u.order.failure_info?.reason ? ` (${u.order.failure_info.reason})` : ''}` : null;
  const s = String(u?.current_state || '').toUpperCase();
  return ['CANCELED', 'DENIED'].includes(s) ? s : null;
}

async function reconcileStore(link) {
  const out = { recovered: 0, closed: 0 };
  for (const id of await offeredOrderIds(link.storeId)) {
    const r = await ingestOrder(link.storeId, id);
    if (r.order) {
      out.recovered++;
      recordEvent({ eventType: 'recuperado', orderId: id, storeId: link.storeId, tenantId: link.tenantId, outcome: 'ok', detail: 'el aviso no había llegado' });
    }
  }
  for (const o of await db.GetAwaitingExternalOrders(link.tenantId)) {
    const closed = closedByUber(await fetchOrder(o.external.orderId).catch(() => null));
    if (closed && (await cancelFromUber(o.external.orderId))) {
      out.closed++;
      recordEvent({ eventType: 'cerrado', orderId: o.external.orderId, storeId: link.storeId, tenantId: link.tenantId, outcome: 'ok', detail: `Uber lo tiene como ${closed}` });
    }
  }
  return out;
}

/**
 * Revisión de todas las tiendas (la corre un reloj del servidor o un cron externo): solo las que tienen la caja abierta,
 * porque sin caja nadie acepta y la tienda ya está pausada.
 */
async function sweepAll() {
  const out = { checked: 0, recovered: 0, closed: 0 };
  if (!isConfigured()) return out;
  for (const link of await db.ListIntegrations('uber')) {
    if (!link.storeId || link.deprovisioned || !(await db.GetOpenCashSession(link.tenantId))) continue;
    try {
      const r = await reconcileStore(link);
      out.checked++;
      out.recovered += r.recovered;
      out.closed += r.closed;
    } catch (err) {
      console.error('[uber] revisión periódica:', err.message);
    }
  }
  return out;
}

/** Al abrir la caja: reanuda la tienda y revisa si faltan pedidos. Todo sin esperar y sin estorbar. */
async function onCashOpened(tenantId) {
  // Sube lo que quedó pendiente del menú y renueva los agotados (vencen a las 24 h)
  const menu = require('./uber.menu.service');
  menu.republishIfDirty(tenantId).finally(() => menu.syncAvailability(tenantId, { force: true }));
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
  storeDetails,
  setPrepTime,
  holidayHours,
  setHolidayHours,
  markOrderReady,
  updateReadyTime,
  askCustomerAboutItem,
  adjustPrice,
  ADJUST_REASONS,
  ISSUE_TYPES,
  syncOrder,
  fetchStatus,
  request: api,
  syncStoreWithCash,
  onCashOpened,
  reconcileStore,
  sweepAll,
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
