/**
 * Activación de tiendas de Uber Eats por OAuth: el comercio inicia sesión en Uber, autoriza a MiRestaurante
 * (permiso `eats.pos_provisioning`), elegimos su tienda y la activamos con `POST /pos_data`.
 *
 * - El token del comercio (de usuario) solo sirve para listar sus tiendas y activar o quitar la integración; los
 *   pedidos, el menú y el estado de la tienda usan el token de la aplicación. Por eso no se guarda: solo se retiene
 *   (cifrado, 15 min) cuando el comercio tiene varias tiendas y debe elegir una.
 * - Ser «encargado de pedidos» (`is_order_manager`) desplaza a la tableta de Uber Eats: la pantalla lo avisa antes.
 *
 * ⚠️ Armado con la documentación de Uber; confirmar en el sandbox: que Uber devuelva el `state`, el cuerpo de
 *    `pos_data` y, sobre todo, cómo se desactiva (la página de PATCH no existe y DELETE exige el token del comercio).
 */
const db = require('../database/mongodb');
const uber = require('./uber.service');
const { signState, readState, TTL_MS } = require('../utils/oauth-state');
const { encrypt, decrypt } = require('../utils/token-crypto');

const PROVISION_SCOPE = 'eats.pos_provisioning';
const REQUIRED_ENV = ['UBER_EATS_REDIRECT_URI', 'OAUTH_STATE_SECRET', 'TOKEN_ENC_KEY'];
const MAX_PAGES = 20;

const isOAuthConfigured = () => uber.isConfigured() && REQUIRED_ENV.every((k) => process.env[k]);

function httpError(message, status = 400, detail) {
  const e = new Error(message);
  e.status = status;
  if (detail) e.detail = detail;
  return e;
}

/** Dirección de Uber a la que se manda al comercio para que autorice. */
function authorizeUrl(tenantId) {
  if (!isOAuthConfigured()) throw httpError('La conexión con Uber Eats no está configurada en el servidor.', 503);
  const cfg = uber.config();
  const q = new URLSearchParams({
    response_type: 'code',
    scope: PROVISION_SCOPE,
    client_id: cfg.clientId,
    redirect_uri: process.env.UBER_EATS_REDIRECT_URI,
    state: signState(tenantId, process.env.OAUTH_STATE_SECRET),
  });
  return `${cfg.authorizeUrl}?${q}`;
}

/** Cambia el código de un solo uso por el token del comercio. */
async function exchangeCode(code) {
  const cfg = uber.config();
  const res = await fetch(cfg.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: process.env.UBER_EATS_REDIRECT_URI,
      code,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw httpError('Uber Eats no aceptó la autorización', 502, String(data.error || res.status));
  return data.access_token;
}

/** Tiendas a las que el comercio dio acceso (con su token de usuario). */
async function listUserStores(token) {
  const stores = [];
  let key = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await uber.request(`/v1/eats/stores?limit=50${key ? `&start_key=${encodeURIComponent(key)}` : ''}`, { token });
    for (const s of r?.stores || []) {
      const loc = s.location || {};
      stores.push({ storeId: String(s.store_id), name: s.name || 'Tienda', address: [loc.address, loc.city].filter(Boolean).join(', ') });
    }
    key = r?.next_key || '';
    if (!key) break;
  }
  return stores;
}

