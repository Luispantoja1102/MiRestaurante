const db = require('../database/mongodb');
const { normalizeCashSession } = require('../models/cashSession.model');
const uber = require('../services/uber.service');
const { handle } = require('../utils/handle');

function summarizeOrders(orders) {
  const totals = { cash: 0, card: 0, transfer: 0, platform: 0, other: 0, total: 0, count: orders.length };
  for (const o of orders) {
    if (o.paymentStatus !== 'paid') continue;
    const method = o.paymentMethod || 'other';
    const amount = Number(o.total || 0);
    if (totals[method] != null) totals[method] += amount;
    else totals.other += amount;
    totals.total += amount;
  }
  return totals;
}

const current = handle('Error al obtener sesión de caja', async (req, res) => {
  const session = await db.GetOpenCashSession(req.tenantId);
  if (!session) return res.status(200).json({ open: false, session: null });
  const orders = await db.GetOrdersByCashSession(session.id, req.tenantId);
  return res.status(200).json({
    open: true,
    session,
    totals: summarizeOrders(orders),
    orders,
  });
});

const open = handle('Error al abrir caja', async (req, res) => {
  const existing = await db.GetOpenCashSession(req.tenantId);
  if (existing) {
    return res.status(400).send('Ya hay una caja abierta');
  }
  const session = await db.CreateCashSession(
    normalizeCashSession(req.body || {}, req.tenantId, req.user.username)
  );
  uber.onCashOpened(req.tenantId); // reanuda la tienda de Uber si la pausó el cierre y revisa pedidos perdidos; sin esperar
  return res.status(201).json(session);
});

const close = handle('Error al cerrar caja', async (req, res) => {
  const session = await db.GetOpenCashSession(req.tenantId);
  if (!session) return res.status(400).send('No hay caja abierta');

  const orders = await db.GetOrdersByCashSession(session.id, req.tenantId);
  const totals = summarizeOrders(orders);
  const countedCash = Number(req.body?.countedCash ?? 0);
  const expectedCash = Number(session.openingFloat || 0) + totals.cash;
  const difference = Number((countedCash - expectedCash).toFixed(2));

  const closed = await db.UpdateCashSession(
    session.id,
    {
      status: 'closed',
      closedAt: new Date(),
      closedBy: req.user.username,
      countedCash,
      expectedCash,
      expectedCard: totals.card,
      expectedTransfer: totals.transfer,
      expectedPlatform: totals.platform,
      expectedOther: totals.other,
      expectedTotal: totals.total,
      difference,
      notes: String(req.body?.notes || ''),
      updatedAt: new Date(),
    },
    req.tenantId
  );

  uber.syncStoreWithCash(req.tenantId, false); // pausa la tienda de Uber: sin caja nadie acepta pedidos; sin esperar
  return res.status(200).json({ session: closed, totals });
});

const getById = handle('Error al obtener sesión', async (req, res) => {
  const session = await db.GetCashSessionById(req.params.id, req.tenantId);
  if (!session) return res.status(404).send('Sesión no encontrada');
  const orders = await db.GetOrdersByCashSession(session.id, req.tenantId);
  return res.status(200).json({ session, totals: summarizeOrders(orders), orders });
});

module.exports = { current, open, close, getById };
