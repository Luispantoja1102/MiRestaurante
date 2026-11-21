/**
 * Menú de Uber Eats: publica el menú de MiRestaurante y marca como agotado lo que se acaba en el inventario.
 *
 * - Subir el menú (PUT) REEMPLAZA todo el menú de la tienda en Uber: lo que no vaya en la subida se borra.
 * - Los precios van en centavos (enteros) y el IVA se suma al precio, igual que en nuestros pedidos.
 * - Un producto (o un extra) está agotado cuando un ingrediente de su receta tiene existencia 0 o menos,
 *   el mismo criterio de las pantallas. Uber lo guarda como «suspendido hasta» una hora; la renovamos al abrir la caja.
 *
 * Formato revisado contra la referencia de Uber (2026-11-21): una sola traducción `es_mx`, `price_info` con precio en tienda,
 *    `vat_rate_percentage`/`tax_rate`, fotos JPG/WEBP/PNG de 320 a 6000 px. ⚠️ Sin dato en la doc: largo máximo de títulos.
 */
const db = require('../database/mongodb');
const uber = require('./uber.service');
const { extraItemId } = require('../models/uberIds');
const { DEFAULT_TAX_RATE, rateOf, includesTax } = require('../utils/tax');
const { PLANS, DEFAULT_PRICING, normalizePricing, uberCut, increasePct, isHighIncrease, uberPrice } = require('../utils/uberPricing');

const MENU_SCOPE = 'eats.store';
const SUSPEND_HOURS = 24; // un agotado vence solo si no lo renovamos o reanudamos
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function httpError(message, status = 400, detail) {
  const e = new Error(message);
  e.status = status;
  if (detail) e.detail = detail;
  return e;
}

const cents = (n) => Math.round(Number(n || 0) * 100);
// Uber pide el texto por idioma y dice que se mande UNA sola traducción (se muestra a todos): en español de México
const text = (s) => ({ translations: { es_mx: String(s).slice(0, 100) } });
// `price_info` pide también el precio en tienda y el descontado; se mandan iguales al precio del menú
const priceInfo = (price) => ({ price, in_store_price: price, in_store_discounted_price: price });
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Ids de Uber (productos y extras) que hoy están agotados. */
function unavailableItemIds(foods, ingredientsById) {
  const out = (id) => (ingredientsById.get(String(id))?.stock ?? 1) <= 0;
  const ids = new Set();
  for (const f of foods) {
    if ((f.recipe || []).some((l) => out(l.ingredientId))) ids.add(String(f.id));
    for (const e of f.extras || []) if (out(e.ingredientId)) ids.add(extraItemId(f, e));
  }
  return ids;
}

