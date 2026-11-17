const router = require('express').Router();
const integrations = require('../controllers/integrations.controller');
const { requireAuth, requireActiveSubscription, requireRoles, requireFreshRole } = require('../middleware/auth.middleware');

// Público: lo llama Uber. Se protege con la firma HMAC, no con sesión.
router.post('/uber/webhook', integrations.uberWebhook);

// Vincular la tienda de Uber Eats con este negocio (solo el administrador)
router.get('/uber', requireAuth, requireActiveSubscription, requireRoles('admin'), integrations.uberStatus);
// Estado de la tienda en Uber (en línea / pausada): lo ven y cambian administrador y caja
router.get('/uber/store', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberStoreStatus);
router.put('/uber/store', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberSetStoreStatus);
router.put('/uber/autopause', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberSetAutoPause);
router.get('/uber/menu', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberMenuStatus);
router.post('/uber/menu', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberPublishMenu);
router.get('/uber/metrics', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberMetrics);
router.post('/uber/reconcile', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberReconcile);
router.put('/uber', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberLink);
router.delete('/uber', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberUnlink);

module.exports = router;
