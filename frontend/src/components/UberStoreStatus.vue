<template>
  <div v-if="s.linked" class="us" role="status">
    <p class="us-line">
      <strong>Uber Eats</strong>
      <span class="us-pill" :class="tone">{{ label }}</span>
      <button v-if="canResume" type="button" class="us-btn" :disabled="busy" @click="change('ONLINE')">Reanudar</button>
      <template v-else-if="isOnline">
        <select v-model.number="minutes" class="us-select" aria-label="Cuánto tiempo pausar">
          <option v-for="o in OPTIONS" :key="o.v" :value="o.v">{{ o.t }}</option>
        </select>
        <button type="button" class="us-btn" :disabled="busy" @click="change('PAUSED')">Pausar tienda</button>
      </template>
    </p>
    <label v-if="showAuto" class="us-auto">
      <input type="checkbox" :checked="s.autoPause" :disabled="busy" @change="toggleAuto($event.target.checked)" />
      Pausar la tienda al cerrar la caja y reanudarla al abrirla
    </label>
    <p v-if="err" class="us-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { apiService } from "../apiService";

const props = defineProps({
  showAuto: Boolean, // muestra el ajuste de pausa automática (solo en Ajustes)
  refreshKey: { type: [Boolean, Number, String], default: 0 }, // cambia cuando abre o cierra la caja
});

const OPTIONS = [
  { v: 30, t: "30 min" },
  { v: 60, t: "1 hora" },
  { v: 120, t: "2 horas" },
  { v: 0, t: "Hasta reanudar" },
];
const REASONS = {
  OUT_OF_MENU_HOURS: "Fuera de horario",
  INVISIBLE: "No visible",
  PAUSED_BY_UBER: "Pausada por Uber",
  PAUSED_BY_RESTAURANT: "Pausada",
};

const s = reactive({ linked: false, status: null, offlineReason: null, autoPause: true, error: "" });
const busy = ref(false);
const err = ref("");
const minutes = ref(60);

const isOnline = computed(() => String(s.status || "").toUpperCase() === "ONLINE");
// Solo se reanuda lo que pausó el restaurante; el horario y las pausas de Uber no se tocan desde aquí
const canResume = computed(() => !s.error && !isOnline.value && (s.status === "PAUSED" || s.offlineReason === "PAUSED_BY_RESTAURANT"));
const label = computed(() => {
  if (s.error) return "Sin conexión";
  if (isOnline.value) return "En línea";
  return REASONS[s.offlineReason] || (s.status === "PAUSED" ? "Pausada" : "Fuera de línea");
});
const tone = computed(() => (s.error ? "warn" : isOnline.value ? "ok" : "off"));

async function refresh() {
  try {
    Object.assign(s, { error: "", status: null, offlineReason: null }, await apiService.uberStoreStatus());
  } catch {
    Object.assign(s, { linked: false });
  }
}

async function change(status) {
  busy.value = true;
  err.value = "";
  try {
    await apiService.uberSetStoreStatus(status, status === "PAUSED" && minutes.value ? minutes.value : undefined);
    await refresh();
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo cambiar el estado.";
  } finally {
    busy.value = false;
  }
}

async function toggleAuto(value) {
  busy.value = true;
  err.value = "";
  try {
    await apiService.uberSetAutoPause(value);
    s.autoPause = value;
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo guardar el ajuste.";
  } finally {
    busy.value = false;
  }
}

// Al abrir o cerrar la caja el servidor pausa o reanuda la tienda sin esperar: se vuelve a leer poco después
watch(() => props.refreshKey, () => setTimeout(refresh, 1500));
onMounted(refresh);
</script>

<style scoped>
.us { display: grid; gap: 0.4rem; padding: 0.6rem 0.8rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.us-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0; font-size: 0.9rem; }
.us-pill { padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
.us-pill.ok { background: var(--mirestaurante-success-soft); color: var(--mirestaurante-success); }
.us-pill.off { background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); }
.us-pill.warn { background: var(--mirestaurante-warning-soft); color: var(--mirestaurante-warning); }
.us-select { min-height: 2rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; }
.us-btn { min-height: 2rem; padding: 0 0.8rem; border-radius: 0.5rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.us-auto { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--mirestaurante-muted); }
.us-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
</style>