/** Convierte el menú de MiRestaurante al formato de Uber. @returns { body, itemIds, outIds } */
function buildMenu({ foods, menus, ingredients, title, open, close, taxRate = DEFAULT_TAX_RATE, pricing = null, now = Date.now() }) {
  // Con «precios para Uber» activos, cada precio sube lo que se queda Uber (ver utils/uberPricing.js)
  const priced = (price, food) => uberPrice(price, { includesTax: includesTax(food.priceIncludesTax), taxRate }, pricing).price;
  // Precio con IVA incluido → `vat_rate_percentage`; precio sin IVA (se suma al cobrar) → `tax_rate`. ⚠️ confirmar en el sandbox.
  const pct = Math.round(rateOf(taxRate) * 10000) / 100;
  const taxInfo = (included) => (included ? { vat_rate_percentage: pct } : { tax_rate: pct });
  const ingredientsById = new Map(ingredients.map((i) => [String(i.id), i]));
  const outIds = unavailableItemIds(foods, ingredientsById);
  const until = Math.floor(now / 1000) + SUSPEND_HOURS * 3600;
  const suspended = (id) => (outIds.has(id) ? { suspension_info: { suspension: { suspend_until: until, reason: 'Agotado' } } } : {});

  const categories = [];
  const items = [];
  const groups = [];
  for (const menu of menus) {
    const mine = foods.filter((f) => String(f.menuId) === String(menu.id));
    if (!mine.length) continue; // Uber no acepta categorías vacías
    categories.push({ id: String(menu.id), title: text(menu.name), entities: mine.map((f) => ({ type: 'ITEM', id: String(f.id) })) });
    for (const f of mine) {
      const extras = f.extras || [];
      const groupId = `${f.id}_extras`;
      items.push({
        id: String(f.id),
        title: text(f.name),
        ...(f.description ? { description: text(f.description) } : {}),
        ...(/^https:\/\//i.test(f.imgUrl || '') ? { image_url: f.imgUrl } : {}), // Uber solo acepta una dirección https
        price_info: priceInfo(cents(priced(f.price, f))),
        tax_info: taxInfo(includesTax(f.priceIncludesTax)),
        external_data: String(f.id),
        ...(extras.length ? { modifier_group_ids: { ids: [groupId] } } : {}),
        ...suspended(String(f.id)),
      });
      if (!extras.length) continue;
      groups.push({
        id: groupId,
        title: text('Extras'),
        quantity_info: { quantity: { min_permitted: 0, max_permitted: extras.reduce((n, e) => n + Number(e.max || 1), 0) } },
        modifier_options: extras.map((e) => ({ type: 'ITEM', id: extraItemId(f, e) })),
      });
      for (const e of extras) {
        items.push({
          id: extraItemId(f, e),
          title: text(e.label),
          price_info: priceInfo(cents(priced(e.price, f))),
          tax_info: taxInfo(includesTax(f.priceIncludesTax)), // el extra lleva la misma marca que su platillo
          quantity_info: { quantity: { min_permitted: 0, max_permitted: Number(e.max || 1) } },
          ...suspended(extraItemId(f, e)),
        });
      }
    }
  }

  return {
    body: {
      menus: [{
        id: 'principal',
        title: text(title || 'Menú'),
        service_availability: DAYS.map((d) => ({ day_of_week: d, time_periods: [{ start_time: open, end_time: close }] })),
        category_ids: categories.map((c) => c.id),
      }],
      categories,
      items,
      modifier_groups: groups,
    },
    itemIds: items.map((i) => i.id),
    outIds,
  };
}

function checkHours(open, close) {
  if (!HHMM.test(open) || !HHMM.test(close)) throw httpError('El horario debe ser de la forma 08:00');
  if (minutes(close) - minutes(open) <= 60) throw httpError('El menú debe estar disponible más de una hora seguida');
}

/** Sube el menú completo a Uber (reemplaza el que tenga la tienda). */
async function publishMenu(tenantId, hours = {}) {
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  if (!link?.storeId) throw httpError('Vincula primero tu tienda de Uber Eats');
  const open = hours.open || link.menuHours?.open || '00:00';
  const close = hours.close || link.menuHours?.close || '23:59';
  checkHours(open, close);

  const [foods, menus, ingredients, settings] = await Promise.all([db.GetFoods(tenantId), db.GetMenus(tenantId), db.GetIngredients(tenantId), db.GetSettings(tenantId)]);
  const built = buildMenu({ foods, menus, ingredients, title: settings?.businessName, open, close, taxRate: settings?.taxRate, pricing: link.pricing });
  if (!built.body.items.length) throw httpError('Agrega productos a tus categorías antes de publicar el menú');

  try {
    await uber.request(`/v2/eats/stores/${encodeURIComponent(link.storeId)}/menus`, { method: 'PUT', body: built.body, gzip: true, scope: MENU_SCOPE });
  } catch (err) {
    uber.recordEvent({ eventType: 'api.menu', storeId: link.storeId, tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    throw httpError(`Uber Eats no aceptó el menú${err.detail ? `: ${err.detail}` : ''}`, 502);
  }
  await db.SaveIntegration('uber', tenantId, { menuPublishedAt: new Date(), menuHours: { open, close }, publishedItemIds: built.itemIds, suspendedIds: [...built.outIds], menuDirty: false });
  return { items: built.itemIds.length, categories: built.body.categories.length, outOfStock: built.outIds.size, hours: { open, close } };
}

/** Lo que se ve en Ajustes: estado del menú publicado y qué está agotado ahora (no consulta a Uber). */
async function menuStatus(tenantId) {
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  const [foods, ingredients] = await Promise.all([db.GetFoods(tenantId), db.GetIngredients(tenantId)]);
  const byId = new Map(ingredients.map((i) => [String(i.id), i]));
  const out = unavailableItemIds(foods, byId);
  return {
    published: !!link?.menuPublishedAt,
    publishedAt: link?.menuPublishedAt || null,
    hours: link?.menuHours || { open: '00:00', close: '23:59' },
    items: (link?.publishedItemIds || []).length,
    dirty: !!link?.menuDirty,
    autoPublish: link?.autoPublish !== false,
    // ¿Los precios salen ajustados a lo que cobra Uber? Si no, el menú se publica con los precios del local
    pricing: (() => {
      const p = { ...DEFAULT_PRICING, ...(link?.pricing || {}) };
      return { enabled: !!p.enabled, plan: p.plan, label: PLANS[p.plan]?.label || '', cutPct: Math.round(uberCut(p) * 10000) / 100 };
    })(),
    foods: foods.length,
    outOfStock: foods.filter((f) => out.has(String(f.id))).map((f) => f.name),
  };
}

/** Precios para Uber: la configuración guardada y, producto por producto, cuánto cuesta en el local, en Uber y cuánto te queda. */
async function pricingPreview(tenantId, draft = null) {
  const [link, foods, settings] = await Promise.all([db.GetIntegrationByTenant('uber', tenantId), db.GetFoods(tenantId), db.GetSettings(tenantId)]);
  let pricing = { ...DEFAULT_PRICING, ...(link?.pricing || {}) };
  if (draft) {
    // Vista previa de lo que el negocio está escribiendo, sin guardarlo
    const n = normalizePricing({ ...draft, enabled: true });
    if (n.error) throw httpError(n.error);
    pricing = { ...n.value, enabled: pricing.enabled };
  }
  const rows = foods.map((f) => {
    const p = uberPrice(f.price, { includesTax: includesTax(f.priceIncludesTax), taxRate: settings?.taxRate }, { ...pricing, enabled: true });
    return { id: String(f.id), name: f.name, local: p.base, uber: p.gross, net: p.net };
  });
  return {
    pricing,
    cutPct: Math.round(uberCut(pricing) * 10000) / 100,
    increasePct: increasePct(pricing), // cuánto suben los precios en Uber respecto al local
    highIncrease: isHighIncrease(pricing), // aumento fuerte: pide una segunda confirmación al guardar
    plans: PLANS,
    rows,
  };
}

/** Guarda el plan y los precios de Uber; si el menú ya está publicado, se vuelve a subir con los precios nuevos. */
async function setPricing(tenantId, input, by = null) {
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  if (!link?.storeId) throw httpError('Vincula primero tu tienda de Uber Eats');
  const { value, error } = normalizePricing(input);
  if (error) throw httpError(error);
  const prev = link.pricing || {};
  if (value.enabled) {
    // Uber no dice qué plan tiene cada comercio: lo confirma una persona y queda registrado quién y cuándo
    if (input.confirmed !== true) throw httpError('Confirma que ese es el plan de tu contrato con Uber Eats');
    if (isHighIncrease(value) && input.confirmHigh !== true) {
      throw httpError(`Con esos porcentajes tus precios en Uber subirían cerca de ${increasePct(value)}%. Confirma que lo entiendes para guardar.`);
    }
    Object.assign(value, { confirmedBy: by || null, confirmedAt: new Date() });
  } else if (prev.confirmedAt) {
    Object.assign(value, { confirmedBy: prev.confirmedBy || null, confirmedAt: prev.confirmedAt }); // apagarlo no borra quién lo confirmó
  }
  await db.SaveIntegration('uber', tenantId, { pricing: value });
  await onMenuChanged(tenantId);
  return value;
}

const suspensionBody = (until) => ({ suspension_info: { suspension: { suspend_until: until, reason: until ? 'Agotado' : null }, overrides: [] } });
const setItemSuspension = (storeId, itemId, until) =>
  uber.request(`/v2/eats/stores/${encodeURIComponent(storeId)}/menus/items/${encodeURIComponent(itemId)}`, { method: 'POST', body: suspensionBody(until), scope: MENU_SCOPE });

async function doSync(tenantId, { force }) {
  if (!uber.isConfigured()) return;
  const link = await db.GetIntegrationByTenant('uber', tenantId);
  if (!link?.storeId || !link.menuPublishedAt) return;
  const [foods, ingredients] = await Promise.all([db.GetFoods(tenantId), db.GetIngredients(tenantId)]);
  const published = new Set(link.publishedItemIds || []); // lo creado después de publicar no existe en Uber (daría 404)
  const nowOut = new Set([...unavailableItemIds(foods, new Map(ingredients.map((i) => [String(i.id), i])))].filter((id) => published.has(id)));
  const before = new Set(link.suspendedIds || []);
  const until = Math.floor(Date.now() / 1000) + SUSPEND_HOURS * 3600;
  const state = new Set(before);

  const apply = async (ids, value) => {
    for (const id of ids) {
      try {
        await setItemSuspension(link.storeId, id, value);
        if (value) state.add(id);
        else state.delete(id);
      } catch (err) {
        uber.recordEvent({ eventType: 'api.menu-item', orderId: id, storeId: link.storeId, tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
      }
    }
  };
  await apply([...nowOut].filter((id) => force || !before.has(id)), until);
  await apply([...before].filter((id) => !nowOut.has(id)), null); // ya hay existencia: se reanuda
  if (state.size !== before.size || [...state].some((id) => !before.has(id))) await db.SaveIntegration('uber', tenantId, { suspendedIds: [...state] });
}

// Una a la vez por negocio: dos ventas seguidas no deben pisarse al hablar con Uber
const queues = new Map();
/** Marca como agotado (o reanuda) en Uber lo que cambió. Nunca estorba a quien lo llama. */
function syncAvailability(tenantId, { force = false } = {}) {
  const key = String(tenantId);
  const next = (queues.get(key) || Promise.resolve())
    .then(() => doSync(tenantId, { force }))
    .catch((err) => console.error('[uber] disponibilidad:', err.message));
  queues.set(key, next);
  return next;
}

// Un cambio de producto, categoría, precio o receta llega a Uber solo si el negocio ya publicó su menú.
// Una publicación a la vez por negocio: si hay cambios mientras sube, se sube otra vez al terminar.
const publishing = new Map();
function republish(tenantId) {
  const key = String(tenantId);
  const running = publishing.get(key);
  if (running) {
    running.again = true;
    return running.promise;
  }
  const st = { again: false };
  st.promise = (async () => {
    try {
      do {
        st.again = false;
        await publishMenu(tenantId).catch((err) => console.error('[uber] menú:', err.message)); // el error ya queda en la bitácora
      } while (st.again);
    } finally {
      publishing.delete(key);
    }
  })();
  publishing.set(key, st);
  return st.promise;
}

/** Se llama al crear, editar o borrar productos y categorías. Nunca estorba ni lanza errores. */
async function onMenuChanged(tenantId) {
  try {
    const link = await db.GetIntegrationByTenant('uber', tenantId);
    if (!uber.isConfigured() || !link?.menuPublishedAt) return;
    // Queda anotado que hay cambios sin subir: la pantalla lo dice y, si Uber falla, se sube al abrir la caja
    await db.SaveIntegration('uber', tenantId, { menuDirty: true });
    if (link.autoPublish !== false) await republish(tenantId);
  } catch (err) {
    console.error('[uber] menú:', err.message);
  }
}

/** Al abrir la caja: si quedaron cambios sin subir (Uber falló o el servidor se reinició), se suben. */
async function republishIfDirty(tenantId) {
  try {
    const link = await db.GetIntegrationByTenant('uber', tenantId);
    if (uber.isConfigured() && link?.menuPublishedAt && link.menuDirty && link.autoPublish !== false) await republish(tenantId);
  } catch (err) {
    console.error('[uber] menú:', err.message);
  }
}

/** Uber pide que se le vuelva a mandar el menú (aviso `store.menu_refresh_request`, con `store_id` arriba). */
async function onRefreshRequest(ev) {
  const info = { eventType: ev?.event_type, storeId: ev?.store_id || null, orderId: null };
  const link = info.storeId ? await db.GetIntegrationByStore('uber', info.storeId) : null;
  if (!link) return { ...info, outcome: 'ignored', detail: 'tienda sin vincular' };
  if (!link.menuPublishedAt) return { ...info, tenantId: link.tenantId, outcome: 'ignored', detail: 'el negocio no ha publicado su menú' };
  await publishMenu(link.tenantId);
  return { ...info, tenantId: link.tenantId, outcome: 'ok', detail: 'menú publicado de nuevo' };
}

module.exports = { buildMenu, unavailableItemIds, publishMenu, menuStatus, pricingPreview, setPricing, syncAvailability, onMenuChanged, republishIfDirty, onRefreshRequest, httpError };
