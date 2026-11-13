/**
 * Portal de socios (/partner). Solo cuentas partner_admin / partner_staff, siempre limitadas a su socio.
 */
const router = require('express').Router();
const partner = require('../controllers/partner.controller');
const { requireAuth, requireRoles } = require('../middleware/auth.middleware');
const { partnerContext } = require('../middleware/partner.middleware');

const anyone = [requireAuth, partnerContext, requireRoles('partner_admin', 'partner_staff')];
const owner = [requireAuth, partnerContext, requireRoles('partner_admin')];

router.get('/home', ...anyone, partner.home);
router.get('/clients', ...anyone, partner.clients);
router.get('/clients/:id', ...anyone, partner.client);
router.post('/clients/:id/notes', ...anyone, partner.addNote);
router.put('/clients/:id/assignee', ...owner, partner.assign);

router.get('/commissions', ...owner, partner.commissions);

router.get('/team', ...anyone, partner.team);
router.post('/team', ...owner, partner.createMember);
router.put('/team/:id/deactivate', ...owner, partner.deactivate);
router.put('/team/:id/reactivate', ...owner, partner.reactivate);
router.put('/team/:id/role', ...owner, partner.changeRole);

module.exports = router;
