const db = require('../database/mongodb');
const uber = require('../services/uber.service');
const inventory = require('../services/inventory.service');

const STORE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Webhook público de Uber: se acepta solo si la firma es válida. */
async function uberWebhook(req, res) {
  if (!uber.isConfigured()) return res.status(503).send('Uber Eats no está configurado');
  if (!uber.verifySignature(req.rawBody, req.get('X-Uber-Signature'))) {
    return res.status(401).send('Firma inválida');
  }
  try {
    await uber.handleEvent(req.body);
    return res.status(200).end(); // Uber espera 200 con cuerpo vacío
  } catch (err) {
    // Un error pasajero (red, Uber caído) devuelve 500 para que Uber reintente; guardar es idempotente.
    console.error('[uber] webhook:', err.message);
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
      storeId: link?.storeId || '',
      linkedAt: link?.updatedAt || null,
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
    const link = await db.SaveIntegration('uber', req.tenantId, { storeId, linkedBy: req.user?.username || null });
    return res.status(200).json({ configured: uber.isConfigured(), environment: uber.config().env, storeId: link.storeId });
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al vincular la tienda');
  }
}

async function uberUnlink(req, res) {
  try {
    await db.DeleteIntegration('uber', req.tenantId);
    return res.status(200).json({ storeId: '' });
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
    const session = await db.GetOpenCashSession(req.tenantId);
    if (!session) return res.status(400).send('Abre la caja antes de aceptar el pedido');

    try {
      await uber.acceptOrder(order.external.orderId, { externalRef: order.id });
    } catch (err) {
      return uberFail(res, err);
    }
    const now = new Date();
    const updated = await db.UpdateOrder(
      order.id,
      {
        status: 'preparing',
        paymentStatus: 'paid',
        paymentMethod: 'platform',
        paidAt: now,
        cashSessionId: session.id,
        external: { ...order.external, state: 'accepted', acceptedAt: now, acceptedBy: req.user?.username || null },
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

async function denyUberOrder(req, res) {
  try {
    const order = await loadAwaiting(req, res);
    if (!order) return null;
    try {
      await uber.denyOrder(order.external.orderId, {
        code: req.body?.code,
        explanation: String(req.body?.explanation || '').trim() || 'No se puede preparar',
      });
    } catch (err) {
      return uberFail(res, err);
    }
    const now = new Date();
    const patch = {
      status: 'cancelled',
      external: { ...order.external, state: 'denied', closedAt: now, deniedBy: req.user?.username || null },
      updatedAt: now,
    };
    const restored = await inventory.restoreSale({ tenantId: req.tenantId, order, by: req.user?.username }).catch(() => false);
    if (restored) patch.stockRestored = true;
    return res.status(200).json(await db.UpdateOrder(order.id, patch, req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al rechazar el pedido');
  }
}

module.exports = { uberWebhook, uberStatus, uberLink, uberUnlink, acceptUberOrder, denyUberOrder };
