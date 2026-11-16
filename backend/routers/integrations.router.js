const router = require('express').Router();
const integrations = require('../controllers/integrations.controller');
const { requireAuth, requireActiveSubscription, requireRoles, requireFreshRole } = require('../middleware/auth.middleware');

// Público: lo llama Uber. Se protege con la firma HMAC, no con sesión.
router.post('/uber/webhook', integrations.uberWebhook);

// Vincular la tienda de Uber Eats con este negocio (solo el administrador)
router.get('/uber', requireAuth, requireActiveSubscription, requireRoles('admin'), integrations.uberStatus);
router.put('/uber', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberLink);
router.delete('/uber', requireAuth, requireActiveSubscription, requireFreshRole('admin'), integrations.uberUnlink);

module.exports = router;
