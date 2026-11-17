<template>
  <AppShell>
    <div class="printer-page">
      <h1>Impresora</h1>
      <p class="lead">
        Se configura en cada dispositivo. Con una térmica conectada, las cuentas, comandas y cortes de caja salen directo, sin el diálogo del
        navegador.
      </p>

      <section class="card">
        <label class="field">¿Cómo imprime este dispositivo?
          <select :value="p.mode" @change="setMode($event.target.value)">
            <option v-for="(label, id) in MODE_LABEL" :key="id" :value="id">{{ label }}</option>
          </select>
        </label>
        <p v-if="direct && !support[p.mode]" class="warn" role="alert">
          Este navegador no puede usar «{{ MODE_LABEL[p.mode] }}». Usa Chrome o Edge (en computadora o en Android).
        </p>
        <p class="hint">{{ HINT[p.mode] }}</p>

        <template v-if="direct">
          <label class="field">Ancho del papel
            <select :value="p.paper" @change="save({ paper: $event.target.value })">
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
            </select>
          </label>
          <label v-if="p.mode === 'serial'" class="field">Velocidad del puerto COM
            <select :value="p.baudRate" @change="save({ baudRate: Number($event.target.value) })">
              <option v-for="b in [9600, 19200, 38400, 57600, 115200]" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" :checked="p.autoPrint" @change="save({ autoPrint: $event.target.checked })" /> Imprimir el ticket al cobrar</label>
          <label class="check"><input type="checkbox" :checked="p.drawer" @change="save({ drawer: $event.target.checked })" /> Abrir el cajón de dinero al cobrar en efectivo</label>

          <div class="status" role="status">
            <span class="dot" :class="p.connected ? 'on' : p.lost ? 'lost' : 'off'" aria-hidden="true"></span>
            <span v-if="p.connected">Conectada{{ p.deviceName ? `: ${p.deviceName}` : "" }}</span>
            <span v-else-if="p.trying">Reconectando…</span>
            <span v-else-if="p.lost">Sin conexión con la impresora. Se reintenta sola.</span>
            <span v-else>Sin conectar. Elige tu impresora.</span>
          </div>
          <p v-if="p.error && !p.connected" class="warn">{{ p.error }}</p>

          <div class="actions">
            <button type="button" class="btn-primary" :disabled="busy || !support[p.mode]" @click="pick">Elegir impresora</button>
            <button type="button" :disabled="busy || !p.connected" @click="test">Imprimir prueba</button>
            <button type="button" :disabled="busy || !p.connected" @click="drawer">Abrir cajón</button>
          </div>
        </template>
        <p v-if="msg" class="ok" role="status">{{ msg }}</p>
        <p v-if="err" class="warn" role="alert">{{ err }}</p>
      </section>
    </div>
  </AppShell>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import AppShell from "../components/AppShell.vue";
import {
  MODE_LABEL,
  connectPrinter,
  directPrinting,
  openCashDrawer,
  printTestPage,
  printerStore,
  printerSupport,
  reconnectPrinter,
  savePrinterSettings,
} from "../thermalPrinter";

const p = printerStore;
const support = printerSupport();
const direct = computed(() => directPrinting());
const busy = ref(false);
const msg = ref("");
const err = ref("");

const HINT = {
  browser: "Abre la vista del ticket y el diálogo de imprimir del navegador. Sirve con cualquier impresora.",
  usb: "Sale directo, sin diálogo. En Windows solo abre si la impresora usa el driver WinUSB; si no abre, usa «puerto COM». Chrome en computadora o en Android (con cable OTG).",
  serial: "Sale directo, sin diálogo. Para impresoras USB que Windows muestra como puerto COM. Chrome o Edge en computadora.",
  bluetooth: "Sale directo, sin diálogo. Chrome en Android o en computadora con Bluetooth.",
};

function save(patch) {
  savePrinterSettings(patch);
}

async function run(job, ok) {
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    await job();
    if (ok) msg.value = ok;
  } catch (e) {
    err.value = e?.message || "La impresora no respondió.";
  } finally {
    busy.value = false;
  }
}

function setMode(mode) {
  savePrinterSettings({ mode });
  msg.value = "";
  err.value = "";
  if (directPrinting()) reconnectPrinter();
}

const pick = () => run(() => connectPrinter({ prompt: true }), "Impresora conectada.");
const test = () => run(() => printTestPage(), "Se mandó la página de prueba.");
const drawer = () => run(() => openCashDrawer(), "Se mandó el pulso al cajón.");

onMounted(() => {
  if (directPrinting() && !p.connected) reconnectPrinter();
});
</script>

<style scoped>
.printer-page { max-width: 38rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.8rem; }
h1 { margin: 0; font-size: 1.4rem; }
.lead { margin: 0; color: var(--mirestaurante-muted); font-size: 0.92rem; }
.card { display: grid; gap: 0.8rem; padding: 1rem; border: 1px solid var(--mirestaurante-line); border-radius: 1rem; background: var(--mirestaurante-panel); }
.field { display: grid; gap: 0.3rem; font-weight: 600; font-size: 0.9rem; }
.field select { min-height: 2.5rem; border-radius: 0.6rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); font: inherit; padding: 0 0.6rem; }
.check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.92rem; }
.hint { margin: 0; font-size: 0.82rem; color: var(--mirestaurante-muted); }
.warn { margin: 0; font-size: 0.88rem; color: var(--mirestaurante-danger); }
.ok { margin: 0; font-size: 0.88rem; color: var(--mirestaurante-success); }
.status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.92rem; font-weight: 600; }
.dot { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--mirestaurante-muted); }
.dot.on { background: var(--mirestaurante-success); }
.dot.lost { background: var(--mirestaurante-warning); }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.actions button { min-height: 2.5rem; padding: 0 1rem; border-radius: 0.6rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.actions button:disabled { opacity: 0.55; cursor: default; }
.actions .btn-primary { background: var(--mirestaurante-primary); border-color: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary, #fff); }
</style>
