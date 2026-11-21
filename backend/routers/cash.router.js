const router = require('express').Router();
const cash = require('../controllers/cash.controller');
const { guard } = require('../middleware/auth.middleware');

const cashRoles = guard('admin', 'cashier');

router.get('/session', ...cashRoles, cash.current);
router.post('/session/open', ...cashRoles, cash.open);
router.post('/session/close', ...cashRoles, cash.close);
router.get('/session/:id', ...cashRoles, cash.getById);

module.exports = router;
