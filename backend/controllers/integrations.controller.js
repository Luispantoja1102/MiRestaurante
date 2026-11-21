const db = require('../database/mongodb');
const uber = require('../services/uber.service');
const uberMenu = require('../services/uber.menu.service');
const activation = require('../services/uber.activation.service');
const inventory = require('../services/inventory.service');
const { todayIn, fromUber, toUber } = require('../utils/holidays');
const { handle } = require('../utils/handle');

// Cada tipo de aviso tiene su atención; los de pedidos están en uber.service
const dispatch = (ev) => {
  const type = ev?.event_type;
  if (type === 'store.menu_refresh_request') return uberMenu.onRefreshRequest(ev);
  if (type === 'store.provisioned' || type === 'store.deprovisioned') return activation.onStoreEvent(ev);
  return uber.handleEvent(ev);
};

/** Webhook público de Uber: se acepta solo si la firma es válida. */
async function uberWebhook(req, res) {
  if (!uber.isConfigured()) return res.status(503).send('Uber Eats no está configurado');
  if (!uber.verifySignature(req.rawBody, req.get('X-Uber-Signature'))) {
    return res.status(401).send('Firma inválida');
  }
  try {
    uber.recordEvent(await dispatch(req.body));
    return res.status(200).end(); // Uber espera 200 con cuerpo vacío
  } catch (err) {
    // Un error pasajero (red, Uber caído) devuelve 500 para que Uber reintente; guardar es idempotente.
    console.error('[uber] webhook:', err.message);
    uber.recordEvent({ eventType: req.body?.event_type || 'desconocido', orderId: req.body?.meta?.resource_id || null, storeId: req.body?.meta?.user_id || null, outcome: 'error', detail: err.message });
    return res.status(500).end();
  }
}

const uberStatus = handle('Error al leer la integración', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  const cfg = uber.config();
  return res.status(200).json({
    configured: uber.isConfigured(),
    environment: cfg.env,
    oauth: activation.isOAuthConfigured(),
    storeId: link?.storeId || '',
    storeName: link?.storeName || '',
    storeAddress: link?.storeAddress || '',
    linkedVia: link?.linkedVia || (link?.storeId ? 'manual' : ''),
    integrationEnabled: link?.integrationEnabled ?? null,
    deprovisioned: !!link?.deprovisioned,
    linkedAt: link?.updatedAt || null,
    autoPause: link?.autoPause !== false,
  });
});

