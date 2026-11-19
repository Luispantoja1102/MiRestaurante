const db = require('../database/mongodb');
const { rateOf, includesTax } = require('../utils/tax');
const { todayIn } = require('../utils/holidays');
const uber = require('../services/uber.service');
const { normalizeOrder, priceItems, normalizeDelivery, orderStatuses, paymentMethods, channels, channelLabels, isPlatform } = require('../models/order.model');
const inv = require('../models/inventory');
const inventory = require('../services/inventory.service');
const point = require('../services/point.service');

const round2 = (n) => Number(Number(n).toFixed(2));
const MAX_LINES = 50;
const MAX_QTY = 99;
const WAITING_MSG = 'Primero acepta o rechaza el pedido de la plataforma';

// Día natural en la zona horaria del negocio (el turno del mostrador se reinicia cada día).
const dayKey = todayIn;

async function list(req, res) {
  try {
    return res.status(200).json(await db.GetOrders(req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al listar pedidos');
  }
}

async function awaiting(req, res) {
  try {
    return res.status(200).json(await db.GetAwaitingExternalOrders(req.tenantId));
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al listar pedidos por responder');
  }
}

async function getById(req, res) {
  try {
    const order = await db.GetOrderById(req.params.id, req.tenantId);
    if (!order) return res.status(404).send('Pedido no encontrado');
    return res.status(200).json(order);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al obtener pedido');
  }
}

async function create(req, res) {
  try {
    const body = req.body || {};
    if ((!body.items || !body.items.length) && Array.isArray(body.foods)) {
      body.items = body.foods.map((f) => ({
        foodId: f.food || f.foodId || f.id,
        name: f.name || 'Producto',
        price: Number(f.price || 0),
        quantity: Number(f.quantity || 1),
      }));
    }
    if (typeof body.modality === 'number') {
      body.modality = body.modality === 2 ? 'takeaway' : 'dine-in';
    }

    // El precio y la marca «IVA incluido» salen del menú del negocio, no de lo que mande la pantalla
    const [settings, foods] = await Promise.all([db.GetSettings(req.tenantId), db.GetFoods(req.tenantId)]);
    const foodsById = new Map(foods.map((f) => [String(f.id), f]));
    body.items = (body.items || []).map((i) => {
      const food = foodsById.get(String(i.foodId || i.food || i.id || ''));
      return { ...i, priceIncludesTax: food ? includesTax(food.priceIncludesTax) : includesTax(i.priceIncludesTax) };
    });
    const payload = normalizeOrder(body, { taxRate: rateOf(settings?.taxRate) });
    payload.tenantId = req.tenantId;
    if (payload.modality === 'delivery') {
      const d = normalizeDelivery(body.delivery, isPlatform(payload.channel));
      if (d.error) return res.status(400).send(d.error);
      payload.delivery = d.value;
      payload.tableId = null;
      payload.tableName = `${isPlatform(payload.channel) ? channelLabels[payload.channel] : 'Domicilio'} · ${d.value.name}`;
    }
    if (!payload.items.length) {
      return res.status(400).send('El pedido necesita al menos un producto');
    }

    const created = await db.CreateOrder(payload);

    try {
      await inventory.applySale({ tenantId: req.tenantId, order: created, foodsById, by: req.user?.username });
    } catch (e) {
      console.error('[inventory] pedido sin descontar:', e.message);
    }

    if (payload.tableId && payload.modality === 'dine-in') {
      try {
        await db.UpdateStatusMesa(
          payload.tableId,
          {
            disponible: false,
            personaTitular: body.personaTitular || payload.tableName,
          },
          req.tenantId
        );
      } catch (e) {
        console.warn('No se pudo ocupar la mesa:', e.message);
      }
    }

    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al crear pedido');
  }
}

async function updateStatus(req, res) {
  try {
    const status = req.body?.status;
    if (!orderStatuses.includes(status)) {
      return res.status(400).send('Estado inválido');
    }
    const existing = await db.GetOrderById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).send('Pedido no encontrado');
    if (existing.external?.state === 'awaiting') return res.status(400).send(WAITING_MSG);

    const now = new Date();
    const patch = { status, updatedAt: now };
    // Pedido de Uber Eats ya aceptado: lo que se cambie aquí tiene que llegar a Uber
    const ext = existing.external;
    const liveUber = ext?.provider === 'uber' && ext.state === 'accepted';
    if (status === 'cancelled' && liveUber) {
      return res.status(400).send('Este pedido es de Uber Eats: usa «Cancelar pedido», que se lo avisa a Uber. Cancelarlo solo aquí lo deja a medias en Uber.');
    }
    if (status === 'ready' && liveUber && !ext.readyNotifiedAt) {
      try {
        await uber.markOrderReady(ext.orderId); // Uber manda al repartidor cuando sabe que está listo
        const sync = await uber.fetchStatus(ext.orderId).catch(() => null); // ¿Uber ya lo ve listo? (READY_FOR_HANDOFF)
        patch.external = { ...ext, readyNotifiedAt: now, readyError: null, ...(sync ? { sync } : {}) };
      } catch (err) {
        // No frena al restaurante: queda listo aquí, se avisa en pantalla y se puede reintentar
        uber.recordEvent({ eventType: 'api.ready', orderId: ext.orderId || null, storeId: ext.storeId || null, tenantId: req.tenantId, outcome: 'error', detail: `${err.message} ${err.detail || ''}`.trim() });
        patch.external = { ...ext, readyError: 'No se pudo avisar a Uber Eats que el pedido está listo.' };
      }
    }
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const restored = await inventory
        .restoreSale({ tenantId: req.tenantId, order: existing, by: req.user?.username })
        .catch((e) => { console.error('[inventory] no se devolvió el stock:', e.message); return false; });
      if (restored) patch.stockRestored = true;
    }
    const updated = await db.UpdateOrder(req.params.id, patch, req.tenantId);
    if (!updated) return res.status(404).send('Pedido no encontrado');
    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al actualizar estado');
  }
}

