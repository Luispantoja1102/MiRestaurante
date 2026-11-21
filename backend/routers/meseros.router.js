const router = require('express').Router();
const multer = require('multer');
const upload = multer();
const meseroController = require('../controllers/mesero.controller');
const { guard } = require('../middleware/auth.middleware');

const staffRoles = guard('admin');

router.get('/', ...guard('admin', 'host', 'waiter', 'cashier'), upload.none(), meseroController.GetWaiters);
router.get('/dispon/:disponibility', ...staffRoles, upload.none(), meseroController.GetWaiterByDisponibility);
router.get('/:cellphone', ...staffRoles, upload.none(), meseroController.GetWaiterByCellphone);
router.post('/add', ...staffRoles, upload.none(), meseroController.AddWaiter);
router.put('/:cellphone', ...staffRoles, upload.none(), meseroController.UpdateWaiter);
router.delete('/:cellphone', ...staffRoles, upload.none(), meseroController.DeleteWaiter);

module.exports = router;