const uberUnlink = handle('Error al desvincular la tienda', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  // Una tienda que activamos nosotros sigue mandando pedidos que nadie atendería: se apaga en Uber (si se puede)
  let deactivated = null;
  if (link?.storeId && link.linkedVia === 'oauth' && !link.deprovisioned) {
    deactivated = await activation.deactivate(link.storeId).then(() => true, (err) => {
      uber.recordEvent({ eventType: 'api.deactivate', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
      return false;
    });
  }
  await db.DeleteIntegration('uber', req.tenantId);
  return res.status(200).json({ storeId: '', deactivated });
});

// —— Aceptar o rechazar un pedido que llegó de Uber Eats
async function loadAwaiting(req, res) {
  const order = await db.GetOrderById(req.params.id, req.tenantId);
  if (!order) { res.status(404).send('Pedido no encontrado'); return null; }
  if (order.external?.provider !== 'uber' || order.external?.state !== 'awaiting') {
    res.status(400).send('Este pedido no está esperando respuesta de Uber Eats');
    return null;
  }
  return order;
}

// Lo que falla al hablar con Uber queda en la bitácora para poder revisarlo después
const logApiError = (req, order, action, err) =>
  uber.recordEvent({ eventType: `api.${action}`, orderId: order.external?.orderId || null, storeId: order.external?.storeId || null, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });

const uberFail = (res, err) => {
  console.error('[uber]', err.message);
  const expired = err.status === 404 || err.status === 409 || err.status === 400;
  return res
    .status(502)
    .send(expired ? 'Uber Eats ya no acepta este pedido (venció o fue cancelado). Actualiza la pantalla.' : 'No se pudo contactar a Uber Eats. Intenta de nuevo.');
};

const acceptUberOrder = handle('Error al aceptar el pedido', async (req, res) => {
  const order = await loadAwaiting(req, res);
  if (!order) return null;
  // Igual que una venta de mostrador: lo cobrado entra en el cierre de la caja abierta
  // Pedido programado, primera vez: solo se confirma. Uber lo vuelve a pedir a su hora y entonces se acepta de verdad (se cobra y pasa a cocina)
  const firstRound = Boolean(order.external.scheduled) && !order.external.acceptedAt;
  const session = await db.GetOpenCashSession(req.tenantId);
  if (!session && !firstRound) return res.status(400).send('Abre la caja antes de aceptar el pedido');

  // «Listo en N minutos»: Uber lo usa para mandar al repartidor a tiempo
  const prep = Number(req.body?.prepMinutes);
  const prepMinutes = !firstRound && Number.isFinite(prep) && prep >= 1 && prep <= 180 ? Math.round(prep) : null;
  const now = new Date();
  const pickupAt = prepMinutes ? new Date(now.getTime() + prepMinutes * 60_000) : null;
  try {
    await uber.acceptOrder(order.external.orderId, { externalRef: order.id, pickupTime: pickupAt && pickupAt.getTime() / 1000, acceptedBy: req.user?.username, pickupInstructions: String(req.body?.pickupInstructions || '').trim() });
  } catch (err) {
    logApiError(req, order, 'accept', err);
    return uberFail(res, err);
  }
  if (firstRound) {
    const scheduled = await db.UpdateOrder(
      order.id,
      { external: { ...order.external, state: 'scheduled', acceptedAt: now, acceptedBy: req.user?.username || null }, updatedAt: now },
      req.tenantId
    );
    return res.status(200).json(scheduled);
  }
  // Queda «En preparación» hasta que alguien lo marque listo (en Cocina o con «Listo para recoger» en Caja): eso es lo que
  // le avisa a Uber que ya puede mandar al repartidor.
  const updated = await db.UpdateOrder(
    order.id,
    {
      status: 'preparing',
      paymentStatus: 'paid',
      paymentMethod: 'platform',
      paidAt: now,
      cashSessionId: session.id,
      external: { ...order.external, state: 'accepted', acceptedAt: now, acceptedBy: req.user?.username || null, ...(pickupAt ? { pickupAt } : {}) },
      updatedAt: now,
    },
    req.tenantId
  );
  return res.status(200).json(updated);
});

const DENY_TO_CANCEL = { ITEM_AVAILABILITY: 'OUT_OF_ITEMS', CAPACITY: 'RESTAURANT_TOO_BUSY', STORE_CLOSED: 'KITCHEN_CLOSED', SPECIAL_INSTRUCTIONS: 'CANNOT_COMPLETE_CUSTOMER_NOTE' };

const denyUberOrder = handle('Error al rechazar el pedido', async (req, res) => {
  const order = await loadAwaiting(req, res);
  if (!order) return null;
  try {
    // Si el motivo es un producto agotado, se le dice a Uber cuál(es)
    const chosen = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    const items = req.body?.code === 'ITEM_AVAILABILITY'
      ? (order.items || []).filter((i) => i.uberItemId && chosen.includes(i.cartItemId)).map((i) => ({ id: i.uberItemId, externalId: i.foodId }))
      : [];
    await uber.denyOrder(order.external.orderId, {
      code: req.body?.code,
      explanation: String(req.body?.explanation || '').trim() || 'No se puede preparar',
      items,
    });
  } catch (err) {
    logApiError(req, order, 'deny', err);
    return uberFail(res, err);
  }
  const now = new Date();
  const patch = {
    status: 'cancelled',
    external: { ...order.external, state: 'denied', closedAt: now, deniedBy: req.user?.username || null },
    updatedAt: now,
  };
  // Uber puede dejar el pedido rechazado en la tablet: se intenta también cancelarlo ahí (si no se puede, queda «Cancelar en Uber»)
  const explanation = String(req.body?.explanation || '').trim();
  try {
    await uber.cancelOrder(order.external.orderId, { reason: DENY_TO_CANCEL[req.body?.code] || 'OTHER', details: explanation });
    patch.external = { ...patch.external, uberCanceledAt: now, cancelReason: DENY_TO_CANCEL[req.body?.code] || 'OTHER' };
  } catch (err) {
    logApiError(req, order, 'cancel', err);
  }
  await inventory.restoreInto(patch, { tenantId: req.tenantId, order, by: req.user?.username });
  return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
});

// —— Pedido ya aceptado: cancelarlo o avisar cómo va la entrega
async function loadAccepted(req, res, allowServed = false) {
  const order = await db.GetOrderById(req.params.id, req.tenantId);
  if (!order) { res.status(404).send('Pedido no encontrado'); return null; }
  // Un pedido rechazado puede seguir vivo en la tablet de Uber («Error de sincronización con el PDV»): se intenta cancelar ahí
  if (allowServed && deniedCancellable(order)) return order;
  if (order.external?.provider !== 'uber' || !['accepted', 'scheduled'].includes(order.external?.state)) {
    res.status(400).send('Este pedido de Uber Eats no está aceptado');
    return null;
  }
  if (order.status === 'cancelled' || (order.status === 'served' && !(allowServed && servedCancellable(order)))) {
    res.status(400).send('Este pedido ya terminó');
    return null;
  }
  return order;
}

// «Servido» no le avisa nada a Uber: si no lo reparte el restaurante, en Uber sigue vivo y se puede cancelar unas horas más
const SERVED_CANCEL_MS = 2 * 60 * 60 * 1000;
const deniedCancellable = (o) =>
  o.external?.provider === 'uber' && o.external?.state === 'denied' && !o.external.uberCanceledAt && Date.now() - new Date(o.external.closedAt || 0).getTime() <= SERVED_CANCEL_MS;
const servedCancellable = (o) =>
  o.external?.type !== 'DELIVERY_BY_RESTAURANT' && Date.now() - new Date(o.updatedAt || 0).getTime() <= SERVED_CANCEL_MS;

// Uber responde 404 si el pedido ya está en un estado final (cancelado o entregado)
// Lo que Uber dice que está mal (su mensaje o la descripción del campo), para mostrarlo tal cual
const uberReason = (err) => {
  try {
    const j = JSON.parse(err.detail);
    return j.metadata?.field_violations?.[0]?.description || j.message || '';
  } catch {
    return '';
  }
};
const uberClosed = (res, err) => {
  console.error('[uber]', err.message);
  if (err.status === 404) return res.status(502).send('Uber Eats ya no permite este cambio (el pedido terminó o fue cancelado). Actualiza la pantalla.');
  if (err.status === 400) return res.status(502).send(`Uber Eats no aceptó el cambio${uberReason(err) ? `: ${uberReason(err)}` : ''}`);
  return res.status(502).send('No se pudo contactar a Uber Eats. Intenta de nuevo.');
};

const cancelUberOrder = handle('Error al cancelar el pedido', async (req, res) => {
  const order = await loadAccepted(req, res, true);
  if (!order) return null;
  const code = uber.CANCEL_REASONS.includes(req.body?.code) ? req.body.code : 'OTHER';
  const details = String(req.body?.details || '').trim();
  if (code === 'OTHER' && !details) return res.status(400).send('Escribe el motivo de la cancelación');
  try {
    await uber.cancelOrder(order.external.orderId, { reason: code, details });
  } catch (err) {
    logApiError(req, order, 'cancel', err);
    // «El pedido ya no está activo»: Uber ya lo cerró. Se refleja aquí lo que Uber tiene (cancelado o entregado) en vez de dejarlo a medias.
    if (/no longer active/i.test(err.detail || '')) {
      const st = await uber.fetchStatus(order.external.orderId).catch(() => null);
      if (st?.state === 'FAILED') return res.status(200).json(await uber.cancelFromUber(order.external.orderId));
      if (st?.state === 'SUCCEEDED') return res.status(200).json(await db.UpdateOrder(order.id, { status: 'served', updatedAt: new Date() }, req.tenantId));
    }
    return uberClosed(res, err);
  }
  const now = new Date();
  if (order.external.state === 'denied') {
    // Ya estaba cancelado aquí (inventario devuelto): solo queda registrado que Uber también lo canceló
    const done = { ...order.external, uberCanceledAt: now, canceledBy: req.user?.username || null, cancelReason: code };
    return res.status(200).json(await db.UpdateOrder(order.id, { external: done, updatedAt: now }, req.tenantId));
  }
  const patch = {
    status: 'cancelled',
    // Ya no se cobra a Uber: sale del cierre de caja
    paymentStatus: order.paymentStatus === 'paid' ? 'refunded' : order.paymentStatus,
    external: { ...order.external, state: 'canceled', closedAt: now, canceledBy: req.user?.username || null, cancelReason: code },
    updatedAt: now,
  };
  await inventory.restoreInto(patch, { tenantId: req.tenantId, order, by: req.user?.username });
  return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
});

// —— Lo que Uber dice del pedido: si ya lo ve listo, qué acciones permite y dónde va el repartidor
const uberSyncOrder = handle('Error al consultar a Uber Eats', async (req, res) => {
  const order = await db.GetOrderById(req.params.id, req.tenantId);
  if (!order || order.external?.provider !== 'uber') return res.status(404).send('Pedido no encontrado');
  let updated;
  try {
    updated = await uber.syncOrder(order);
  } catch (err) {
    logApiError(req, order, 'sync', err);
    return uberClosed(res, err);
  }
  if (!updated) return res.status(502).send('Uber Eats no dio el estado de este pedido.');
  return res.status(200).json(updated);
});

const ONCE_MSG = 'Uber solo deja cambiar la hora de listo una vez por pedido.';
// Alarga la hora en que estará listo (+N minutos sobre la que ya se había dicho)
const uberReadyTime = handle('Error al cambiar la hora de listo', async (req, res) => {
  const order = await loadAccepted(req, res);
  if (!order) return null;
  const ext = order.external;
  if (ext.state !== 'accepted' || !['pending', 'preparing'].includes(order.status) || ext.readyNotifiedAt) return res.status(400).send('Este pedido ya no admite cambiar la hora de listo');
  if (ext.readyAdjusted) return res.status(400).send(ONCE_MSG);
  const add = Number(req.body?.addMinutes);
  if (!Number.isFinite(add) || add < 1 || add > 60) return res.status(400).send('Elige entre 1 y 60 minutos');
  const can = ext.sync?.adjustReadyTime;
  if (can && can.eligible === false) return res.status(400).send(`Uber no permite cambiar la hora de este pedido${can.reason ? `: ${can.reason}` : ''}`);
  const readyAt = new Date(Math.max(Date.now(), new Date(ext.pickupAt || 0).getTime()) + Math.round(add) * 60_000);
  try {
    await uber.updateReadyTime(ext.orderId, readyAt);
  } catch (err) {
    logApiError(req, order, 'ready_time', err);
    if (/ALREADY_ADJUSTED/.test(err.detail || '')) {
      await db.UpdateOrder(order.id, { external: { ...ext, readyAdjusted: true }, updatedAt: new Date() }, req.tenantId);
      return res.status(400).send(ONCE_MSG);
    }
    return uberClosed(res, err);
  }
  // Uber deja cambiar la hora de listo una sola vez por pedido
  return res.status(200).json(await db.UpdateOrder(order.id, { external: { ...ext, pickupAt: readyAt, readyAdjusted: true }, updatedAt: new Date() }, req.tenantId));
});

// Un producto se agotó: se le pregunta al cliente en su app si lo cambia o lo quita (sin rechazar todo el pedido)
const uberAskCustomer = handle('Error al avisar del producto agotado', async (req, res) => {
  const order = await loadAccepted(req, res);
  if (!order) return null;
  const ext = order.external;
  if (ext.state !== 'accepted') return res.status(400).send('Este pedido aún no se acepta de verdad');
  const issueType = uber.ISSUE_TYPES.includes(req.body?.issueType) ? req.body.issueType : 'OUT_OF_ITEM';
  const item = (order.items || []).find((i) => i.cartItemId && i.cartItemId === req.body?.cartItemId);
  // La nota general del pedido no es de un producto; lo demás sí necesita saber cuál
  if (!item && issueType !== 'CANNOT_FULFILL_MERCHANT_INSTRUCTION') return res.status(400).send('Elige el producto');
  if (ext.askingCustomer) return res.status(400).send('Ya le preguntaste al cliente: espera su respuesta');
  const can = issueType === 'OUT_OF_ITEM' ? ext.sync?.outOfItem : ext.sync?.cannotFulfill;
  if (can && can.eligible === false) return res.status(400).send(`Uber no permite avisar de este problema en este pedido${can.reason ? `: ${can.reason}` : ''}`);
  let answer;
  try {
    answer = await uber.askCustomerAboutItem(ext.orderId, { cartItemId: item?.cartItemId, issueType, message: String(req.body?.message || '').trim() });
  } catch (err) {
    logApiError(req, order, 'out_of_item', err);
    return uberClosed(res, err);
  }
  const now = new Date();
  const asking = answer?.should_wait_for_customer_response === false ? null : { cartItemId: item?.cartItemId || null, name: item?.name || 'la nota del pedido', issueType, at: now };
  return res.status(200).json(await db.UpdateOrder(order.id, { external: { ...ext, askingCustomer: asking }, updatedAt: now }, req.tenantId));
});

// Cambia el precio de un pedido activo: el cliente lo acepta o no en su app
const uberAdjustPrice = handle('Error al cambiar el precio', async (req, res) => {
  const order = await loadAccepted(req, res);
  if (!order) return null;
  const ext = order.external;
  if (ext.state !== 'accepted') return res.status(400).send('Este pedido aún no se acepta de verdad');
  if (ext.priceAdjust) return res.status(400).send('Ya hay un cambio de precio esperando la respuesta del cliente');
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 5000) return res.status(400).send('Escribe un monto distinto de cero (negativo si baja el precio)');
  const reason = uber.ADJUST_REASONS.includes(req.body?.reason) ? req.body.reason : 'OTHER';
  const customReason = String(req.body?.customReason || '').trim();
  if (reason === 'OTHER' && !customReason) return res.status(400).send('Escribe el motivo del cambio de precio');
  const taxRate = req.body?.taxRate === '' || req.body?.taxRate == null ? undefined : Number(req.body.taxRate);
  if (taxRate !== undefined && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 60)) return res.status(400).send('La tasa de IVA no es válida');
  try {
    await uber.adjustPrice(ext.orderId, { amount, taxRate, reason, customReason });
  } catch (err) {
    logApiError(req, order, 'adjust_price', err);
    return uberClosed(res, err);
  }
  const now = new Date();
  return res.status(200).json(await db.UpdateOrder(order.id, { external: { ...ext, priceAdjust: { amount, reason, customReason, at: now, by: req.user?.username || null } }, updatedAt: now }, req.tenantId));
});

