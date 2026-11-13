const router = require('express').Router();
const platform = require('../controllers/platform.controller');
const { requireAuth, requireRoles } = require('../middleware/auth.middleware');

// Soporte consulta clientes; solo el admin cambia cosas, ve el resumen y gestiona al equipo
const staff = [requireAuth, requireRoles('platform_admin', 'platform_support')];
const adminOnly = [requireAuth, requireRoles('platform_admin')];

router.get('/overview', ...adminOnly, platform.overview);
router.get('/activity', ...adminOnly, platform.activity);

router.get('/finance', ...adminOnly, platform.financeSummary);
router.post('/expenses', ...adminOnly, platform.createExpense);
router.delete('/expenses/:id', ...adminOnly, platform.deleteExpense);

// Mi código de vendedor: el admin liga su cuenta con su propio vendedor
router.get('/my-seller', ...adminOnly, platform.mySeller);
router.post('/my-seller', ...adminOnly, platform.activateMySeller);
router.get('/referrers', ...adminOnly, platform.listReferrers);
router.post('/referrers', ...adminOnly, platform.createReferrer);
router.get('/referrers/:id', ...adminOnly, platform.getReferrer);
router.patch('/referrers/:id', ...adminOnly, platform.updateReferrer);
router.post('/referrers/:id/payouts', ...adminOnly, platform.payReferrer);
router.get('/referrers/:id/users', ...adminOnly, platform.referrerUsers);
router.post('/referrers/:id/users', ...adminOnly, platform.createReferrerUser);
router.put('/referrers/:id/users/:userId/active', ...adminOnly, platform.setReferrerUserActive);
router.post('/commissions/:id/void', ...adminOnly, platform.voidCommission);

router.get('/staff', ...adminOnly, platform.listStaff);
router.post('/staff', ...adminOnly, platform.createStaff);
router.delete('/staff/:id', ...adminOnly, platform.deleteStaff);

router.get('/tenants', ...staff, platform.listTenants);
router.get('/tenants/:id', ...staff, platform.getTenant);
router.get('/tenants/:id/activity', ...staff, platform.tenantActivity);

// Soporte lo atiende tanto el admin como el equipo de soporte
router.get('/support', ...staff, platform.supportBoard);
router.get('/tenants/:id/tickets', ...staff, platform.tenantTickets);
router.post('/tenants/:id/tickets', ...staff, platform.createTenantTicket);
router.get('/tickets/:id', ...staff, platform.getTicket);
router.post('/tickets/:id/reply', ...staff, platform.replyTicket);
router.post('/tickets/:id/close', ...staff, platform.closeTicket);
router.post('/tickets/:id/reopen', ...staff, platform.reopenTicket);

router.patch('/tenants/:id', ...adminOnly, platform.updateTenant);
router.post('/tenants/:id/suspend', ...adminOnly, platform.suspend);
router.post('/tenants/:id/reactivate', ...adminOnly, platform.reactivate);
router.patch('/tenants/:id/plan', ...adminOnly, platform.setPlan);
router.post('/tenants/:id/manual-payment', ...adminOnly, platform.manualPayment);
router.put('/tenants/:id/referrer', ...adminOnly, platform.setTenantReferrer);

module.exports = router;
