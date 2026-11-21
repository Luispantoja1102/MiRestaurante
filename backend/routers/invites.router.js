const router = require('express').Router();
const invites = require('../controllers/invites.controller');
const { guard } = require('../middleware/auth.middleware');

router.get('/token/:token', invites.getByToken);
router.post('/accept', invites.accept);

router.get('/', ...guard('admin'), invites.list);
router.post('/', ...guard('admin'), invites.create);
router.put('/:id/revoke', ...guard('admin'), invites.revoke);
router.delete('/:id', ...guard('admin'), invites.remove);

module.exports = router;
