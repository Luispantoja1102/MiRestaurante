<template>
  <section>
    <div class="toolbar">
      <select v-model.number="days" aria-label="Periodo" @change="load">
        <option :value="7">Últimos 7 días</option>
        <option :value="30">Últimos 30 días</option>
      </select>
      <span v-if="d" class="sub">
        {{ d.totals.received }} pedidos · {{ d.totals.accepted }} aceptados · {{ d.totals.denied }} rechazados · {{ d.totals.missed }} perdidos ·
        tasa <strong>{{ pct(d.totals.rate) }}</strong> (Uber pide 99.9 %, el mínimo es 99 %)
      </span>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err">{{ err }}</p>
    <template v-else-if="d">
      <h3 class="h">Por negocio (los que van peor, primero)</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Negocio</th><th>Tienda</th><th>Recibidos</th><th>Aceptados</th><th>Rechazados</th><th>Perdidos</th><th>Tasa</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in d.tenants" :key="t.tenantId">
              <td><strong>{{ t.name }}</strong></td>
              <td class="sub">{{ t.storeId }}</td>
              <td>{{ t.received }}</td>
              <td>{{ t.accepted }}</td>
              <td>{{ t.denied }}</td>
              <td>{{ t.missed }}</td>
              <td><span class="pill" :class="tone(t.rate)">{{ pct(t.rate) }}</span></td>
            </tr>
            <tr v-if="!d.tenants.length"><td colspan="7" class="muted">Ningún negocio ha vinculado su tienda de Uber Eats.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 class="h">Avisos y errores recientes</h3>
      <label class="check"><input v-model="onlyErrors" type="checkbox" /> Solo errores</label>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Cuándo</th><th>Evento</th><th>Negocio</th><th>Resultado</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in events" :key="i">
              <td>{{ fmtDateTime(e.at) }}</td>
              <td>{{ e.eventType }}<div v-if="e.orderId" class="sub">{{ e.orderId }}</div></td>
              <td>{{ e.tenant || "—" }}</td>
              <td><span class="pill" :class="e.outcome === 'error' ? 'bad' : e.outcome === 'ok' ? 'ok' : ''">{{ outcomeText[e.outcome] || e.outcome }}</span></td>
              <td class="sub">{{ e.detail }}</td>
            </tr>
            <tr v-if="!events.length"><td colspan="5" class="muted">Sin avisos todavía.</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { errorText, fmtDateTime } from "./format";

const days = ref(7);
const d = ref(null);
const loading = ref(true);
const err = ref("");
const onlyErrors = ref(false);
const outcomeText = { ok: "Atendido", ignored: "Ignorado", error: "Error" };

const events = computed(() => (d.value?.events || []).filter((e) => !onlyErrors.value || e.outcome === "error"));
const pct = (r) => (r == null ? "—" : `${(r * 100).toFixed(1)} %`);
const tone = (r) => (r == null ? "" : r >= 0.999 ? "ok" : r >= 0.99 ? "warn" : "bad");

async function load() {
  loading.value = true;
  err.value = "";
  try {
    d.value = await apiService.platformUber(days.value);
  } catch (e) {
    err.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.h { margin: 1.1rem 0 0.4rem; font-size: 1rem; }
.check { display: inline-flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; font-size: 0.9rem; }
.pill.ok { background: var(--mirestaurante-success-soft); color: var(--mirestaurante-success); }
.pill.warn { background: var(--mirestaurante-warning-soft); color: var(--mirestaurante-warning); }
.pill.bad { background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); }
</style>
