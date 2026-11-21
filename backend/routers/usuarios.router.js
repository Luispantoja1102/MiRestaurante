const router = require('express').Router();
const multer = require('multer');
const upload = multer();
const userController = require('../controllers/user.controller');
const { guard, requireAuth } = require('../middleware/auth.middleware');

router.post('/register', upload.none(), userController.CreateUser);
router.get('/referral/:code', userController.CheckReferralCode);
router.post('/login', upload.none(), userController.LoginUsuario, (req, res) => {
  return res.status(200).json({
    token: req.token,
    role: req.role,
    tenantId: req.tenantId,
    username: req.username,
  });
});
router.post('/forgot-password', upload.none(), userController.ForgotPassword);
router.post('/reset-password', upload.none(), userController.ResetPassword);

router.get('/me', requireAuth, userController.Me);
router.put('/password', requireAuth, userController.ChangePassword);

router.get('/find', ...guard('admin'), upload.none(), userController.FindUserByEmail);
router.get(
  '/waitlist/',
  ...guard('admin', 'host'),
  upload.none(),
  userController.GetWaitList
);
router.post(
  '/waitlist/add',
  ...guard('admin', 'host'),
  upload.none(),
  userController.AddWaitList
);
router.delete(
  '/waitlist/delete/:id',
  ...guard('admin', 'host'),
  upload.none(),
  userController.DeleteWaitList
);

module.exports = router;
