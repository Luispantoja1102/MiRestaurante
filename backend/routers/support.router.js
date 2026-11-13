/**
 * Soporte para el negocio (/support): el administrador abre tickets y los contesta.
 * Sin requireActiveSubscription a propósito: un negocio suspendido o con la prueba vencida debe poder pedir ayuda.
 */
const router = require('express').Router();
const support = require('../controllers/support.controller');
const { requireAuth, requireRoles } = require('../middleware/auth.middleware');

const owner = [requireAuth, requireRoles('admin')];

router.get('/tickets', ...owner, support.list);
router.post('/tickets', ...owner, support.create);
router.get('/tickets/:id', ...owner, support.get);
router.post('/tickets/:id/messages', ...owner, support.reply);

module.exports = router;
