<template>
  <div class="mn">
    <strong>Menú en Uber Eats</strong>
    <p v-if="m.published" class="mn-line">
      Publicado el {{ when(m.publishedAt) }} · {{ m.items }} productos y extras · de {{ m.hours.open }} a {{ m.hours.close }}
    </p>
    <p v-else class="mn-line mn-warn">Aún no has publicado tu menú: Uber Eats no sabe qué vendes.</p>

    <!-- Que no se publique por descuido con los precios del local: Uber se quedaría su comisión de tu ganancia -->
    <p v-if="m.pricing.enabled" class="mn-line mn-ok">
      ✓ Precios ajustados al plan {{ m.pricing.label }}: Uber se queda cerca del {{ m.pricing.cutPct }}% y a ti te queda lo mismo que en tu local.
    </p>
    <p v-else class="mn-line mn-warn">
      ⚠ Tus precios en Uber Eats NO están ajustados: el menú saldría con los precios de tu local y Uber se quedaría su comisión de tu ganancia.
      Actívalos arriba, en «Precios en Uber Eats».
    </p>

    <p v-if="m.published && m.dirty" class="mn-line mn-warn">Hay cambios en tus productos que todavía no están en Uber Eats.</p>

    <div class="mn-row">
      <label>Disponible desde <input v-model="open" type="time" required /></label>
      <label>hasta <input v-model="close" type="time" required /></label>
    </div>
    <p class="mn-hint">
      Publicar <strong>reemplaza todo el menú</strong> que tengas en Uber Eats por el de MiRestaurante ({{ m.foods }} productos). Después, un
      producto se marca agotado solo cuando se acaba un ingrediente de su receta, y vuelve a estar disponible al reponerlo.
    </p>
    <label v-if="m.published" class="mn-auto">
      <input type="checkbox" :checked="m.autoPublish" :disabled="busy" @change="toggleAuto($event.target.checked)" />
      Actualizar el menú en Uber Eats solo cuando cambie un producto, categoría, precio o receta
    </label>
    <p v-if="m.outOfStock.length" class="mn-out">Agotados ahora: {{ m.outOfStock.join(", ") }}</p>

    <div class="mn-actions">
      <button type="button" class="mn-btn" :disabled="busy || !m.foods" @click="publish">
        {{ busy ? "Publicando…" : m.published ? "Publicar de nuevo" : "Publicar menú" }}
      </button>
      <span v-if="msg" class="mn-msg" role="status">{{ msg }}</span>
    </div>
    <p v-if="err" class="mn-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { apiService } from "../apiService";

const m = reactive({ published: false, publishedAt: null, hours: { open: "00:00", close: "23:59" }, items: 0, foods: 0, outOfStock: [], dirty: false, autoPublish: true, pricing: { enabled: false, label: "", cutPct: 0 } });
const open = ref("00:00");
const close = ref("23:59");
const busy = ref(false);
const msg = ref("");
const err = ref("");

const when = (d) => new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function load() {
  try {
    Object.assign(m, await apiService.uberMenuStatus());
    open.value = m.hours.open;
    close.value = m.hours.close;
  } catch {
    err.value = "No se pudo leer el estado del menú.";
  }
}

async function toggleAuto(value) {
  busy.value = true;
  err.value = "";
  try {
    await apiService.uberSetAutoPublish(value);
    m.autoPublish = value;
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo guardar el ajuste.";
  } finally {
    busy.value = false;
  }
}

async function publish() {
  const question = m.pricing.enabled
    ? "Esto reemplaza el menú que tienes en Uber Eats por el de MiRestaurante, con los precios ajustados a tu plan. ¿Continuar?"
    : "⚠ Tus precios en Uber Eats NO están ajustados: el menú saldría con los precios de tu local y Uber se quedaría su comisión de tu ganancia.\n\nEsto además reemplaza el menú que tienes en Uber Eats. ¿Publicar de todos modos?";
  if (!confirm(question)) return;
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    const r = await apiService.uberPublishMenu(open.value, close.value);
    msg.value = `Menú publicado: ${r.items} productos y extras${r.outOfStock ? `, ${r.outOfStock} agotado(s)` : ""}.`;
    await load();
  } catch (e) {
    err.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo publicar el menú.";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.mn { display: grid; gap: 0.45rem; padding: 0.7rem 0.9rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.mn-line { margin: 0; font-size: 0.9rem; }
.mn-warn { color: var(--mirestaurante-warning); font-weight: 600; }
.mn-ok { color: var(--mirestaurante-success); font-weight: 600; }
.mn-row { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.9rem; }
.mn-row label { display: inline-flex; align-items: center; gap: 0.4rem; }
.mn-row input { min-height: 2rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; }
.mn-auto { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; }
.mn-hint { margin: 0; font-size: 0.8rem; color: var(--mirestaurante-muted); }
.mn-out { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); font-weight: 600; }
.mn-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
.mn-btn { min-height: 2rem; padding: 0 0.9rem; border-radius: 0.5rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.mn-msg { font-size: 0.85rem; color: var(--mirestaurante-muted); }
.mn-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
</style>
