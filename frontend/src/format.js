/** Formatos compartidos por todas las pantallas: un solo lugar para el dinero y para el texto de los errores del servidor. */

/** Pesos mexicanos: 1285.2 → «$1,285.20». Acepta vacío o texto numérico. */
export function money(value) {
  return Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

/**
 * Mensaje de un error de axios para mostrar en pantalla: el texto que mandó el servidor,
 * su campo `message` si mandó un objeto, o `fallback` si no hay nada que mostrar.
 */
export function errorText(e, fallback) {
  const data = e?.response?.data;
  return (typeof data === "string" && data) || data?.message || fallback;
}
