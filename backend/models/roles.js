/**
 * Fuente única de verdad de los roles del negocio.
 * El frontend tiene su espejo en `frontend/src/roles.js`; el test
 * `tests/roles.test.js` verifica que ambos listados no se desalineen.
 */

const ROLE_DEFS = [
  {
    id: 'admin',
    label: 'Administrador',
    description: 'Controla el negocio completo, de la carta a la facturación.',
    sees: ['Panel del día', 'Menú y precios', 'Equipo y roles', 'Ajustes y facturación'],
  },
  {
    id: 'waiter',
    label: 'Mesero',
    description: 'Todo lo que necesita para atender rápido, nada más.',
    sees: ['Mapa de mesas', 'Tomar pedidos', 'Platos listos'],
  },
  {
    id: 'kitchen',
    label: 'Cocina',
    description: 'Una cola clara de comandas por preparar, en orden.',
    sees: ['Comandas nuevas', 'Tiempo por pedido', 'Marcar listo'],
  },
  {
    id: 'cashier',
    label: 'Caja',
    description: 'Cuentas armadas al momento y un cierre sin sorpresas.',
    sees: ['Cobros', 'Impresión de cuentas', 'Cierre del día'],
  },
  {
    id: 'host',
    label: 'Anfitrión',
    description: 'La puerta en orden, incluso en hora pico.',
    sees: ['Lista de espera', 'Mesas libres', 'Asignar mesa'],
  },
];

/** Nombres antiguos que aún pueden venir en tokens, invitaciones o usuarios viejos. */
const LEGACY_ROLE_ALIASES = { hosstess: 'host' };

const TENANT_ROLES = ROLE_DEFS.map((r) => r.id);
// Equipo de la plataforma: no pertenecen a ningún negocio. El admin lo gestiona todo; soporte consulta clientes.
const PLATFORM_ROLES = ['platform_admin', 'platform_support'];
// Socios (vendedores): el dueño del socio y su equipo. Tampoco pertenecen a un negocio; ven solo los clientes que llegaron con su código.
const PARTNER_ROLES = ['partner_admin', 'partner_staff'];
const ROLES = [...TENANT_ROLES, ...PLATFORM_ROLES, ...PARTNER_ROLES];

function normalizeRole(role) {
  if (!role) return role;
  return LEGACY_ROLE_ALIASES[role] || role;
}

function isTenantRole(role) {
  return TENANT_ROLES.includes(normalizeRole(role));
}

function isPlatformStaff(role) {
  return PLATFORM_ROLES.includes(normalizeRole(role));
}

function isPartnerRole(role) {
  return PARTNER_ROLES.includes(role);
}

/** Cuentas que no pertenecen a ningún negocio (plataforma y socios): su sesión no lleva tenantId. */
function isOutsideTenant(role) {
  return isPlatformStaff(role) || isPartnerRole(role);
}

module.exports = {
  ROLE_DEFS,
  ROLES,
  TENANT_ROLES,
  PLATFORM_ROLES,
  PARTNER_ROLES,
  isPlatformStaff,
  isPartnerRole,
  isOutsideTenant,
  LEGACY_ROLE_ALIASES,
  normalizeRole,
  isTenantRole,
};
