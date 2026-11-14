/**
 * Fuente única de verdad de roles y pantallas del frontend.
 * Espejo de `backend/models/roles.js` (el test `backend/tests/roles.test.js`
 * verifica que ids y etiquetas coincidan).
 *
 * Para agregar una pantalla: añade una fila a SCREENS con los roles que pueden
 * entrar. La navegación, los guards de ruta y la pantalla de inicio salen de aquí.
 */

export const ROLE_DEFS = [
  {
    id: "admin",
    label: "Administrador",
    description: "Controla el negocio completo, de la carta a la facturación.",
    sees: ["Panel del día", "Menú y precios", "Equipo y roles", "Ajustes y facturación"],
    home: "main",
  },
  {
    id: "waiter",
    label: "Mesero",
    description: "Todo lo que necesita para atender rápido, nada más.",
    sees: ["Mapa de mesas", "Tomar pedidos", "Platos listos"],
    home: "main",
  },
  {
    id: "kitchen",
    label: "Cocina",
    description: "Una cola clara de comandas por preparar, en orden.",
    sees: ["Comandas nuevas", "Tiempo por pedido", "Marcar listo"],
    home: "kitchen",
  },
  {
    id: "cashier",
    label: "Caja",
    description: "Cuentas armadas al momento y un cierre sin sorpresas.",
    sees: ["Cobros", "Impresión de cuentas", "Cierre del día"],
    home: "orders",
  },
  {
    id: "host",
    label: "Anfitrión",
    description: "La puerta en orden, incluso en hora pico.",
    sees: ["Lista de espera", "Mesas libres", "Asignar mesa"],
    home: "waitlist",
  },
];

const PLATFORM_ROLES = [
  { id: "platform_admin", label: "Plataforma", home: "platform" },
  { id: "platform_support", label: "Soporte", home: "platform" },
];
export const PLATFORM_ROLE_IDS = PLATFORM_ROLES.map((r) => r.id);

// Socios (vendedores): el dueño del socio y su equipo. Entran a su propio portal, no a un negocio.
const PARTNER_ROLES = [
  { id: "partner_admin", label: "Socio (dueño)", home: "partner" },
  { id: "partner_staff", label: "Socio (asesor)", home: "partner" },
];
export const PARTNER_ROLE_IDS = PARTNER_ROLES.map((r) => r.id);
/** Cuentas que no pertenecen a ningún negocio: plataforma y socios. */
export const OUTSIDE_TENANT_ROLE_IDS = [...PLATFORM_ROLE_IDS, ...PARTNER_ROLE_IDS];

/** Nombres antiguos que pueden seguir en sesiones guardadas o datos viejos. */
export const LEGACY_ROLE_ALIASES = { hosstess: "host" };

export function normalizeRole(role) {
  if (!role) return role;
  return LEGACY_ROLE_ALIASES[role] || role;
}

/**
 * Enfoque de servicio: cómo trabaja el negocio y, por lo tanto, qué roles y pantallas tiene. Espejo de
 * `backend/models/venueMode.js` (el test `backend/tests/roles.test.js` verifica que coincidan).
 *
 *  - takeaway «Solo delivery o para llevar»: opera como MOSTRADOR (se pide, se cobra y se entrega en un solo paso).
 *  - waiters  «Delivery y con meseros»: salón con mesas y meseros; la caja cobra sin pasar por cocina.
 *  - full     «Completo»: delivery, meseros, anfitrión y cocina.
 * Cada rol puede tener varias personas, cada una con su cuenta; el dueño les asigna el rol.
 */
export const SERVICE_FOCUSES = [
  {
    id: "takeaway",
    label: "Solo para llevar",
    tagline: "Delivery o para llevar",
    description: "Se pide, se cobra y se entrega en un solo paso, sin mesas ni cocina.",
    mode: "counter",
    roles: ["admin", "cashier"],
  },
  {
    id: "waiters",
    label: "Con meseros",
    tagline: "Delivery y salón con meseros",
    description: "Mesas con meseros que toman el pedido y una caja que cobra. Sin cocina ni anfitrión.",
    mode: "table",
    roles: ["admin", "cashier", "waiter"],
  },
  {
    id: "full",
    label: "Completo",
    tagline: "Delivery, meseros, anfitrión y cocina",
    description: "Todo el salón: anfitrión, meseros, cocina y caja, cada uno con su pantalla.",
    mode: "table",
    roles: ["admin", "cashier", "waiter", "kitchen", "host"],
  },
];
// Antes de existir el enfoque, solo el tipo de negocio «café» operaba como mostrador
export const LEGACY_TAKEAWAY_TYPES = ["cafe"];

/** Enfoque vigente de un negocio, con la compatibilidad de los que no lo tienen guardado. */
export function focusFor(settings) {
  if (SERVICE_FOCUSES.some((f) => f.id === settings?.serviceFocus)) return settings.serviceFocus;
  return LEGACY_TAKEAWAY_TYPES.includes(settings?.businessType) ? "takeaway" : "full";
}
export const focusInfo = (id) => SERVICE_FOCUSES.find((f) => f.id === id) || SERVICE_FOCUSES[2];
export const modeForFocus = (id) => focusInfo(id).mode;

let focusProvider = () => "full";
/** main.ts registra aquí de dónde leer el enfoque del negocio (evita un import circular con venueStore). */
export function setModeProvider(fn) {
  focusProvider = fn;
}
export const currentFocus = () => focusProvider();
export const currentMode = () => modeForFocus(currentFocus());
export const isCounterMode = () => currentMode() === "counter";

