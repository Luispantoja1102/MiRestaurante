// Impresión directa en térmica (sin el diálogo del navegador).
// Se configura por dispositivo (cada caja, cada cocina, cada mesero con su impresora): menú Más → Impresora.
//  - usb:       WebUSB (Chrome PC y Android con OTG). En Windows la impresora debe usar el driver WinUSB.
//  - serial:    Web Serial (Chrome/Edge PC) para impresoras USB que aparecen como puerto COM.
//  - bluetooth: Web Bluetooth (Chrome Android/PC) para impresoras Bluetooth LE.
// Los tickets salen como texto ESC/POS (rápido, sin librerías).
import { reactive } from "vue";
import { EscPos, buildTestPage } from "./escpos";
import { venueStore } from "./venueStore";

const KEY = "mirestaurante_printer";
const PRINT_TIMEOUT_MS = 8000;

// Servicios BLE de las impresoras térmicas genéricas más comunes
const BT_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      mode: ["browser", "usb", "serial", "bluetooth"].includes(raw.mode) ? raw.mode : "browser",
      paper: raw.paper === "58" ? "58" : "80",
      drawer: Boolean(raw.drawer),
      autoPrint: raw.autoPrint !== false, // imprimir el ticket al cobrar
      ticketStyle: raw.ticketStyle === "text" ? "text" : "image", // la cuenta: diseño en imagen o texto simple
      dots80: [480, 576].includes(raw.dots80) ? raw.dots80 : 512,
      ink: ["light", "dark"].includes(raw.ink) ? raw.ink : "normal", // intensidad del ticket en imagen // puntos útiles en papel de 80 mm: Epson TM-T88 y similares imprimen 512, otras 576
      baudRate: Number(raw.baudRate) || 9600,
      deviceName: String(raw.deviceName || ""),
      portInfo: raw.portInfo && typeof raw.portInfo === "object" ? raw.portInfo : null,
    };
  } catch {
    return { mode: "browser", paper: "80", drawer: false, autoPrint: true, ticketStyle: "image", dots80: 512, ink: "normal", baudRate: 9600, deviceName: "", portInfo: null };
  }
}

// lost: se perdió la conexión con la impresora y se está intentando recuperar (para avisarlo antes de cobrar)
export const printerStore = reactive({ ...readSettings(), connected: false, busy: false, lost: false, trying: false, error: "" });

export function savePrinterSettings(patch = {}) {
  const modeChanged = patch.mode && patch.mode !== printerStore.mode;
  Object.assign(printerStore, patch);
  if (modeChanged) disconnect();
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        mode: printerStore.mode,
        paper: printerStore.paper,
        drawer: printerStore.drawer,
        autoPrint: printerStore.autoPrint,
        ticketStyle: printerStore.ticketStyle,
        dots80: printerStore.dots80,
        ink: printerStore.ink,
        baudRate: printerStore.baudRate,
        deviceName: printerStore.deviceName,
        portInfo: printerStore.portInfo,
      })
    );
  } catch {
    /* ignore */
  }
}

export function directPrinting() {
  return printerStore.mode !== "browser";
}

export function printerSupport() {
  const nav = typeof navigator === "undefined" ? {} : navigator;
  return { usb: "usb" in nav, serial: "serial" in nav, bluetooth: "bluetooth" in nav };
}

export const MODE_LABEL = {
  browser: "Navegador",
  usb: "Térmica USB",
  serial: "Térmica USB (puerto COM)",
  bluetooth: "Térmica Bluetooth",
};

// —— Conexión ——
let conn = null; // { write(bytes), close() }

function disconnect() {
  const c = conn;
  conn = null;
  printerStore.connected = false;
  if (c) c.close().catch(() => {});
}

function friendly(error) {
  const name = error?.name || "";
  if (name === "NotFoundError") return "No elegiste ninguna impresora.";
  if (name === "SecurityError") return "El navegador no dio permiso para usar la impresora.";
  if (name === "NetworkError") return "Se perdió la conexión con la impresora. Revisa que esté prendida y cerca.";
  if (name === "InvalidStateError") return "La impresora está ocupada por otra pestaña o programa.";
  return error?.message || "La impresora no respondió.";
}

