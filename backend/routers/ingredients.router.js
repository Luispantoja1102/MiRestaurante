const router = require('express').Router();
const ingredients = require('../controllers/ingredients.controller');
const { guard } = require('../middleware/auth.middleware');

// Ver el inventario: quien vende (para saber qué falta). Cambiarlo: solo el administrador.
const read = guard('admin', 'cashier');
const write = guard('admin');

router.get('/', ...read, ingredients.list);
router.get('/movements', ...write, ingredients.movements);
router.post('/', ...write, ingredients.create);
router.put('/:id', ...write, ingredients.update);
router.delete('/:id', ...write, ingredients.remove);
router.post('/:id/stock', ...write, ingredients.stockOp);

module.exports = router;
