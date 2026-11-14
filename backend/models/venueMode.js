/**
 * Enfoque de servicio del negocio: cómo trabaja y, por lo tanto, qué roles puede tener su equipo.
 *
 *  - takeaway  «Solo delivery o para llevar»: opera como MOSTRADOR (se pide, se cobra y se entrega en un solo paso,
 *              sin mesas, cocina ni mesero). Roles: Administrador y Caja.
 *  - waiters   «Delivery y con meseros»: flujo de salón con mesas y meseros; la caja cobra sin pasar por cocina.
 *              Roles: Administrador, Caja y Mesero.
 *  - full      «Completo» (delivery, meseros, anfitrión y cocina): todos los roles.
 *
 * Cada rol puede tener varias personas, cada una con su cuenta; el dueño les asigna el rol. No hay tope de personas.
 *
 * Los negocios creados antes de existir el enfoque no lo tienen guardado: los cafés pasan a `takeaway` (como ya
 * operaban) y el resto a `full` (nada cambia para ellos).
 *
 * El frontend tiene su espejo en `frontend/src/roles.js`; `tests/roles.test.js` verifica que coincidan.
 */
const { TENANT_ROLES } = require('./roles');

const SERVICE_FOCUSES = ['takeaway', 'waiters', 'full'];
const FOCUS_ROLES = {
  takeaway: ['admin', 'cashier'],
  waiters: ['admin', 'cashier', 'waiter'],
  full: TENANT_ROLES,
};
const FOCUS_LABELS = { takeaway: 'Solo para llevar', waiters: 'Con meseros', full: 'Completo' };
// Antes del enfoque, solo el tipo de negocio «café» operaba como mostrador
const LEGACY_TAKEAWAY_TYPES = ['cafe'];

/** Enfoque vigente de un negocio, con la compatibilidad de los que no lo tienen guardado. */
function focusOf(settings) {
  if (SERVICE_FOCUSES.includes(settings?.serviceFocus)) return settings.serviceFocus;
  return LEGACY_TAKEAWAY_TYPES.includes(settings?.businessType) ? 'takeaway' : 'full';
}

/** Flujo de pantallas: el mostrador para «solo para llevar»; mesas, caja y demás para el resto. */
function modeOf(settings) {
  return focusOf(settings) === 'takeaway' ? 'counter' : 'table';
}

/** Límites del negocio según su enfoque: { focus, mode, maxUsers (null = sin tope), allowedRoles }. */
function limitsFor(settings) {
  const focus = focusOf(settings);
  return { focus, mode: modeOf(settings), maxUsers: null, allowedRoles: FOCUS_ROLES[focus] };
}

const roleName = (id) => require('./roles').ROLE_DEFS.find((r) => r.id === id)?.label || id;
const joinNames = (ids) => {
  const names = ids.map(roleName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0];
};

/** Mensaje de error si agregar esta cuenta rompe los límites del negocio; null si cabe. */
function memberLimitError(limits, role, currentCount) {
  if (!limits.allowedRoles.includes(role)) {
    return `En «${FOCUS_LABELS[limits.focus]}» solo hay ${joinNames(limits.allowedRoles)}.`;
  }
  if (limits.maxUsers != null && currentCount >= limits.maxUsers) {
    return `Este enfoque incluye hasta ${limits.maxUsers} personas. Elimina una cuenta para agregar otra.`;
  }
  return null;
}

/** Mensaje de error si el equipo actual no cabe en el enfoque (p. ej. al pasar a «Solo para llevar»); null si cabe. */
function teamFitError(limits, users) {
  const wrong = [...new Set(users.map((u) => u.role).filter((r) => !limits.allowedRoles.includes(r)))];
  if (wrong.length) {
    return `Para usar «${FOCUS_LABELS[limits.focus]}» primero elimina o cambia las cuentas con rol ${wrong.map(roleName).join(', ')}.`;
  }
  if (limits.maxUsers != null && users.length > limits.maxUsers) {
    return `Este enfoque incluye hasta ${limits.maxUsers} personas y tienes ${users.length} cuentas. Elimina las que sobran.`;
  }
  return null;
}

module.exports = {
  SERVICE_FOCUSES,
  FOCUS_ROLES,
  FOCUS_LABELS,
  LEGACY_TAKEAWAY_TYPES,
  focusOf,
  modeOf,
  limitsFor,
  memberLimitError,
  teamFitError,
};
