/**
 * Aviso de pedidos de plataforma (Uber Eats) que esperan respuesta, desde cualquier pantalla.
 * Suena y se repite mientras haya alguno sin responder: a los ~11 minutos Uber lo cancela y baja la tasa de aceptación.
 * Usa el sondeo compartido (live.js) y el sonido de sound.js, igual que los avisos del mesero.
 */
import { reactive, computed } from "vue";
import { apiService } from "./apiService";
import { hasRole } from "./authStore";
import { bindLive } from "./live";
import { beep, resumeAudio } from "./sound";
import { channelLabel } from "./labels";

const REPEAT_MS = 15000;

export const platformAlerts = reactive({
  orders: [],
  permission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
});
export const awaitingOrders = computed(() => platformAlerts.orders);

const announced = new Set();
let binding = null;
let starting = false;
let repeat = null;

const nameOf = (o) => channelLabel[o.channel] || "La plataforma";

/** A qué pestaña de Caja llevar al usuario: Uber Eats si todos son de Uber, «otras apps» si son de otra, la general si hay mezcla. */
export function platformSourceOf(orders) {
  const channels = new Set(orders.map((o) => o.channel || o.external?.provider));
  if (channels.size !== 1) return null;
  return channels.has("uber") ? "uber" : "other";
}
/** Destino de «Ir a Caja» para estos pedidos. */
export function platformOrdersTarget(orders) {
  const origen = platformSourceOf(orders);
  return origen ? { path: "/orders", query: { origen } } : { path: "/orders" };
}

function announce(fresh) {
  navigator.vibrate?.([200, 100, 200]);
  beep();
  if (platformAlerts.permission === "granted" && document.hidden) {
    for (const o of fresh) {
      try {
        const n = new Notification(`${nameOf(o)}: pedido nuevo`, {
          body: `${o.customerName || "Cliente"} · acéptalo en Caja antes de que expire.`,
          tag: `plat-${o.id}`,
          icon: "/logo.svg",
        });
        n.onclick = () => {
          window.focus();
          const origen = platformSourceOf([o]);
          window.location.assign(origen ? `/orders?origen=${origen}` : "/orders"); // el aviso lleva a Caja, en la pestaña de ese pedido
        };
      } catch {
        // Algunos navegadores solo permiten avisos desde un service worker
      }
    }
  }
}

// Un pedido cuya ventana de Uber ya terminó (Uber lo cancela solo) no debe seguir sonando
const alive = (o) => !o.external?.deadline || new Date(o.external.deadline).getTime() > Date.now();
let retry = false; // la última consulta falló: se reintenta en el siguiente ciclo

async function poll() {
  // Con la pestaña oculta solo se sigue consultando si hay permiso para avisar
  if (document.hidden && platformAlerts.permission !== "granted") return;
  try {
    platformAlerts.orders = ((await apiService.getAwaitingOrders()) || []).filter(alive);
    retry = false;
  } catch {
    // Sin servidor no se sabe qué hay pendiente: no se sigue sonando con una lista vieja
    platformAlerts.orders = [];
    retry = true;
    return;
  }
  const fresh = platformAlerts.orders.filter((o) => !announced.has(o.id));
  fresh.forEach((o) => announced.add(o.id));
  if (fresh.length) announce(fresh);
}

function onVisible() {
  if (binding && !document.hidden) poll();
}

/** Se suscribe a los cambios una sola vez, solo para administrador y caja. */
export async function startOrderAlerts() {
  if (binding || starting || !hasRole("admin", "cashier")) return;
  starting = true;
  try {
    window.addEventListener("pointerdown", resumeAudio, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    binding = bindLive(["orders"], () => poll(), { background: () => platformAlerts.permission === "granted" });
    await binding.ready;
    // Mientras haya pedidos sin responder, vuelve a sonar hasta que alguien los atienda
    repeat = setInterval(() => {
      platformAlerts.orders = platformAlerts.orders.filter(alive); // los vencidos dejan de contar y de sonar
      if (retry) poll();
      else if (platformAlerts.orders.length) beep();
    }, REPEAT_MS);
    await poll();
  } finally {
    starting = false;
  }
}

export function stopOrderAlerts() {
  binding?.stop();
  binding = null;
  clearInterval(repeat);
  repeat = null;
  document.removeEventListener("visibilitychange", onVisible);
  platformAlerts.orders = [];
  announced.clear();
}

export async function enableOrderNotifications() {
  if (typeof Notification === "undefined") return;
  platformAlerts.permission = await Notification.requestPermission();
}
