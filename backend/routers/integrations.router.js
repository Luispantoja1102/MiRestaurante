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
router.get('/uber/holidays', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberHolidays);
router.put('/uber/holidays', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberSetHolidays);
router.get('/uber/pricing', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberPricing);
router.put('/uber/pricing', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberSetPricing);
router.put('/uber/menu/auto', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberSetAutoPublish);
router.get('/uber/prep', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberPrep);
router.put('/uber/prep', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberSetPrep);
router.post('/uber/remove', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberRemove);
router.get('/uber/sweep', integrations.uberSweep); // lo llama un reloj externo con CRON_SECRET, no un usuario
router.get('/uber/metrics', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberMetrics);
router.post('/uber/reconcile', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberReconcile);
// Conectar la tienda con Uber por OAuth (solo el administrador)
router.get('/uber/connect', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberConnect);
router.get('/uber/oauth/callback', integrations.uberOAuthCallback); // público: lo abre el navegador al volver de Uber
router.get('/uber/pending', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberPending);
router.post('/uber/activate', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberActivate);
router.delete('/uber', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberUnlink);

module.exports = router;
