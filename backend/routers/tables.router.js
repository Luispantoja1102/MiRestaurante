const router = require('express').Router();
const tables = require('../controllers/tables.controller');
const { guard } = require('../middleware/auth.middleware');

const floorRoles = guard('admin', 'host', 'waiter', 'cashier');

router.get('/', ...floorRoles, tables.list);
router.get('/:id', ...floorRoles, tables.getById);
router.post('/', ...guard('admin', 'host'), tables.create);
router.put('/:id', ...floorRoles, tables.update);
router.delete('/:id', ...guard('admin'), tables.remove);

module.exports = router;
