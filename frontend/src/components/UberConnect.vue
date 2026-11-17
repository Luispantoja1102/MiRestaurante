<template>
  <div class="uc">
    <p v-if="uber.deprovisioned" class="uc-warn" role="alert">
      Uber Eats retiró el acceso de MiRestaurante a esta tienda: ya no llegan pedidos. Vuelve a conectarla.
    </p>

    <div v-if="uber.storeId && uber.linkedVia === 'oauth' && !uber.deprovisioned" class="uc-line">
      <span class="uc-pill" :class="uber.integrationEnabled === false ? 'wait' : 'ok'">
        {{ uber.integrationEnabled === false ? "Conectada, falta que Uber la encienda" : "Conectada" }}
      </span>
      <span class="uc-sub" v-if="uber.storeAddress">{{ uber.storeAddress }}</span>
    </div>
    <p v-if="uber.integrationEnabled === false && !uber.deprovisioned" class="uc-hint">
      Uber enciende la recepción de pedidos de cada tienda junto con tu gerente de socio el día del lanzamiento.
    </p>

    <template v-if="uber.oauth">
      <button type="button" class="uc-btn" :disabled="busy" @click="connect">
        {{ uber.storeId && uber.linkedVia === "oauth" && !uber.deprovisioned ? "Conectar otra tienda" : "Conectar con Uber Eats" }}
      </button>
      <p class="uc-hint">
        Te llevamos a Uber para que autorices a MiRestaurante. Al terminar, <strong>MiRestaurante recibe y acepta los pedidos</strong>
        de esa tienda en lugar de la tableta de Uber Eats.
      </p>
    </template>
    <p v-else-if="uber.configured" class="uc-hint">La conexión directa con Uber no está configurada en el servidor: vincula tu tienda con el Store ID.</p>

    <template v-if="uber.storeId && uber.linkedVia === 'oauth'">
      <button type="button" class="uc-link" :disabled="busy" @click="removeAll">Quitar la tienda por completo en Uber Eats</button>
      <p class="uc-hint">«Desvincular» solo apaga la integración. Esta opción te lleva a Uber para confirmar y MiRestaurante deja de ser su encargado de pedidos.</p>
    </template>

    <div v-if="stores.length" class="uc-pick" role="group" aria-label="Elige tu tienda">
      <strong>Tu cuenta de Uber tiene varias tiendas. ¿Cuál es esta?</strong>
      <label v-for="s in stores" :key="s.storeId" class="uc-store">
        <input v-model="picked" type="radio" name="uber-store" :value="s.storeId" />
        <span><strong>{{ s.name }}</strong><small v-if="s.address"> · {{ s.address }}</small></span>
      </label>
      <button type="button" class="uc-btn" :disabled="busy || !picked" @click="activate">Activar esta tienda</button>
    </div>

    <p v-if="err" class="uc-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import { apiService } from "../apiService";

const props = defineProps({ uber: { type: Object, required: true }, choose: Boolean });
const emit = defineEmits(["changed", "message"]);

const stores = ref([]);
const picked = ref("");
const busy = ref(false);
const err = ref("");
const text = (e, fallback) => (typeof e.response?.data === "string" && e.response.data) || e.response?.data?.message || fallback;

async function loadPending() {
  try {
    stores.value = (await apiService.uberPending()).stores || [];
    picked.value = stores.value[0]?.storeId || "";
  } catch {
    stores.value = [];
  }
}

async function connect() {
  if (!confirm("Al conectar, MiRestaurante pasa a recibir y aceptar los pedidos de esa tienda en lugar de la tableta de Uber Eats. ¿Continuar?")) return;
  busy.value = true;
  err.value = "";
  try {
    window.location.href = (await apiService.uberConnect()).url;
  } catch (e) {
    err.value = text(e, "No se pudo iniciar la conexión con Uber Eats.");
    busy.value = false;
  }
}

async function removeAll() {
  if (!confirm("Te llevamos a Uber para confirmar. La tienda se quitará por completo de MiRestaurante en Uber Eats. ¿Continuar?")) return;
  busy.value = true;
  err.value = "";
  try {
    window.location.href = (await apiService.uberRemove()).url;
  } catch (e) {
    err.value = text(e, "No se pudo iniciar el proceso.");
    busy.value = false;
  }
}

async function activate() {
  busy.value = true;
  err.value = "";
  try {
    await apiService.uberActivate(picked.value);
    stores.value = [];
    emit("message", "Tienda de Uber Eats conectada.");
    emit("changed");
  } catch (e) {
    err.value = text(e, "No se pudo activar la tienda.");
    if (e.response?.status === 400) stores.value = []; // la autorización caducó: hay que conectar de nuevo
  } finally {
    busy.value = false;
  }
}

watch(() => props.choose, (v) => v && loadPending());
onMounted(() => props.choose && loadPending());
</script>

<style scoped>
.uc { display: grid; gap: 0.5rem; }
.uc-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.uc-pill { padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
.uc-pill.ok { background: var(--mirestaurante-success-soft); color: var(--mirestaurante-success); }
.uc-pill.wait { background: var(--mirestaurante-warning-soft); color: var(--mirestaurante-warning); }
.uc-sub { font-size: 0.85rem; color: var(--mirestaurante-muted); }
.uc-hint { margin: 0; font-size: 0.82rem; color: var(--mirestaurante-muted); }
.uc-warn { margin: 0; padding: 0.55rem 0.75rem; border-radius: 0.6rem; background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); font-size: 0.9rem; }
.uc-link { justify-self: start; background: none; border: none; padding: 0; color: var(--mirestaurante-danger); font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }
.uc-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
.uc-btn { justify-self: start; min-height: 2.4rem; padding: 0 1rem; border-radius: 0.6rem; border: 1.5px solid var(--mirestaurante-primary); background: var(--mirestaurante-primary); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.uc-btn:disabled { opacity: 0.6; cursor: default; }
.uc-pick { display: grid; gap: 0.4rem; padding: 0.7rem 0.9rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.uc-store { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
.uc-store small { color: var(--mirestaurante-muted); }
</style>
