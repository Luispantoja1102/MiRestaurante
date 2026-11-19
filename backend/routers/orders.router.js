const router = require('express').Router();
const orders = require('../controllers/orders.controller');
const integrations = require('../controllers/integrations.controller');
const { requireAuth, requireActiveSubscription, requireRoles } = require('../middleware/auth.middleware');

router.get(
  '/',
  requireAuth, requireActiveSubscription,
  requireRoles('admin', 'cashier', 'waiter', 'kitchen', 'host'),
  orders.list
);
// Pedidos de una plataforma (Uber Eats) que esperan respuesta: liviano, para avisar desde cualquier pantalla
router.get('/awaiting', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), orders.awaiting);
router.get(
  '/:id',
  requireAuth, requireActiveSubscription,
  requireRoles('admin', 'cashier', 'waiter', 'kitchen', 'host'),
  orders.getById
);
router.post('/', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier', 'waiter'), orders.create);
// Venta de mostrador (café): pide + cobra en un paso
router.post('/counter', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), orders.counterSale);
router.put(
  '/:id/status',
  requireAuth, requireActiveSubscription,
  requireRoles('admin', 'cashier', 'kitchen', 'waiter'),
  orders.updateStatus
);
// Pedidos que llegan de Uber Eats: aceptar o rechazar (Uber espera respuesta en ~11 min)
router.put('/:id/external/accept', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.acceptUberOrder);
router.put('/:id/external/deny', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.denyUberOrder);
router.put('/:id/external/cancel', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.cancelUberOrder);
router.put('/:id/external/delivery', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.deliveryStatusUberOrder);
router.put('/:id/external/sync', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberSyncOrder);
router.put('/:id/external/ready-time', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberReadyTime);
router.put('/:id/external/out-of-item', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), integrations.uberAskCustomer);
router.put('/:id/pay', requireAuth, requireActiveSubscription, requireRoles('admin', 'cashier'), orders.pay);

module.exports = router;
