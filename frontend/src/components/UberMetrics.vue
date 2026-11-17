<template>
  <div class="um">
    <div class="um-head">
      <strong>Tasa de aceptación</strong>
      <select v-model.number="days" aria-label="Periodo" @change="load">
        <option :value="7">Últimos 7 días</option>
        <option :value="30">Últimos 30 días</option>
      </select>
    </div>
    <p class="um-rate" :class="tone">{{ rateText }}</p>
    <p class="um-sub">
      Aceptados {{ m.accepted }} · rechazados {{ m.denied }} · perdidos {{ m.missed }} · por responder {{ m.pending }}
    </p>
    <p class="um-hint">
      Uber mide cuántos pedidos aceptas y pide 99.9 %; por debajo de 99 % puede quitar el acceso o desactivar tiendas. Un pedido
      «perdido» es el que Uber canceló porque nadie lo aceptó a tiempo.
    </p>
    <ul v-if="m.missedOrders.length" class="um-list">
      <li v-for="o in m.missedOrders" :key="o.id">#{{ o.displayId }} · {{ when(o.receivedAt) }} · {{ o.reason }}</li>
    </ul>
    <div class="um-actions">
      <button type="button" class="um-btn" :disabled="busy" @click="reconcile">{{ busy ? "Buscando…" : "Buscar pedidos perdidos" }}</button>
      <span v-if="msg" class="um-msg" role="status">{{ msg }}</span>
    </div>
    <p v-if="err" class="um-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { apiService } from "../apiService";

const days = ref(7);
const m = reactive({ accepted: 0, denied: 0, missed: 0, pending: 0, rate: null, missedOrders: [] });
const busy = ref(false);
const msg = ref("");
const err = ref("");

const rateText = computed(() => (m.rate == null ? "Sin pedidos todavía" : `${(m.rate * 100).toFixed(1)} %`));
const tone = computed(() => (m.rate == null ? "none" : m.rate >= 0.999 ? "ok" : m.rate >= 0.99 ? "warn" : "bad"));
const when = (d) => new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function load() {
  try {
    Object.assign(m, { missedOrders: [] }, await apiService.uberMetrics(days.value));
  } catch {
    err.value = "No se pudo calcular la tasa.";
  }
}

async function reconcile() {
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    const r = await apiService.uberReconcile();
    msg.value = r.recovered || r.closed ? `Se recuperaron ${r.recovered} pedido(s) y se cerraron ${r.closed}.` : "No faltaba ningún pedido.";
    await load();
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo consultar a Uber Eats.";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.um { display: grid; gap: 0.4rem; padding: 0.7rem 0.9rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.um-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.um-head select { min-height: 2rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; }
.um-rate { margin: 0; font-size: 1.8rem; font-weight: 800; }
.um-rate.ok { color: var(--mirestaurante-success); }
.um-rate.warn { color: var(--mirestaurante-warning); }
.um-rate.bad { color: var(--mirestaurante-danger); }
.um-rate.none { font-size: 1.1rem; color: var(--mirestaurante-muted); }
.um-sub { margin: 0; font-size: 0.9rem; }
.um-hint { margin: 0; font-size: 0.8rem; color: var(--mirestaurante-muted); }
.um-list { margin: 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--mirestaurante-danger); }
.um-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
.um-btn { min-height: 2rem; padding: 0 0.8rem; border-radius: 0.5rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.um-msg { font-size: 0.85rem; color: var(--mirestaurante-muted); }
.um-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
</style>