/**
 * Venta de mostrador (café): pide, cobra y entrega en un solo paso, sin mesa ni cocina.
 * - Los precios salen del menú del negocio, no del cliente.
 * - Exige caja abierta y entra en el cierre de esa caja.
 * - `clientRef` evita ventas duplicadas por doble clic o reintento de red.
 */
async function counterSale(req, res) {
  try {
    const body = req.body || {};
    const channel = channels.includes(body.channel) ? body.channel : 'local';
    const platform = isPlatform(channel);
    // Una venta de app de reparto no entra como efectivo: la plataforma paga después
    const method = platform ? 'platform' : body.paymentMethod || 'cash';
    if (!paymentMethods.includes(method) || (method === 'platform' && !platform)) {
      return res.status(400).send('Método de pago inválido');
    }

    const session = await db.GetOpenCashSession(req.tenantId);
    if (!session) return res.status(400).send('Abre la caja antes de vender');

    const clientRef = typeof body.clientRef === 'string' && body.clientRef ? body.clientRef.slice(0, 64) : null;
    if (clientRef) {
      const duplicate = await db.GetOrderByClientRef(req.tenantId, clientRef);
      if (duplicate) return res.status(200).json(duplicate);
    }

    const lines = Array.isArray(body.items) ? body.items : [];
    if (!lines.length) return res.status(400).send('Agrega al menos un producto');
    if (lines.length > MAX_LINES) return res.status(400).send('Demasiados productos en una venta');

    const foods = new Map((await db.GetFoods(req.tenantId)).map((f) => [String(f.id), f]));
    const items = [];
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
        return res.status(400).send('Cantidad inválida');
      }
      const food = foods.get(String(line.foodId));
      if (!food) return res.status(400).send('Un producto ya no existe en el menú. Actualiza la pantalla.');
      // Los extras (pumps de sabor, azúcar…) se validan contra lo que el platillo ofrece y se cobran al
      // precio del menú; lo que mande el cliente solo dice cuántos de cada uno.
      const resolved = inv.resolveOptions(food, line.options);
      if (resolved.error) return res.status(400).send(resolved.error);
      items.push({
        foodId: food.id,
        name: food.name,
        price: inv.unitPriceWithExtras(food, resolved.options),
        basePrice: Number(food.price) || 0,
        priceIncludesTax: includesTax(food.priceIncludesTax), // los extras llevan la misma marca que el platillo
        options: resolved.options,
        quantity,
        notes: String(line.notes || '').trim().slice(0, 80),
      });
    }

    let delivery = null;
    if (body.delivery) {
      const d = normalizeDelivery(body.delivery, platform);
      if (d.error) return res.status(400).send(d.error);
      delivery = d.value;
    }

    // normalizeOrder calcula subtotal, IVA y total (con envío solo si es a domicilio).
    const settings = await db.GetSettings(req.tenantId);
    const payload = normalizeOrder({ items, modality: delivery ? 'delivery' : 'dine-in', channel }, { taxRate: rateOf(settings?.taxRate) });
    payload.items = priceItems(items, payload.taxRate); // normalizeOrder solo conserva los campos básicos; aquí también van las opciones
    const customerName = String(body.customerName || '').trim().slice(0, 40);
    let received = null;
    if (method === 'cash') {
      received = body.amountReceived == null || body.amountReceived === '' ? payload.total : Number(body.amountReceived);
      if (!Number.isFinite(received) || received < payload.total) {
        return res.status(400).send('El efectivo recibido no cubre el total');
      }
    }

    // Cobro hecho en la terminal de Mercado Pago: debe estar aprobado, con este total y sin usarse antes
    const chargeId = body.pointChargeId ? String(body.pointChargeId) : null;
    if (chargeId) {
      if (method !== 'card') return res.status(400).send('El cobro con terminal es solo para tarjeta');
      try {
        const used = await point.consumeCharge(req.tenantId, chargeId, { saleId: clientRef || `charge-${chargeId}`, total: payload.total });
        payload.pointTerminal = used.terminalName || null; // en cuál terminal se cobró
      } catch (e) {
        return res.status(e.status || 500).send(e.message);
      }
      payload.pointChargeId = chargeId;
    }

    const now = new Date();

    Object.assign(payload, {
      tenantId: req.tenantId,
      source: 'counter',
      modality: delivery ? 'delivery' : body.takeaway || platform ? 'takeaway' : 'dine-in',
      tableId: null,
      customerName: delivery ? delivery.name : customerName,
      tableName: platform ? `${channelLabels[channel]} · ${delivery?.name || customerName || 'Pedido'}` : delivery ? `Domicilio · ${delivery.name}` : customerName ? `Mostrador · ${customerName}` : 'Mostrador',
      // A domicilio se cobra al despachar pero queda «listo» hasta que se marque entregado
      status: delivery ? 'ready' : 'served',
      paymentStatus: 'paid',
      paymentMethod: method,
      paidAt: now,
      cashSessionId: session.id,
      createdBy: req.user?.username || null,
      turno: await db.NextCounter(req.tenantId, `turno-${dayKey(settings?.timezone)}`),
      createdAt: now,
      updatedAt: now,
    });
    if (delivery) payload.delivery = delivery;
    if (clientRef) payload.clientRef = clientRef;
    if (received != null) {
      payload.amountReceived = round2(received);
      payload.change = round2(received - payload.total);
    }

    try {
      const created = await db.CreateOrder(payload);
      // Descuenta el inventario; si algo falla ahí, la venta ya hecha no se pierde
      await inventory
        .applySale({ tenantId: req.tenantId, order: created, foodsById: foods, by: req.user?.username })
        .catch((e) => console.error('[inventory] venta sin descontar:', e.message));
      return res.status(201).json(created);
    } catch (err) {
      // Dos peticiones iguales a la vez: la segunda choca con el índice único y devuelve la primera.
      if (err?.code === 11000 && clientRef) {
        const existing = await db.GetOrderByClientRef(req.tenantId, clientRef);
        if (existing) return res.status(200).json(existing);
      }
      // La venta no se guardó: el cobro queda libre para el reintento (no se cobra dos veces)
      if (chargeId) await point.releaseCharge(req.tenantId, chargeId, clientRef || `charge-${chargeId}`).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al registrar la venta');
  }
}

