<template>
  <div class="up">
    <strong>Precios en Uber Eats</strong>
    <p class="up-hint">
      Uber se queda una parte de cada venta. Si activas esto, tu menú sale en Uber Eats con el precio un poco más alto para que a ti te
      quede lo mismo que vendiendo en tu local. En tu local no cambia nada.
    </p>

    <label class="up-check">
      <input v-model="form.enabled" type="checkbox" :disabled="busy" />
      Subir los precios en Uber Eats para conservar mi ganancia
    </label>

    <template v-if="form.enabled">
      <div class="up-plans" role="group" aria-label="Plan de Uber Eats">
        <button v-for="(p, id) in plans" :key="id" type="button" :aria-pressed="form.plan === id" :disabled="busy" @click="pickPlan(id)">
          <strong>{{ p.label }}</strong>
          <small>{{ p.commissionPct != null ? `${p.commissionPct}%` : "Escribe la tuya" }}</small>
        </button>
      </div>

      <div class="up-row">
        <label v-if="form.plan === 'custom'">Comisión (%)
          <input v-model.number="form.commissionPct" type="number" min="0" max="50" step="0.5" inputmode="decimal" />
        </label>
        <label>Marketing en Uber (%) <em>(si lo contratas)</em>
          <input v-model.number="form.marketingPct" type="number" min="0" max="30" step="0.5" inputmode="decimal" />
        </label>
        <label>Redondear hacia arriba
          <select v-model.number="form.rounding">
            <option :value="1">Al peso</option>
            <option :value="5">A 5 pesos</option>
            <option :value="10">A 10 pesos</option>
            <option :value="0">No redondear</option>
          </select>
        </label>
      </div>

      <p class="up-cut">
        Uber se queda cerca del <strong>{{ cutPct }}%</strong> de cada venta (la comisión más el 16% de IVA que cobra sobre ella<template v-if="form.marketingPct > 0">, más el marketing</template>).
      </p>

      <div v-if="rows.length" class="up-table" role="table" aria-label="Precios en el local y en Uber">
        <div class="up-head" role="row"><span>Platillo</span><span>En tu local</span><span>En Uber</span><span>Te quedan</span></div>
        <div v-for="r in rows" :key="r.id" class="up-rowline" role="row">
          <span class="up-name">{{ r.name }}</span><span>{{ money(r.local) }}</span><b>{{ money(r.uber) }}</b><span>{{ money(r.net) }}</span>
        </div>
      </div>
      <p v-else class="up-hint">Todavía no tienes platillos para mostrar la comparación.</p>
    </template>

    <div class="up-actions">
      <button type="button" class="up-btn" :disabled="busy || !dirty" @click="save">{{ busy ? "Guardando…" : "Guardar precios" }}</button>
      <span v-if="msg" class="up-msg" role="status">{{ msg }}</span>
    </div>
    <p v-if="err" class="up-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { apiService } from "../apiService";

const form = reactive({ enabled: false, plan: "plus", commissionPct: 27, marketingPct: 0, rounding: 1 });
const saved = ref("");
const plans = ref({});
const rows = ref([]);
const cutPct = ref(0);
const busy = ref(false);
const msg = ref("");
const err = ref("");

const money = (n) => Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const snapshot = () => JSON.stringify([form.enabled, form.plan, Number(form.commissionPct), Number(form.marketingPct), form.rounding]);
const dirty = computed(() => snapshot() !== saved.value);

function apply(data) {
  Object.assign(form, data.pricing);
  plans.value = data.plans;
  rows.value = data.rows;
  cutPct.value = data.cutPct;
  saved.value = snapshot();
}

async function load() {
  try {
    apply(await apiService.uberPricing());
  } catch {
    err.value = "No se pudo leer la configuración de precios.";
  }
}

function pickPlan(id) {
  form.plan = id;
  if (plans.value[id]?.commissionPct != null) form.commissionPct = plans.value[id].commissionPct;
}

// La comparación se recalcula mientras se escribe (sin guardar nada)
let timer = null;
watch(
  () => [form.plan, form.commissionPct, form.marketingPct, form.rounding],
  () => {
    if (!form.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const p = await apiService.uberPricing({ plan: form.plan, commissionPct: Number(form.commissionPct), marketingPct: Number(form.marketingPct) || 0, rounding: form.rounding });
        rows.value = p.rows;
        cutPct.value = p.cutPct;
        err.value = "";
      } catch (e) {
        err.value = (typeof e.response?.data === "string" && e.response.data) || "Revisa los porcentajes.";
      }
    }, 250);
  }
);

async function save() {
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    apply(await apiService.uberSetPricing({ enabled: form.enabled, plan: form.plan, commissionPct: Number(form.commissionPct), marketingPct: Number(form.marketingPct) || 0, rounding: form.rounding }));
    msg.value = form.enabled ? "Guardado. El menú se actualiza en Uber Eats con los precios nuevos." : "Guardado: el menú sale con tus precios normales.";
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo guardar.";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.up { display: grid; gap: 0.55rem; padding: 0.7rem 0.9rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.up-hint { margin: 0; font-size: 0.8rem; color: var(--mirestaurante-muted); }
.up-check { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.9rem; font-weight: 600; }
.up-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr)); gap: 0.5rem; }
.up-plans button { display: grid; gap: 0.1rem; justify-items: center; padding: 0.55rem 0.4rem; border-radius: 0.7rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; cursor: pointer; }
.up-plans button small { color: var(--mirestaurante-muted); font-size: 0.78rem; }
.up-plans button[aria-pressed="true"] { border-color: var(--mirestaurante-primary); background: var(--mirestaurante-primary-soft); }
.up-row { display: flex; flex-wrap: wrap; gap: 0.7rem; font-size: 0.88rem; }
.up-row label { display: grid; gap: 0.25rem; min-width: 9rem; flex: 1 1 9rem; font-weight: 600; }
.up-row em { font-weight: 500; font-style: normal; color: var(--mirestaurante-muted); }
.up-row input, .up-row select { min-height: 2.3rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; padding: 0 0.5rem; }
.up-cut { margin: 0; font-size: 0.88rem; }
.up-table { display: grid; font-size: 0.85rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.7rem; overflow: hidden; }
.up-head, .up-rowline { display: grid; grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)); gap: 0.4rem; padding: 0.4rem 0.6rem; align-items: baseline; }
.up-head { background: var(--mirestaurante-surface); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mirestaurante-muted); }
.up-rowline + .up-rowline { border-top: 1px solid var(--mirestaurante-line); }
.up-rowline > :not(.up-name) { text-align: right; font-variant-numeric: tabular-nums; }
.up-head > :not(:first-child) { text-align: right; }
.up-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
.up-btn { min-height: 2rem; padding: 0 0.9rem; border-radius: 0.5rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.up-btn:not(:disabled) { border-color: var(--mirestaurante-primary); background: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary, #fff); }
.up-btn:disabled { opacity: 0.55; cursor: default; }
.up-msg { font-size: 0.85rem; color: var(--mirestaurante-muted); }
.up-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
</style>
