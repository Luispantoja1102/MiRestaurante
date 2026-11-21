const router = require('express').Router();
const menus = require('../controllers/menus.controller');
const { guard } = require('../middleware/auth.middleware');

const readRoles = guard('admin', 'cashier', 'waiter', 'kitchen');
const writeRoles = guard('admin');

router.get('/', ...readRoles, menus.listMenus);
router.get('/:id', ...readRoles, menus.getMenu);
router.post('/', ...writeRoles, menus.createMenu);
router.put('/:id', ...writeRoles, menus.updateMenu);
router.delete('/:id', ...writeRoles, menus.deleteMenu);

module.exports = router;