// Solo pedidos que reparte el propio restaurante: salió (started), va llegando (arriving), entregado (delivered)
const deliveryStatusUberOrder = handle('Error al avisar la entrega', async (req, res) => {
  const order = await loadAccepted(req, res);
  if (!order) return null;
  const status = req.body?.status;
  if (!uber.DELIVERY_STATUSES.includes(status)) return res.status(400).send('Estado de entrega inválido');
  if (order.external.type !== 'DELIVERY_BY_RESTAURANT') {
    return res.status(400).send('Este pedido no lo reparte el restaurante: Uber lleva el seguimiento');
  }
  try {
    await uber.restaurantDeliveryStatus(order.external.orderId, status);
  } catch (err) {
    logApiError(req, order, 'delivery', err);
    return uberClosed(res, err);
  }
  const now = new Date();
  const patch = { external: { ...order.external, deliveryStatus: status }, updatedAt: now };
  if (status === 'delivered') patch.status = 'served';
  return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
});

// —— Estado de la tienda en Uber (en línea o pausada)
const uberStoreStatus = handle('Error al leer el estado de la tienda', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(200).json({ linked: false });
  const base = { linked: true, autoPause: link.autoPause !== false, pausedByCash: !!link.pausedByCash };
  try {
    const s = await uber.storeStatus(link.storeId);
    return res.status(200).json({ ...base, status: s?.status || null, offlineReason: s?.offlineReason || null });
  } catch (err) {
    console.error('[uber]', err.message);
    return res.status(200).json({ ...base, error: 'No se pudo consultar el estado a Uber Eats' });
  }
});

