const router = require('express').Router();
const orders = require('../controllers/orders.controller');
const integrations = require('../controllers/integrations.controller');
const { guard } = require('../middleware/auth.middleware');

router.get(
  '/',
  ...guard('admin', 'cashier', 'waiter', 'kitchen', 'host'),
  orders.list
);
// Pedidos de una plataforma (Uber Eats) que esperan respuesta: liviano, para avisar desde cualquier pantalla
router.get('/awaiting', ...guard('admin', 'cashier'), orders.awaiting);
router.get(
  '/:id',
  ...guard('admin', 'cashier', 'waiter', 'kitchen', 'host'),
  orders.getById
);
router.post('/', ...guard('admin', 'cashier', 'waiter'), orders.create);
// Venta de mostrador (café): pide + cobra en un paso
router.post('/counter', ...guard('admin', 'cashier'), orders.counterSale);
router.put(
  '/:id/status',
  ...guard('admin', 'cashier', 'kitchen', 'waiter'),
  orders.updateStatus
);
// Pedidos que llegan de Uber Eats: aceptar o rechazar (Uber espera respuesta en ~11 min)
router.put('/:id/external/accept', ...guard('admin', 'cashier'), integrations.acceptUberOrder);
router.put('/:id/external/deny', ...guard('admin', 'cashier'), integrations.denyUberOrder);
router.put('/:id/external/cancel', ...guard('admin', 'cashier'), integrations.cancelUberOrder);
router.put('/:id/external/delivery', ...guard('admin', 'cashier'), integrations.deliveryStatusUberOrder);
router.put('/:id/external/sync', ...guard('admin', 'cashier'), integrations.uberSyncOrder);
router.put('/:id/external/ready-time', ...guard('admin', 'cashier'), integrations.uberReadyTime);
router.put('/:id/external/out-of-item', ...guard('admin', 'cashier'), integrations.uberAskCustomer);
router.put('/:id/external/adjust-price', ...guard('admin', 'cashier'), integrations.uberAdjustPrice);
router.put('/:id/pay', ...guard('admin', 'cashier'), orders.pay);

module.exports = router;
