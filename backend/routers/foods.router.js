const router = require('express').Router();
const menus = require('../controllers/menus.controller');
const { guard } = require('../middleware/auth.middleware');

const readRoles = guard('admin', 'cashier', 'waiter', 'kitchen');
const writeRoles = guard('admin');

router.get('/:id/image', menus.foodImage); // pública: Uber Eats descarga la foto sin sesión
router.get('/', ...readRoles, menus.listFoods);
router.get('/:id', ...readRoles, menus.getFood);
router.post('/', ...writeRoles, menus.createFood);
router.put('/:id', ...writeRoles, menus.updateFood);
router.delete('/:id', ...writeRoles, menus.deleteFood);

module.exports = router;
