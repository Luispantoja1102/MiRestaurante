const router = require('express').Router();
const integrations = require('../controllers/integrations.controller');
const { guard, guardFresh } = require('../middleware/auth.middleware');

// Público: lo llama Uber. Se protege con la firma HMAC, no con sesión.
router.post('/uber/webhook', integrations.uberWebhook);

// Vincular la tienda de Uber Eats con este negocio (solo el administrador)
router.get('/uber', ...guard('admin'), integrations.uberStatus);
// Estado de la tienda en Uber (en línea / pausada): lo ven y cambian administrador y caja
router.get('/uber/store', ...guard('admin', 'cashier'), integrations.uberStoreStatus);
router.put('/uber/store', ...guard('admin', 'cashier'), integrations.uberSetStoreStatus);
router.put('/uber/autopause', ...guardFresh('admin'), integrations.uberSetAutoPause);
router.get('/uber/menu', ...guard('admin', 'cashier'), integrations.uberMenuStatus);
router.post('/uber/menu', ...guardFresh('admin'), integrations.uberPublishMenu);
router.get('/uber/holidays', ...guardFresh('admin'), integrations.uberHolidays);
router.put('/uber/holidays', ...guardFresh('admin'), integrations.uberSetHolidays);
router.get('/uber/pricing', ...guardFresh('admin'), integrations.uberPricing);
router.put('/uber/pricing', ...guardFresh('admin'), integrations.uberSetPricing);
router.put('/uber/menu/auto', ...guardFresh('admin'), integrations.uberSetAutoPublish);
router.get('/uber/prep', ...guard('admin', 'cashier'), integrations.uberPrep);
router.put('/uber/prep', ...guard('admin', 'cashier'), integrations.uberSetPrep);
router.post('/uber/remove', ...guardFresh('admin'), integrations.uberRemove);
router.get('/uber/sweep', integrations.uberSweep); // lo llama un reloj externo con CRON_SECRET, no un usuario
router.get('/uber/metrics', ...guard('admin', 'cashier'), integrations.uberMetrics);
router.post('/uber/reconcile', ...guard('admin', 'cashier'), integrations.uberReconcile);
// Conectar la tienda con Uber por OAuth (solo el administrador)
router.get('/uber/connect', ...guardFresh('admin'), integrations.uberConnect);
router.get('/uber/oauth/callback', integrations.uberOAuthCallback); // público: lo abre el navegador al volver de Uber
router.get('/uber/pending', ...guardFresh('admin'), integrations.uberPending);
router.post('/uber/activate', ...guardFresh('admin'), integrations.uberActivate);
router.delete('/uber', ...guardFresh('admin'), integrations.uberUnlink);

module.exports = router;