const USB_BLOCKED =
  "No se pudo abrir la impresora por USB: Windows la tiene con su propio driver (o otro programa la está usando). Usa el modo «Puerto COM» o cierra el otro programa.";
/** El navegador no puede abrirla (driver de Windows u otro programa): se dice qué hacer en vez de «sin permiso». */
const usbBlocked = (e) => (e?.name === "SecurityError" || e?.name === "NetworkError" ? new Error(USB_BLOCKED) : e);

async function openUsb(prompt) {
  // Sin filtro: muchas térmicas genéricas no se anuncian como clase «impresora»
  const device = prompt ? await navigator.usb.requestDevice({ filters: [] }) : (await navigator.usb.getDevices())[0];
  if (!device) return null;
  try {
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
  } catch (e) {
    await device.close().catch(() => {});
    throw usbBlocked(e);
  }
  let target = null;
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (out && (!target || alt.interfaceClass === 7)) target = { iface, alt, out };
    }
  }
  if (!target) {
    await device.close().catch(() => {});
    throw new Error("Ese dispositivo USB no parece una impresora.");
  }
  try {
    await device.claimInterface(target.iface.interfaceNumber);
  } catch (e) {
    await device.close().catch(() => {});
    throw usbBlocked(e);
  }
  if (target.iface.alternates.length > 1) {
    await device.selectAlternateInterface(target.iface.interfaceNumber, target.alt.alternateSetting).catch(() => {});
  }
  return {
    name: device.productName || "Impresora USB",
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += 4096) {
        await device.transferOut(target.out.endpointNumber, bytes.slice(i, i + 4096));
      }
    },
    close: () => device.close(),
  };
}

const serialQueue = new WeakMap();

async function openSerial(prompt) {
  // Recordar el puerto de la impresora para no confundirlo con el de la báscula
  let port;
  if (prompt) {
    port = await navigator.serial.requestPort();
    savePrinterSettings({ portInfo: port.getInfo?.() || null });
  } else {
    const saved = printerStore.portInfo;
    const ports = await navigator.serial.getPorts();
    port = saved
      ? ports.find((p) => {
          const i = p.getInfo?.() || {};
          return i.usbVendorId === saved.usbVendorId && i.usbProductId === saved.usbProductId;
        })
      : ports.length === 1
        ? ports[0]
        : null;
  }
  if (!port) return null;
  if (!port.writable) await port.open({ baudRate: printerStore.baudRate || 9600 });
  const info = port.getInfo?.() || {};
  return {
    name: info.usbProductId ? `Puerto COM (USB ${info.usbVendorId?.toString(16)}:${info.usbProductId.toString(16)})` : "Puerto COM",
    // Un solo escritor a la vez: dos impresiones simultáneas dejaban el stream bloqueado
    write(bytes) {
      const run = async () => {
        const writer = port.writable.getWriter();
        try {
          await writer.write(bytes);
        } finally {
          try { writer.releaseLock(); } catch { /* escritura pendiente: se libera sola */ }
        }
      };
      const next = (serialQueue.get(port) || Promise.resolve()).then(run, run);
      serialQueue.set(port, next.catch(() => {}));
      return next;
    },
    close: async () => {
      // Si un envío quedó colgado, no se espera para siempre: se intenta cerrar igual
      await Promise.race([serialQueue.get(port) || Promise.resolve(), new Promise((r) => setTimeout(r, 2000))]);
      return port.close();
    },
  };
}

