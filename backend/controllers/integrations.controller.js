const db = require('../database/mongodb');
const uber = require('../services/uber.service');
const uberMenu = require('../services/uber.menu.service');
const activation = require('../services/uber.activation.service');
const inventory = require('../services/inventory.service');
const { todayIn, fromUber, toUber } = require('../utils/holidays');

const STORE_ID = /^[A-Za-z0-9_-]{8,64}$/;

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

async function uberStatus(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer la integración');
  }
}

async function uberLink(req, res) {
  try {
    const storeId = String(req.body?.storeId || '').trim();
    if (!STORE_ID.test(storeId)) return res.status(400).send('Escribe el Store ID de Uber Eats (letras, números y guiones)');
    const taken = await db.GetIntegrationByStore('uber', storeId);
    if (taken && taken.tenantId !== String(req.tenantId)) {
      return res.status(409).send('Esa tienda ya está vinculada a otro negocio');
    }
    // Se le pregunta a Uber si reconoce esa tienda para esta aplicación: escribir cualquier ID no la vincula
    let storeName = null;
    if (uber.isConfigured()) {
      try {
        storeName = (await uber.storeDetails(storeId))?.name || null;
      } catch (err) {
        uber.recordEvent({ eventType: 'api.link', storeId, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
        if (/autenticar/i.test(err.message)) return res.status(400).send('Uber Eats no aceptó las credenciales de la aplicación (Client ID y Client Secret) o sus permisos. Revísalos en el panel de Uber.');
        if ([400, 401, 403, 404].includes(err.status)) {
          return res.status(400).send('Uber Eats no reconoce esa tienda para tu aplicación. Revisa el Store ID, o usa «Conectar con Uber Eats» con la cuenta dueña de la tienda.');
        }
        return res.status(502).send('No se pudo verificar la tienda con Uber Eats. Intenta de nuevo en un momento.');
      }
    }
    const link = await db.SaveIntegration('uber', req.tenantId, { storeId, linkedBy: req.user?.username || null, linkedVia: 'manual', storeName, storeAddress: null, integrationEnabled: null, deprovisioned: false });
    return res.status(200).json({ configured: uber.isConfigured(), environment: uber.config().env, storeId: link.storeId, storeName: link.storeName || '' });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al vincular la tienda');
  }
}

async function uberUnlink(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al desvincular la tienda');
  }
}

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

async function acceptUberOrder(req, res) {
  try {
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
      await uber.acceptOrder(order.external.orderId, { externalRef: order.id, pickupTime: pickupAt && pickupAt.getTime() / 1000, acceptedBy: req.user?.username });
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al aceptar el pedido');
  }
}

const DENY_TO_CANCEL = { ITEM_AVAILABILITY: 'OUT_OF_ITEMS', CAPACITY: 'RESTAURANT_TOO_BUSY', STORE_CLOSED: 'KITCHEN_CLOSED', SPECIAL_INSTRUCTIONS: 'CANNOT_COMPLETE_CUSTOMER_NOTE' };

async function denyUberOrder(req, res) {
  try {
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
    const restored = await inventory.restoreSale({ tenantId: req.tenantId, order, by: req.user?.username }).catch(() => false);
    if (restored) patch.stockRestored = true;
    return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al rechazar el pedido');
  }
}

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
const uberClosed = (res, err) => {
  console.error('[uber]', err.message);
  return res
    .status(502)
    .send(err.status === 404 ? 'Uber Eats ya no permite este cambio (el pedido terminó o fue cancelado). Actualiza la pantalla.' : 'No se pudo contactar a Uber Eats. Intenta de nuevo.');
};

async function cancelUberOrder(req, res) {
  try {
    const order = await loadAccepted(req, res, true);
    if (!order) return null;
    const code = uber.CANCEL_REASONS.includes(req.body?.code) ? req.body.code : 'OTHER';
    const details = String(req.body?.details || '').trim();
    if (code === 'OTHER' && !details) return res.status(400).send('Escribe el motivo de la cancelación');
    try {
      await uber.cancelOrder(order.external.orderId, { reason: code, details });
    } catch (err) {
      logApiError(req, order, 'cancel', err);
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
    const restored = await inventory.restoreSale({ tenantId: req.tenantId, order, by: req.user?.username }).catch(() => false);
    if (restored) patch.stockRestored = true;
    return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cancelar el pedido');
  }
}

// —— Lo que Uber dice del pedido: si ya lo ve listo, qué acciones permite y dónde va el repartidor
async function uberSyncOrder(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al consultar a Uber Eats');
  }
}

// Alarga la hora en que estará listo (+N minutos sobre la que ya se había dicho)
async function uberReadyTime(req, res) {
  try {
    const order = await loadAccepted(req, res);
    if (!order) return null;
    const ext = order.external;
    if (ext.state !== 'accepted' || !['pending', 'preparing'].includes(order.status) || ext.readyNotifiedAt) return res.status(400).send('Este pedido ya no admite cambiar la hora de listo');
    const add = Number(req.body?.addMinutes);
    if (!Number.isFinite(add) || add < 1 || add > 60) return res.status(400).send('Elige entre 1 y 60 minutos');
    const can = ext.sync?.adjustReadyTime;
    if (can && can.eligible === false) return res.status(400).send(`Uber no permite cambiar la hora de este pedido${can.reason ? `: ${can.reason}` : ''}`);
    const readyAt = new Date(Math.max(Date.now(), new Date(ext.pickupAt || 0).getTime()) + Math.round(add) * 60_000);
    try {
      await uber.updateReadyTime(ext.orderId, readyAt);
    } catch (err) {
      logApiError(req, order, 'ready_time', err);
      return uberClosed(res, err);
    }
    return res.status(200).json(await db.UpdateOrder(order.id, { external: { ...ext, pickupAt: readyAt }, updatedAt: new Date() }, req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cambiar la hora de listo');
  }
}

// Un producto se agotó: se le pregunta al cliente en su app si lo cambia o lo quita (sin rechazar todo el pedido)
async function uberAskCustomer(req, res) {
  try {
    const order = await loadAccepted(req, res);
    if (!order) return null;
    const ext = order.external;
    if (ext.state !== 'accepted') return res.status(400).send('Este pedido aún no se acepta de verdad');
    const item = (order.items || []).find((i) => i.cartItemId && i.cartItemId === req.body?.cartItemId);
    if (!item) return res.status(400).send('Elige el producto que se agotó');
    if (ext.askingCustomer) return res.status(400).send('Ya le preguntaste al cliente: espera su respuesta');
    const can = ext.sync?.outOfItem;
    if (can && can.eligible === false) return res.status(400).send(`Uber no permite avisar de un producto agotado en este pedido${can.reason ? `: ${can.reason}` : ''}`);
    let answer;
    try {
      answer = await uber.askCustomerAboutItem(ext.orderId, { cartItemId: item.cartItemId, message: String(req.body?.message || '').trim() });
    } catch (err) {
      logApiError(req, order, 'out_of_item', err);
      return uberClosed(res, err);
    }
    const now = new Date();
    const asking = answer?.should_wait_for_customer_response === false ? null : { cartItemId: item.cartItemId, name: item.name, at: now };
    return res.status(200).json(await db.UpdateOrder(order.id, { external: { ...ext, askingCustomer: asking }, updatedAt: now }, req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al avisar del producto agotado');
  }
}

// Solo pedidos que reparte el propio restaurante: salió (started), va llegando (arriving), entregado (delivered)
async function deliveryStatusUberOrder(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al avisar la entrega');
  }
}

// —— Estado de la tienda en Uber (en línea o pausada)
async function uberStoreStatus(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer el estado de la tienda');
  }
}

// Pausar (con o sin hora para reanudarse sola) o reanudar la tienda a mano
async function uberSetStoreStatus(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cambiar el estado de la tienda');
  }
}

async function uberSetAutoPause(req, res) {
  try {
    if (typeof req.body?.autoPause !== 'boolean') return res.status(400).send('Indica si se pausa sola (true o false)');
    const link = await db.GetIntegrationByTenant('uber', req.tenantId);
    if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
    await db.SaveIntegration('uber', req.tenantId, { autoPause: req.body.autoPause });
    return res.status(200).json({ autoPause: req.body.autoPause });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al guardar el ajuste');
  }
}

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

async function uberPending(req, res) {
  try {
    return res.status(200).json({ stores: await activation.pendingStores(req.tenantId) });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer las tiendas');
  }
}

async function uberActivate(req, res) {
  try {
    return res.status(200).json(await activation.activatePending(req.tenantId, String(req.body?.storeId || '')));
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    console.error(err);
    return res.status(500).send(err.message || 'Error al activar la tienda');
  }
}

// —— Tasa de aceptación del negocio y revisión de pedidos perdidos
const DAYS = [7, 30];
async function uberMetrics(req, res) {
  try {
    const days = DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const orders = await db.ListUberOrdersSince(req.tenantId, new Date(Date.now() - days * 24 * 3600 * 1000));
    return res.status(200).json({ days, ...uber.acceptanceStats(orders) });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al calcular la tasa de aceptación');
  }
}

async function uberReconcile(req, res) {
  try {
    const link = await db.GetIntegrationByTenant('uber', req.tenantId);
    if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
    try {
      return res.status(200).json(await uber.reconcileStore(link));
    } catch (err) {
      console.error('[uber]', err.message);
      uber.recordEvent({ eventType: 'api.reconcile', storeId: link.storeId, tenantId: req.tenantId, outcome: 'error', detail: err.message });
      return res.status(502).send('No se pudo consultar a Uber Eats. Intenta de nuevo.');
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al buscar pedidos');
  }
}

// —— Menú en Uber Eats: ver el estado y publicarlo (reemplaza el de la tienda)
async function uberMenuStatus(req, res) {
  try {
    return res.status(200).json(await uberMenu.menuStatus(req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer el menú de Uber Eats');
  }
}

async function uberPublishMenu(req, res) {
  try {
    return res.status(200).json(await uberMenu.publishMenu(req.tenantId, { open: req.body?.open, close: req.body?.close }));
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    console.error(err);
    return res.status(500).send(err.message || 'Error al publicar el menú');
  }
}

// —— Horarios especiales de la tienda en Uber Eats (festivos, cierres)
async function uberHolidays(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer los horarios especiales');
  }
}

async function uberSetHolidays(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al guardar los horarios especiales');
  }
}

// —— Precios del menú en Uber Eats: subirlos lo que cobra Uber para conservar la ganancia
async function uberPricing(req, res) {
  try {
    // Con `plan` en la dirección es una vista previa de lo que se está escribiendo (no se guarda)
    return res.status(200).json(await uberMenu.pricingPreview(req.tenantId, req.query?.plan ? req.query : null));
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer los precios de Uber Eats');
  }
}

async function uberSetPricing(req, res) {
  try {
    await uberMenu.setPricing(req.tenantId, req.body || {}, req.user?.username || req.user?.name || null);
    return res.status(200).json(await uberMenu.pricingPreview(req.tenantId));
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    console.error(err);
    return res.status(500).send(err.message || 'Error al guardar los precios de Uber Eats');
  }
}

// —— Quitar la tienda de Uber por completo (pide autorizar de nuevo)
async function uberRemove(req, res) {
  try {
    return res.status(200).json({ url: await activation.startRemoval(req.tenantId) });
  } catch (err) {
    return res.status(err.status || 500).send(err.message);
  }
}

// —— Tiempo de preparación de la tienda
async function uberPrep(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al leer el tiempo de preparación');
  }
}

async function uberSetPrep(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cambiar el tiempo de preparación');
  }
}

// —— Publicar el menú de nuevo solo cuando cambia (se puede apagar)
async function uberSetAutoPublish(req, res) {
  try {
    if (typeof req.body?.autoPublish !== 'boolean') return res.status(400).send('Indica si se actualiza solo (true o false)');
    const link = await db.GetIntegrationByTenant('uber', req.tenantId);
    if (!link?.storeId) return res.status(400).send('Vincula primero tu tienda de Uber Eats');
    await db.SaveIntegration('uber', req.tenantId, { autoPublish: req.body.autoPublish });
    return res.status(200).json({ autoPublish: req.body.autoPublish });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al guardar el ajuste');
  }
}

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

module.exports = { uberHolidays, uberSetHolidays, uberPricing, uberSetPricing, uberRemove, uberPrep, uberSetPrep, uberSetAutoPublish, uberSweep, uberConnect, uberOAuthCallback, uberPending, uberActivate, uberMenuStatus, uberPublishMenu, uberMetrics, uberReconcile, uberStoreStatus, uberSetStoreStatus, uberSetAutoPause, uberWebhook, uberStatus, uberLink, uberUnlink, acceptUberOrder, denyUberOrder, cancelUberOrder, deliveryStatusUberOrder, uberSyncOrder, uberReadyTime, uberAskCustomer };
