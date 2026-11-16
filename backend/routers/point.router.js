/**
 * Terminal de cobro Mercado Pago Point. Se monta en /point.
 * Administrador: conecta la cuenta y elige la terminal. Administrador y caja: ven el estado y cobran.
 */
const router = require('express').Router();
const point = require('../services/point.service');
const { requireAuth, requireActiveSubscription, requireRoles, requireFreshRole } = require('../middleware/auth.middleware');

const staff = [requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier')];
const owner = [requireAuth, requireActiveSubscription, requireFreshRole('admin')];
const fail = (res, err) => res.status(err.status || 500).json({ message: err.message, code: err.code });
const outcome = (c) => (['paid', 'pending', 'review'].includes(c.status) ? c.status : 'failed');

// ——— Conexión de la cuenta (administrador) ———
router.get('/connect', ...owner, (req, res) => {
  try { res.json({ url: point.buildAuthUrl(req.tenantId) }); } catch (e) { fail(res, e); }
});

// Lo abre el navegador al volver de Mercado Pago: SIN sesión (el state firmado dice de qué negocio es)
router.get('/oauth/callback', async (req, res) => {
  const back = `${String(process.env.APP_URL || '').replace(/\/$/, '')}/settings?s=terminal`;
  try {
    if (req.query.error || !req.query.code) throw new Error('cancelled');
    await point.handleOAuthCallback({ code: req.query.code, state: req.query.state });
    res.redirect(`${back}&mp=ok`);
  } catch (err) {
    console.error('[point oauth]', err.code || '', err.status || '', err.message);
    const reason = err.message === 'cancelled' ? 'cancelled' : err.code || (err.status === 400 ? 'state' : 'unknown');
    res.redirect(`${back}&mp=error&reason=${encodeURIComponent(reason)}`);
  }
});

router.delete('/connection', ...owner, async (req, res) => {
  try { await point.disconnect(req.tenantId); res.sendStatus(204); } catch (e) { fail(res, e); }
});

// ——— Terminal (administrador) ———
router.get('/terminals', ...owner, async (req, res) => {
  try { res.json(await point.listTerminals(req.tenantId)); } catch (e) { fail(res, e); }
});
router.post('/terminal', ...owner, async (req, res) => {
  try { res.json(await point.registerTerminal(req.tenantId, String(req.body?.terminalId || ''))); } catch (e) { fail(res, e); }
});

// ——— Estado y cobros (administrador y caja) ———
router.get('/status', ...staff, async (req, res) => {
  try { res.json(await point.status(req.tenantId)); } catch (e) { fail(res, e); }
});
router.post('/charges', ...staff, async (req, res) => {
  try {
    const { clientSaleId, amount } = req.body || {};
    res.status(201).json(await point.startCharge({ tenantId: req.tenantId, clientSaleId, amount }));
  } catch (e) { fail(res, e); }
});
router.get('/charges/:id', ...staff, async (req, res) => {
  try {
    const c = await point.syncCharge(req.tenantId, req.params.id);
    res.json({ status: outcome(c), mpStatus: c.mpStatus, reason: c.reviewReason || '' });
  } catch (e) { fail(res, e); }
});
router.post('/charges/:id/cancel', ...staff, async (req, res) => {
  try {
    const c = await point.cancelCharge(req.tenantId, req.params.id);
    // «pending» tras cancelar = la terminal ya muestra el cobro y solo se cancela desde la terminal
    res.json({ status: outcome(c), mpStatus: c.mpStatus });
  } catch (e) { fail(res, e); }
});

// ——— Aviso de Mercado Pago (SIN sesión; valida la firma) ———
router.post('/webhook', async (req, res) => {
  if (!point.verifyWebhookSignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const id = req.body?.data?.id || req.query['data.id'];
    if (id) await point.onWebhook(id);
  } catch (err) {
    console.error('[point webhook]', err.message);
  }
});

module.exports = router;