let btDevice = null;
async function openBluetooth(prompt) {
  let device = btDevice;
  if (!device && !prompt && navigator.bluetooth.getDevices) {
    device = (await navigator.bluetooth.getDevices()).find((d) => d.name === printerStore.deviceName) || null;
  }
  if (!device && prompt) {
    device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  }
  if (!device) return null;
  btDevice = device;
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  let ch = null;
  for (const uuid of BT_SERVICES) {
    let service;
    try {
      service = await server.getPrimaryService(uuid);
    } catch {
      continue;
    }
    for (const c of await service.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) {
        ch = c;
        break;
      }
    }
    if (ch) break;
  }
  if (!ch) {
    device.gatt.disconnect();
    throw new Error("Esa impresora Bluetooth no es compatible (no encontré por dónde mandarle el ticket).");
  }
  device.addEventListener("gattserverdisconnected", () => {
    if (conn?.bt === device) {
      conn = null;
      printerStore.connected = false;
      onLinkLost();
    }
  }, { once: true });
  return {
    bt: device,
    name: device.name || "Impresora Bluetooth",
    async write(bytes) {
      // BLE manda pocos bytes por paquete
      for (let i = 0; i < bytes.length; i += 180) {
        const chunk = bytes.slice(i, i + 180);
        if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk);
        else await ch.writeValue(chunk);
      }
    },
    async close() {
      device.gatt.disconnect();
    },
  };
}

const CONNECT_TIMEOUT_MS = 12000;
const PICK_TIMEOUT_MS = 120000; // al elegir impresora, el selector del navegador espera a la persona
let connecting = null; // intento en curso (varios llamados comparten uno solo: abrir el mismo dispositivo dos veces lo deja colgado)
let current = null;

async function openPrinter(prompt, ctl) {
  const mode = printerStore.mode;
  const support = printerSupport();
  if (mode === "browser") throw new Error("La impresión directa está apagada.");
  if (!support[mode]) {
    throw new Error(`Este navegador no puede usar «${MODE_LABEL[mode]}». Usa Chrome o Edge.`);
  }
  try {
    const opened =
      mode === "usb" ? await openUsb(prompt) : mode === "serial" ? await openSerial(prompt) : await openBluetooth(prompt);
    if (ctl.dead) {
      // Llegó tarde (se agotó el tiempo o se eligió otra): se suelta para que no bloquee el siguiente intento
      opened?.close().catch(() => {});
      throw new Error("Conexión cancelada.");
    }
    if (!opened) throw new Error("No hay impresora conectada. Conéctala en el menú Más → Impresora.");
    conn = opened;
    printerStore.connected = true;
    printerStore.lost = false;
    printerStore.error = "";
    if (prompt) savePrinterSettings({ deviceName: opened.name });
    return conn;
  } catch (error) {
    if (!ctl.dead) printerStore.connected = false;
    throw new Error(friendly(error));
  }
}

/**
 * Conecta con la impresora del modo elegido.
 * prompt=true abre el selector del navegador (solo desde un clic) y suelta antes la que estaba conectada; false reusa la que ya tiene permiso.
 * Nunca se queda esperando para siempre: si el dispositivo no responde, falla con un aviso y se puede volver a intentar.
 */
export function connectPrinter({ prompt = false } = {}) {
  if (prompt) {
    if (current) current.dead = true; // elegir otra cancela cualquier intento pendiente
    connecting = null;
    if (conn) disconnect();
  }
  if (conn) return Promise.resolve(conn);
  if (connecting) return connecting;
  const ctl = { dead: false };
  current = ctl;
  const guarded = withTimeout(openPrinter(prompt, ctl), prompt ? PICK_TIMEOUT_MS : CONNECT_TIMEOUT_MS, "No se pudo abrir la impresora a tiempo. Revisa que esté prendida, conectada y que otro programa no la esté usando.")
    .catch((error) => {
      ctl.dead = true;
      throw error;
    })
    .finally(() => {
      if (connecting === guarded) connecting = null;
    });
  connecting = guarded;
  return guarded;
}

// —— Mantener la conexión ——
// Los navegadores sueltan la impresora (cable, reinicio, ahorro de energía, pantalla apagada): se detecta y se reconecta sola.
const RETRY_MS = [1500, 4000, 8000, 15000, 30000, 30000, 60000];
let retryTimer = null;
let retryCount = 0;
let watching = false;