/** Qué ve cada rol en «solo para llevar» (reemplaza a `sees`/`description` en modo mostrador). */
export const COUNTER_ROLE_COPY = {
  admin: {
    description: "Atiende y además controla el negocio: menú, equipo, caja y facturación.",
    sees: ["Mostrador (vender y cobrar)", "Resumen del día", "Menú y productos", "Equipo, ajustes y facturación"],
  },
  cashier: {
    description: "Vende y cobra en el mostrador, y lleva la caja del día.",
    sees: ["Mostrador (vender y cobrar)", "Caja y cierre del día", "Impresión de tickets"],
  },
};

const BOTH = ["table", "counter"];

/**
 * Una fila por pantalla: nombre de ruta, path, etiqueta, roles con acceso y modos en que existe.
 * `counterRoles` (opcional) reemplaza a `roles` en modo mostrador. `focuses` (opcional) limita la pantalla a ciertos
 * enfoques dentro de su modo (sin él, existe en todos los enfoques del modo).
 */
export const SCREENS = [
  { name: "dashboard", path: "/dashboard", label: "Resumen", roles: ["admin"], modes: BOTH },
  // Solo para llevar: venta rápida de mostrador
  { name: "counter", path: "/counter", label: "Mostrador", roles: ["admin", "cashier"], modes: ["counter"] },
  // Salón: mesas y meseros desde «con meseros»; cocina y lista de espera solo en el enfoque completo
  { name: "main", path: "/main", label: "Mesas", roles: ["admin", "host", "waiter", "cashier"], modes: ["table"], focuses: ["waiters", "full"] },
  { name: "kitchen", path: "/kitchen", label: "Cocina", roles: ["admin", "kitchen", "cashier", "waiter"], modes: ["table"], focuses: ["full"] },
  { name: "waitlist", path: "/waitlist", label: "Lista de espera", roles: ["admin", "host"], modes: ["table"], focuses: ["full"] },
  { name: "staff", path: "/staff", label: "Meseros", roles: ["admin"], modes: ["table"], focuses: ["waiters", "full"] },
  // En salón se toma el pedido aquí; en «solo para llevar» solo el administrador edita los productos
  { name: "menu", path: "/menu", label: "Pedido", roles: ["admin", "waiter", "cashier"], counterRoles: ["admin"], modes: BOTH },
  { name: "orders", path: "/orders", label: "Caja", roles: ["admin", "cashier"], modes: BOTH },
  { name: "team", path: "/team", label: "Equipo y roles", roles: ["admin"], modes: BOTH },
  { name: "inventory", path: "/inventory", label: "Inventario", roles: ["admin"], modes: BOTH },
  { name: "billing", path: "/billing", label: "Facturación y planes", roles: ["admin", "cashier"], modes: BOTH },
  { name: "settings", path: "/settings", label: "Configuración", roles: ["admin"], modes: BOTH },
  { name: "support", path: "/support", label: "Soporte", roles: ["admin"], modes: BOTH },
  { name: "setup", path: "/setup", label: "Configuración inicial", roles: ["admin"], modes: BOTH },
  { name: "printOrder", path: "/print/order/:id", label: "Cuenta", roles: ["admin", "cashier", "waiter", "kitchen"], modes: BOTH },
  { name: "printCash", path: "/print/cash/:id", label: "Cierre de caja", roles: ["admin", "cashier"], modes: BOTH },
  { name: "platform", path: "/platform", label: "Plataforma", roles: PLATFORM_ROLE_IDS, modes: BOTH },
  { name: "partner", path: "/partner", label: "Portal de socios", roles: PARTNER_ROLE_IDS, modes: BOTH },
];

export const roleLabel = Object.fromEntries(
  [...ROLE_DEFS, ...PLATFORM_ROLES, ...PARTNER_ROLES].map((r) => [r.id, r.label])
);

export const roleHome = Object.fromEntries(
  [...ROLE_DEFS, ...PLATFORM_ROLES, ...PARTNER_ROLES].map((r) => [r.id, r.home])
);

export const routeRoles = Object.fromEntries(SCREENS.map((s) => [s.name, s.roles]));

/** Roles de una pantalla en un modo (counterRoles reemplaza a roles en modo mostrador). */
export function rolesFor(screen, mode = "table") {
  return mode === "counter" && screen.counterRoles ? screen.counterRoles : screen.roles;
}

/** Roles con acceso a una pantalla en cualquier modo (para meta.roles de las rutas). */
export function screenRoles(name) {
  const s = SCREENS.find((x) => x.name === name);
  return s ? [...new Set([...s.roles, ...(s.counterRoles || [])])] : [];
}

// Sin enfoque a la mano, el modo da el valor de siempre: mostrador = solo para llevar, salón = completo
const focusOfMode = (mode) => (mode === "counter" ? "takeaway" : "full");

/** ¿Puede este rol entrar a esta pantalla en este modo y enfoque? Una pantalla desconocida no se restringe. */
export function canAccessScreen(name, role, mode = "table", focus = focusOfMode(mode)) {
  const s = SCREENS.find((x) => x.name === name);
  if (!s) return true;
  if (!s.modes.includes(mode)) return false;
  if (s.focuses && !s.focuses.includes(focus)) return false;
  return rolesFor(s, mode).includes(normalizeRole(role));
}

/** Pantalla de inicio de un rol. En modo mostrador todos entran directo a vender. */
export function homeForRole(role, mode = "table") {
  const r = normalizeRole(role);
  if (OUTSIDE_TENANT_ROLE_IDS.includes(r)) return roleHome[r];
  if (mode === "counter") return "counter";
  return roleHome[r] || "main";
}

/** Pantallas a las que puede entrar un rol en un modo y enfoque (útil para menús y para documentar). */
export function screensForRole(role, mode = "table", focus = focusOfMode(mode)) {
  return SCREENS.filter((s) => canAccessScreen(s.name, role, mode, focus));
}
