/** Etiquetas de UI en español (valores internos del API se mantienen en inglés). */

export const orderStatusLabel = {
  pending: "Pendiente",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  cancelled: "Cancelado",
};

export const channelLabel = {
  local: "Local",
  phone: "Teléfono",
  uber: "Uber Eats",
  rappi: "Rappi",
  didi: "DiDi Food",
};
// Apps de reparto: la plataforma cobra al cliente y paga después al negocio
export const isPlatformChannel = (c) => ["uber", "rappi", "didi"].includes(c);

export const paymentStatusLabel = {
  unpaid: "Sin pagar",
  paid: "Pagado",
};

export const modalityLabel = {
  "dine-in": "En salón",
  takeaway: "Para llevar",
  delivery: "A domicilio",
};

export { roleLabel } from "./roles";

export const inviteStatusLabel = {
  pending: "Pendiente",
  accepted: "Aceptada",
  revoked: "Revocada",
  expired: "Expirada",
};

export function labelOf(map, key, fallback = key) {
  if (!key) return fallback || "";
  return map[key] || fallback || String(key);
}