// Pausar (con o sin hora para reanudarse sola) o reanudar la tienda a mano
const uberSetStoreStatus = handle('Error al cambiar el estado de la tienda', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  const status = req.body?.status;
  if (!['ONLINE', 'PAUSED'].includes(status)) return res.status(400).send('Estado inválido');
  const minutes = Number(req.body?.minutes);
  const pausedUntil =
    status === 'PAUSED' && Number.isFinite(minutes) && minutes >= 5 && minutes <= 1440 ? new Date(Date.now() + Math.round(minutes) * 60_000) : null;
  try {
    await uber.setStoreStatus(link.storeId, { status, pausedUntil, reason: status === 'PAUSED' ? 'Pausado desde MiRestaurante' : undefined });
  } catch (err) {
    console.error('[uber]', err.message);
    return res.status(502).send('No se pudo cambiar el estado en Uber Eats. Intenta de nuevo.');
  }
  // Lo que se cambia a mano deja de ser «una pausa de la caja»: abrir la caja no lo reanudará por su cuenta
  await db.SaveIntegration('uber', req.tenantId, { pausedByCash: false });
  return res.status(200).json({ status, pausedUntil });
});

const uberSetAutoPause = handle('Error al guardar el ajuste', async (req, res) => {
  if (typeof req.body?.autoPause !== 'boolean') return res.status(400).send('Indica si se pausa sola (true o false)');
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  await db.SaveIntegration('uber', req.tenantId, { autoPause: req.body.autoPause });
  return res.status(200).json({ autoPause: req.body.autoPause });
});