async function pay(req, res) {
  try {
    const session = await db.GetOpenCashSession(req.tenantId);
    if (!session) {
      return res.status(400).send('Debes abrir la caja antes de cobrar');
    }

    const existing = await db.GetOrderById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).send('Pedido no encontrado');

    if (existing.external?.state === 'awaiting') return res.status(400).send(WAITING_MSG);

    const platform = isPlatform(existing.channel);
    const method = platform ? 'platform' : req.body?.paymentMethod || 'cash';
    if (!paymentMethods.includes(method) || (method === 'platform' && !platform)) {
      return res.status(400).send('Método de pago inválido');
    }
    if (existing.paymentStatus === 'paid') {
      return res.status(400).send('El pedido ya está cobrado');
    }

    const chargeId = req.body?.pointChargeId ? String(req.body.pointChargeId) : null;
    let pointTerminal = null;
    if (chargeId) {
      if (method !== 'card') return res.status(400).send('El cobro con terminal es solo para tarjeta');
      try {
        pointTerminal = (await point.consumeCharge(req.tenantId, chargeId, { saleId: existing.id, total: existing.total })).terminalName || null;
      } catch (e) {
        return res.status(e.status || 500).send(e.message);
      }
    }

    let updated;
    try {
      updated = await db.UpdateOrder(
        req.params.id,
        {
          paymentStatus: 'paid',
          paymentMethod: method,
          ...(chargeId ? { pointChargeId: chargeId, pointTerminal } : {}),
          status: existing.status === 'cancelled' ? existing.status : 'served',
          paidAt: new Date(),
          updatedAt: new Date(),
          cashSessionId: session.id,
        },
        req.tenantId
      );
    } catch (err) {
      if (chargeId) await point.releaseCharge(req.tenantId, chargeId, existing.id).catch(() => {});
      throw err;
    }

    if (existing.tableId) {
      try {
        await db.UpdateStatusMesa(
          existing.tableId,
          { disponible: true, personaTitular: null },
          req.tenantId
        );
      } catch (e) {
        console.warn('No se pudo liberar la mesa:', e.message);
      }
    }

    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al cobrar pedido');
  }
}

module.exports = { list, awaiting, getById, create, updateStatus, pay, counterSale };
