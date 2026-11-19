// Avisos propios de la aplicación, en lugar de los del navegador (confirm, prompt, alert).
// Se usan con await y se dibujan en <DialogHost /> (montado una sola vez en App.vue):
//   if (!(await askConfirm("¿Eliminar?", { danger: true, confirmText: "Eliminar" }))) return;
//   const motivo = await askText("Motivo", "manual");   // null si se cancela
//   await notify("Listo.");
import { reactive } from "vue";

export const dialogState = reactive({ current: null });
const waiting = []; // si llega otro aviso mientras hay uno abierto, espera su turno

function open(spec) {
  return new Promise((resolve) => {
    const item = { ...spec, resolve };
    if (dialogState.current) waiting.push(item);
    else dialogState.current = item;
  });
}

/** Cierra el aviso abierto con `value` y abre el siguiente, si hay. */
export function closeDialog(value) {
  const current = dialogState.current;
  dialogState.current = waiting.shift() || null;
  current?.resolve(value);
}

/** Pregunta sí o no. Devuelve true si se acepta. opciones: { title, confirmText, cancelText, danger } */
export const askConfirm = (message, options = {}) => open({ kind: "confirm", message, ...options });

/** Pide un texto. Devuelve el texto o null si se cancela. opciones: { title, confirmText, cancelText, placeholder } */
export const askText = (message, value = "", options = {}) => open({ kind: "text", message, value, ...options });

/** Avisa algo y espera a que se entienda. opciones: { title, confirmText } */
export const notify = (message, options = {}) => open({ kind: "notify", message, ...options });
