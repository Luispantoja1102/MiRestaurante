/** Formatos compartidos por las pantallas de la plataforma. */

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// El dinero y el texto de los errores viven en src/format.js (los usa toda la aplicación); aquí se reexportan para no tocar estas pantallas
export { money, errorText } from "../../format";

/** "hace 3 días", "hoy"… para la última vez que alguien entró. */
export function fmtAgo(value) {
  if (!value) return "Nunca";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (Number.isNaN(days)) return "—";
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}

export const STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "trialing", label: "Prueba" },
  { id: "active", label: "Activos" },
  { id: "past_due", label: "Pago atrasado" },
  { id: "suspended", label: "Suspendidos" },
];

export const ROLE_NAMES = {
  admin: "Administrador",
  waiter: "Mesero",
  kitchen: "Cocina",
  cashier: "Caja",
  host: "Anfitrión",
};

export const REFERRER_STATUS = { active: "Activo", paused: "Pausado", pending: "Pendiente" };
export const COMMISSION_STATUS = { pending: "Pendiente", paid: "Pagada", void: "Anulada" };
export const BILLING_NAMES = { trialing: "Prueba", active: "Activo", past_due: "Pago atrasado", suspended: "Suspendido" };
export const TICKET_STATUS = { open: "Esperando al equipo", answered: "Respondido", closed: "Cerrado" };
// Reutiliza los colores de los estados del panel: pendiente de atender en ámbar, resuelto en verde
export const TICKET_PILL = { open: "past_due", answered: "active", closed: "never_logged" };
export const percent = (rate) => `${Math.round(Number(rate || 0) * 100)}%`;