// —— Conectar la tienda con Uber por OAuth
async function uberConnect(req, res) {
  try {
    return res.status(200).json({ url: activation.authorizeUrl(req.tenantId) });
  } catch (err) {
    return res.status(err.status || 500).send(err.message);
  }
}

// Lo abre el navegador al volver de Uber: SIN sesión (el state firmado dice de qué negocio es)
async function uberOAuthCallback(req, res) {
  const back = `${String(process.env.APP_URL || '').replace(/\/$/, '')}/settings?s=integraciones`;
  try {
    if (req.query.error || !req.query.code) throw new Error('cancelled');
    const r = await activation.handleCallback({ code: String(req.query.code), state: String(req.query.state || '') });
    return res.redirect(`${back}&uber=${r.outcome}`);
  } catch (err) {
    console.error('[uber oauth]', err.status || '', err.message, err.detail || '');
    const reason = err.message === 'cancelled' ? 'cancelled' : err.status === 409 ? 'taken' : err.status === 400 ? 'state' : 'unknown';
    return res.redirect(`${back}&uber=error&reason=${reason}`);
  }
}

const uberPending = handle('Error al leer las tiendas', async (req, res) => {
  return res.status(200).json({ stores: await activation.pendingStores(req.tenantId) });
});

const uberActivate = handle('Error al activar la tienda', async (req, res) => {
  return res.status(200).json(await activation.activatePending(req.tenantId, String(req.body?.storeId || '')));
}, { statusOf: (err) => err.status });

