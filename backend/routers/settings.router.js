const router = require('express').Router();
const multer = require('multer');
const upload = multer();
const settingsController = require('../controllers/settings.controller');
const { guard, requireAuth } = require('../middleware/auth.middleware');

// Lectura permitida aunque el trial haya vencido (banner / billing)
router.get('/', requireAuth, upload.none(), settingsController.GetSettings);
router.post(
  '/',
  ...guard('admin'),
  upload.none(),
  settingsController.SaveSettings
);
router.put(
  '/',
  ...guard('admin'),
  upload.none(),
  settingsController.SaveSettings
);

module.exports = router;