/** Activa la tienda para este negocio. Se guarda el vínculo ANTES de avisar a Uber: su aviso `store.provisioned` ya la reconoce. */
async function activate(tenantId, token, store) {
  const taken = await db.GetIntegrationByStore('uber', store.storeId);
  if (taken && taken.tenantId !== String(tenantId)) throw httpError('Esa tienda ya está vinculada a otro negocio', 409);

  const prev = await db.GetIntegrationByTenant('uber', tenantId);
  await db.SaveIntegration('uber', tenantId, {
    storeId: store.storeId,
    storeName: store.name,
    storeAddress: store.address,
    linkedVia: 'oauth',
    activatedAt: new Date(),
    integrationEnabled: null,
    deprovisioned: false,
  });
  try {
    // is_order_manager: MiRestaurante recibe, acepta y cancela los pedidos (la tableta de Uber Eats deja de hacerlo)
    await uber.request(`/v1/eats/stores/${encodeURIComponent(store.storeId)}/pos_data`, {
      method: 'POST',
      token,
      body: { is_order_manager: true, integrator_store_id: String(tenantId) },
    });
  } catch (err) {
    // No quedó activada: se deja el vínculo como estaba
    if (prev) await db.SaveIntegration('uber', tenantId, { storeId: prev.storeId, storeName: prev.storeName || null, storeAddress: prev.storeAddress || null, linkedVia: prev.linkedVia || 'manual', activatedAt: prev.activatedAt || null, integrationEnabled: prev.integrationEnabled ?? null });
    else await db.DeleteIntegration('uber', tenantId);
    uber.recordEvent({ eventType: 'api.activate', storeId: store.storeId, tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    throw httpError(`Uber Eats no activó la tienda${err.detail ? `: ${err.detail}` : ''}`, 502);
  }

  // Si cambió de tienda, la anterior deja de mandarnos pedidos que nadie atendería
  if (prev?.storeId && prev.storeId !== store.storeId && prev.linkedVia === 'oauth') await deactivate(prev.storeId).catch(() => {});

  // ¿Uber ya enciende la integración? Se enciende con el gerente de socio el día del lanzamiento
  const info = await uber.request(`/v1/eats/stores/${encodeURIComponent(store.storeId)}/pos_data`, { scope: 'eats.store' }).catch(() => null);
  const integrationEnabled = info ? !!(info.integration_enabled ?? info.pos_integration_enabled) : null;
  await db.SaveIntegration('uber', tenantId, { integrationEnabled });
  await db.DeleteUberPending(tenantId);
  uber.recordEvent({ eventType: 'tienda.activada', storeId: store.storeId, tenantId, outcome: 'ok', detail: store.name });
  return { storeId: store.storeId, name: store.name, integrationEnabled };
}

/**
 * Apaga la integración de una tienda con el token de la aplicación (`PATCH /pos_data`, `integration_enabled: false`).
 * Quitarla del todo (`DELETE`) pide el token del comercio, que no conservamos.
 */
const deactivate = (storeId) =>
  uber.request(`/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, { method: 'PATCH', body: { integration_enabled: false }, scope: 'eats.store' });

/**
 * Quitar la integración del todo (`DELETE /pos_data`) exige el token del comercio, que no conservamos: se le manda a
 * Uber otra vez a autorizar, con la intención guardada aquí (no en la dirección) para que la vuelta sepa qué hacer.
 */
async function startRemoval(tenantId) {
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  if (!link?.storeId || link.linkedVia !== 'oauth') throw httpError('Esta tienda no se conectó con Uber Eats desde MiRestaurante', 400);
  const url = authorizeUrl(tenantId);
  await db.SaveUberPending(tenantId, { intent: 'remove', createdAt: new Date() });
  return url;
}

async function remove(tenantId, token) {
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  await db.DeleteUberPending(tenantId);
  if (!link?.storeId) return 'removed';
  try {
    await uber.request(`/v1/eats/stores/${encodeURIComponent(link.storeId)}/pos_data`, { method: 'DELETE', token });
  } catch (err) {
    uber.recordEvent({ eventType: 'api.remove', storeId: link.storeId, tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    throw httpError(`Uber Eats no quitó la tienda${err.detail ? `: ${err.detail}` : ''}`, 502);
  }
  await db.DeleteIntegration('uber', tenantId);
  uber.recordEvent({ eventType: 'tienda.quitada', storeId: link.storeId, tenantId, outcome: 'ok', detail: link.storeName || '' });
  return 'removed';
}

/** Vuelta de Uber: si el comercio tiene una sola tienda se activa; si tiene varias, elige en Ajustes. */
async function handleCallback({ code, state }) {
  const tenantId = readState(state, process.env.OAUTH_STATE_SECRET);
  const pending = await db.GetUberPending(tenantId);
  const removing = pending?.intent === 'remove' && Date.now() - new Date(pending.createdAt).getTime() <= TTL_MS;
  const token = await exchangeCode(code);
  if (removing) return { tenantId, outcome: await remove(tenantId, token) };
  const stores = await listUserStores(token);
  if (!stores.length) return { tenantId, outcome: 'none' };

  const free = [];
  for (const s of stores) {
    const link = await db.GetIntegrationByStore('uber', s.storeId);
    if (!link || link.tenantId === String(tenantId)) free.push(s);
  }
  if (!free.length) return { tenantId, outcome: 'taken' };
  if (free.length === 1) {
    await activate(tenantId, token, free[0]);
    return { tenantId, outcome: 'activated' };
  }
  await db.SaveUberPending(tenantId, { token: encrypt(token), stores: free, createdAt: new Date() });
  return { tenantId, outcome: 'choose' };
}

/** Tiendas entre las que el comercio debe elegir (sin el token). */
async function pendingStores(tenantId) {
  const p = await db.GetUberPending(tenantId);
  if (!p?.stores || Date.now() - new Date(p.createdAt).getTime() > TTL_MS) return [];
  return p.stores;
}

async function activatePending(tenantId, storeId) {
  const p = await db.GetUberPending(tenantId);
  const store = p?.stores && Date.now() - new Date(p.createdAt).getTime() <= TTL_MS ? p.stores.find((s) => s.storeId === String(storeId)) : null;
  if (!store) throw httpError('La autorización caducó. Vuelve a conectar con Uber Eats.', 400);
  return activate(tenantId, decrypt(p.token), store);
}

/** Avisos `store.provisioned` y `store.deprovisioned` de Uber (su contenido no está documentado: se busca la tienda donde pueda venir). */
async function onStoreEvent(ev) {
  const storeId = ev?.store_id || ev?.meta?.user_id || ev?.meta?.store_id || ev?.meta?.resource_id || null;
  const info = { eventType: ev?.event_type, storeId, orderId: null };
  const link = storeId ? await db.GetIntegrationByStore('uber', storeId) : null;
  if (!link) return { ...info, outcome: 'ignored', detail: 'tienda sin vincular' }; // Uber pide responder 200 igual
  if (ev.event_type === 'store.provisioned') {
    await db.SaveIntegration('uber', link.tenantId, { provisionedAt: new Date(), deprovisioned: false });
    return { ...info, tenantId: link.tenantId, outcome: 'ok', detail: 'Uber confirmó la activación' };
  }
  await db.SaveIntegration('uber', link.tenantId, { deprovisioned: true, deprovisionedAt: new Date() });
  return { ...info, tenantId: link.tenantId, outcome: 'ok', detail: 'Uber retiró el acceso a la tienda' };
}

module.exports = { isOAuthConfigured, authorizeUrl, startRemoval, handleCallback, pendingStores, activatePending, deactivate, onStoreEvent, httpError };
