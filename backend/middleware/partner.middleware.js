const db = require('../database/mongodb');
const { isPartnerRole } = require('../models/roles');

/**
 * Cuentas de socio: confirma en la base que la cuenta siga activa y con su rol vigente (el del token vale 24 h:
 * sin esto, a quien se desactiva o se le baja el rol seguiría entrando con su token anterior) y deja el socio al que pertenece.
 * Va después de requireAuth.
 */
async function partnerContext(req, res, next) {
  try {
    const user = await db.FindUserByUsername(req.user?.username);
    if (!user || user.disabled || !isPartnerRole(user.role) || !user.partnerId) {
      return res.status(403).send('Sin permiso para esta acción');
    }
    req.user = { ...req.user, role: user.role, partnerId: String(user.partnerId) };
    req.partnerId = String(user.partnerId);
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message || 'Error al verificar permisos');
  }
}

module.exports = { partnerContext };