// —— Tasa de aceptación del negocio y revisión de pedidos perdidos
const DAYS = [7, 30];
const uberMetrics = handle('Error al calcular la tasa de aceptación', async (req, res) => {
  const days = DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const orders = await db.ListUberOrdersSince(req.tenantId, new Date(Date.now() - days * 24 * 3600 * 1000));
  return res.status(200).json({ days, ...uber.acceptanceStats(orders) });
});

const uberReconcile = handle('Error al buscar pedidos', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  try {
    return res.status(200).json(await uber.reconcileStore(link));
  } catch (err) {
    console.error('[uber]', err.message);
    uber.recordEvent({ eventType: 'api.reconcile', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: err.message });
    return res.status(502).send('No se pudo consultar a Uber Eats. Intenta de nuevo.');
  }
});

// —— Menú en Uber Eats: ver el estado y publicarlo (reemplaza el de la tienda)
const uberMenuStatus = handle('Error al leer el menú de Uber Eats', async (req, res) => {
  return res.status(200).json(await uberMenu.menuStatus(req.tenantId));
});

const uberPublishMenu = handle('Error al publicar el menú', async (req, res) => {
  return res.status(200).json(await uberMenu.publishMenu(req.tenantId, { open: req.body?.open, close: req.body?.close }));
}, { statusOf: (err) => err.status });