/** Intenta conectar con la impresora que ya tiene permiso (sin abrir el selector). true si quedó conectada. */
export async function reconnectPrinter() {
  if (!directPrinting()) return false;
  if (conn) return true;
  if (printerStore.busy) return false;
  printerStore.trying = true;
  try {
    await connectPrinter({ prompt: false });
    return true;
  } catch (error) {
    printerStore.lost = true;
    printerStore.error = error.message; // se muestra en Configuración para saber por qué no conecta
    return false;
  } finally {
    printerStore.trying = false;
  }
}

function scheduleReconnect(fresh = true) {
  clearTimeout(retryTimer);
  if (fresh) retryCount = 0;
  if (!directPrinting() || conn || retryCount >= RETRY_MS.length) return;
  retryTimer = setTimeout(async () => {
    if (await reconnectPrinter()) return;
    retryCount += 1;
    scheduleReconnect(false);
  }, RETRY_MS[retryCount]);
}

function onLinkLost() {
  if (!directPrinting()) return;
  printerStore.lost = true;
  scheduleReconnect();
}

/** Se llama al abrir la pantalla de ventas: conecta ya, y vigila desconexiones y regresos a la app. Solo se instala una vez. */
export function startPrinterWatch() {
  if (directPrinting()) reconnectPrinter().then((ok) => !ok && scheduleReconnect());
  if (watching || typeof navigator === "undefined") return;
  watching = true;
  const dropped = () => {
    if (!conn) return;
    const c = conn;
    conn = null;
    printerStore.connected = false;
    c.close().catch(() => {});
    onLinkLost();
  };
  const plugged = () => scheduleReconnect();
  for (const kind of ["usb", "serial"]) {
    if (!(kind in navigator)) continue;
    navigator[kind].addEventListener("disconnect", dropped);
    navigator[kind].addEventListener("connect", plugged);
  }
  const back = () => {
    if (document.visibilityState === "visible" && directPrinting() && !conn) scheduleReconnect();
  };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
  window.addEventListener("online", back);
}

function withTimeout(promise, ms, message = "La impresora no respondió a tiempo. Revisa que esté prendida y con papel.") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Manda bytes a la impresora; si la conexión se cayó, reconecta una vez. */
export async function printBytes(bytes, { prompt = false, timeoutMs = PRINT_TIMEOUT_MS } = {}) {
  printerStore.busy = true;
  try {
    await withTimeout(
      (async () => {
        try {
          await (await connectPrinter({ prompt })).write(bytes);
        } catch (first) {
          if (!conn) throw first;
          disconnect();
          await (await connectPrinter({ prompt: false })).write(bytes);
        }
      })(),
      timeoutMs
    );
  } catch (error) {
    disconnect();
    onLinkLost();
    throw new Error(friendly(error));
  } finally {
    printerStore.busy = false;
  }
}

// 80 mm = 42 columnas en la TM-T88V (58 mm = 32)
function cols() {
  return printerStore.paper === "58" ? 32 : 42;
}

export function printTestPage({ prompt = false } = {}) {
  return printBytes(buildTestPage({ cols: cols(), shop: venueStore.businessName || "MiRestaurante", openDrawer: printerStore.drawer }), {
    prompt,
  });
}

/** Abre el cajón de dinero (pulso), sin imprimir nada. */
export function openCashDrawer() {
  return printBytes(new EscPos({ cols: cols() }).init().drawer().build());
}

export const paperCols = cols;

/** Ancho en puntos de la imagen del ticket: 384 en 58 mm; en 80 mm, el útil de la impresora (512 o 576). */
/** Punto de corte a blanco y negro: más alto = trazos más llenos y oscuros. */
export const inkThreshold = () => ({ light: 160, normal: 190, dark: 215 })[printerStore.ink] || 190;

export const paperDots = () => (printerStore.paper === "58" ? 384 : printerStore.dots80);