// —— Horarios especiales de la tienda en Uber Eats (festivos, cierres)
const uberHolidays = handle('Error al leer los horarios especiales', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  const settings = await db.GetSettings(req.tenantId);
  const today = todayIn(settings?.timezone);
  try {
    const data = await uber.holidayHours(link.storeId);
    // Solo lo de hoy en adelante: lo que ya pasó no sirve de nada
    return res.status(200).json({ today, days: fromUber(data?.holiday_hours).filter((d) => d.date >= today) });
  } catch (err) {
    uber.recordEvent({ eventType: 'api.holidays', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    return res.status(502).send('No se pudieron leer los horarios especiales de Uber Eats.');
  }
});

const uberSetHolidays = handle('Error al guardar los horarios especiales', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  const settings = await db.GetSettings(req.tenantId);
  const today = todayIn(settings?.timezone);
  const { value, error } = toUber(req.body?.days, today);
  if (error) return res.status(400).send(error);
  try {
    await uber.setHolidayHours(link.storeId, value); // reemplaza todos los de la tienda: por eso se manda la lista completa
  } catch (err) {
    uber.recordEvent({ eventType: 'api.holidays', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    return res.status(502).send(`Uber Eats no aceptó los horarios especiales${err.detail ? `: ${err.detail}` : ''}`);
  }
  return res.status(200).json({ today, days: fromUber(value) });
});

// —— Precios del menú en Uber Eats: subirlos lo que cobra Uber para conservar la ganancia
const uberPricing = handle('Error al leer los precios de Uber Eats', async (req, res) => {
  // Con `plan` en la dirección es una vista previa de lo que se está escribiendo (no se guarda)
  return res.status(200).json(await uberMenu.pricingPreview(req.tenantId, req.query?.plan ? req.query : null));
}, { statusOf: (err) => err.status });

const uberSetPricing = handle('Error al guardar los precios de Uber Eats', async (req, res) => {
  await uberMenu.setPricing(req.tenantId, req.body || {}, req.user?.username || req.user?.name || null);
  return res.status(200).json(await uberMenu.pricingPreview(req.tenantId));
}, { statusOf: (err) => err.status });

// —— Quitar la tienda de Uber por completo (pide autorizar de nuevo)
async function uberRemove(req, res) {
  try {
    return res.status(200).json({ url: await activation.startRemoval(req.tenantId) });
  } catch (err) {
    return res.status(err.status || 500).send(err.message);
  }
}

// —— Tiempo de preparación de la tienda
const uberPrep = handle('Error al leer el tiempo de preparación', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(200).json({ linked: false });
  try {
    const s = await uber.storeDetails(link.storeId);
    const mins = Number(s?.avg_prep_time);
    return res.status(200).json({ linked: true, prepMinutes: Number.isFinite(mins) && mins > 0 ? mins : link.prepMinutes ?? null });
  } catch (err) {
    console.error('[uber]', err.message);
    return res.status(200).json({ linked: true, prepMinutes: link.prepMinutes ?? null, error: 'No se pudo consultar a Uber Eats' });
  }
});

const uberSetPrep = handle('Error al cambiar el tiempo de preparación', async (req, res) => {
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  const minutes = Number(req.body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return res.status(400).send('El tiempo debe ser de 1 a 180 minutos');
  try {
    await uber.setPrepTime(link.storeId, minutes);
  } catch (err) {
    console.error('[uber]', err.message);
    uber.recordEvent({ eventType: 'api.prep', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
    return res.status(502).send('Uber Eats no aceptó el cambio. Puedes ajustarlo en Uber Eats Manager (Ajustes > Tiempo de preparación).');
  }
  await db.SaveIntegration('uber', req.tenantId, { prepMinutes: minutes });
  return res.status(200).json({ prepMinutes: minutes });
});

// —— Publicar el menú de nuevo solo cuando cambia (se puede apagar)
const uberSetAutoPublish = handle('Error al guardar el ajuste', async (req, res) => {
  if (typeof req.body?.autoPublish !== 'boolean') return res.status(400).send('Indica si se actualiza solo (true o false)');
  const link = await db.GetIntegrationByTenant('uber', req.tenantId);
  if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
  await db.SaveIntegration('uber', req.tenantId, { autoPublish: req.body.autoPublish });
  return res.status(200).json({ autoPublish: req.body.autoPublish });
});

// —— Revisión de todas las tiendas, para un reloj externo (p. ej. un cron de Vercel). Protegida por CRON_SECRET.
const sameSecret = (given, secret) => {
  const hash = (s) => require('crypto').createHash('sha256').update(String(s)).digest();
  return require('crypto').timingSafeEqual(hash(given), hash(`Bearer ${secret}`));
};
async function uberSweep(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).send('CRON_SECRET no está configurado');
  if (!sameSecret(req.get('Authorization') || '', secret)) return res.status(401).send('No autorizado');
  try {
    return res.status(200).json(await uber.sweepAll());
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error en la revisión');
  }
}

module.exports = { uberHolidays, uberSetHolidays, uberPricing, uberSetPricing, uberRemove, uberPrep, uberSetPrep, uberSetAutoPublish, uberSweep, uberConnect, uberOAuthCallback, uberPending, uberActivate, uberMenuStatus, uberPublishMenu, uberMetrics, uberReconcile, uberStoreStatus, uberSetStoreStatus, uberSetAutoPause, uberWebhook, uberStatus, uberUnlink, acceptUberOrder, denyUberOrder, cancelUberOrder, deliveryStatusUberOrder, uberSyncOrder, uberReadyTime, uberAskCustomer, uberAdjustPrice };
