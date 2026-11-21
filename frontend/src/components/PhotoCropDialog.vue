<template>
  <Teleport to="body">
    <div v-if="file" class="pc-bg" @click.self="$emit('cancel')">
      <div class="pc-card" role="dialog" aria-modal="true" aria-label="Encuadrar foto">
        <h3>Encuadra la foto</h3>
        <p v-if="error" class="pc-err" role="alert">{{ error }}</p>
        <p v-else-if="!bitmap" class="pc-hint">Cargando la imagen…</p>
        <template v-else>
          <p class="pc-hint">Arrastra para encuadrar y usa el zoom. Lo que ves dentro del marco es lo que se guarda y lo que ve Uber Eats.</p>
          <div
            ref="frame"
            class="pc-frame"
            :style="{ height: fh + 'px', cursor: drag ? 'grabbing' : 'grab' }"
            @pointerdown="down"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
          >
            <img
              :src="src"
              alt="Vista previa del recorte"
              draggable="false"
              :style="{
                width: bitmap.width * s + 'px',
                height: bitmap.height * s + 'px',
                left: fw / 2 - cx * s + 'px',
                top: fh / 2 - cy * s + 'px',
              }"
            />
          </div>
          <label class="pc-zoom">
            Zoom
            <input v-model.number="zoom" type="range" min="1" max="4" step="0.01" aria-label="Zoom" />
          </label>
        </template>
        <div class="pc-acts">
          <button type="button" class="pc-btn" @click="$emit('cancel')">Cancelar</button>
          <button type="button" class="pc-btn pc-primary" :disabled="!bitmap || busy" @click="confirm">Usar esta foto</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({ file: { type: Object, default: null } });
const emit = defineEmits(["done", "cancel"]);

const RATIO = 3 / 2; // la tarjeta del menú y la foto de Uber Eats son 3:2
const OUT_W = 1200; // ancho de la foto guardada (1200×800), suficiente para Uber Eats
const MAX_CHARS = 250_000; // peso máximo del resultado (~185 KB de imagen; el servidor acepta hasta 300 KB)
const MAX_INPUT = 25 * 1024 * 1024;

const bitmap = ref(null);
const src = ref("");
const error = ref("");
const frame = ref(null);
const fw = ref(300);
const fh = computed(() => Math.round(fw.value / RATIO));
const zoom = ref(1);
const cx = ref(0);
const cy = ref(0);
const drag = ref(null);
const busy = ref(false);

const base = computed(() => (bitmap.value ? Math.max(fw.value / bitmap.value.width, fh.value / bitmap.value.height) : 1));
const s = computed(() => base.value * zoom.value);

function clamp() {
  if (!bitmap.value) return;
  const halfX = fw.value / (2 * s.value);
  const halfY = fh.value / (2 * s.value);
  cx.value = Math.min(Math.max(cx.value, halfX), bitmap.value.width - halfX);
  cy.value = Math.min(Math.max(cy.value, halfY), bitmap.value.height - halfY);
}
watch([zoom, fw], clamp);

function release() {
  bitmap.value?.close?.();
  bitmap.value = null;
  if (src.value) URL.revokeObjectURL(src.value);
  src.value = "";
}

watch(
  () => props.file,
  async (f) => {
    release();
    error.value = "";
    if (!f) return;
    if (!f.type?.startsWith("image/")) {
      error.value = "Elige una imagen (JPG, PNG o WebP).";
      return;
    }
    if (f.size > MAX_INPUT) {
      error.value = "La imagen pesa demasiado. Elige una de menos de 25 MB.";
      return;
    }
    try {
      const b = await createImageBitmap(f);
      src.value = URL.createObjectURL(f);
      bitmap.value = b;
      zoom.value = 1;
      cx.value = b.width / 2;
      cy.value = b.height / 2;
      await nextTick();
      fw.value = Math.round(frame.value?.clientWidth || 300);
    } catch {
      error.value = "No se pudo leer la imagen. Prueba con otra.";
    }
  },
  { immediate: true }
);
onBeforeUnmount(release);

function down(e) {
  drag.value = { x: e.clientX, y: e.clientY };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function move(e) {
  if (!drag.value) return;
  cx.value -= (e.clientX - drag.value.x) / s.value;
  cy.value -= (e.clientY - drag.value.y) / s.value;
  drag.value = { x: e.clientX, y: e.clientY };
  clamp();
}
function up() {
  drag.value = null;
}

function render(w) {
  const h = Math.round(w / RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  const sw = fw.value / s.value;
  const sh = fh.value / s.value;
  ctx.drawImage(bitmap.value, cx.value - sw / 2, cy.value - sh / 2, sw, sh, 0, 0, w, h);
  return canvas;
}

// JPEG (lo acepta Uber Eats): baja la calidad y luego el tamaño hasta que quepa en MAX_CHARS.
function compress() {
  let w = Math.round(Math.min(OUT_W, fw.value / s.value)); // nunca agrandar más allá de los pixeles de la foto
  for (let round = 0; round < 4; round++) {
    const canvas = render(w);
    for (const q of [0.85, 0.78, 0.7, 0.62, 0.55]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= MAX_CHARS) return url;
    }
    w = Math.round(w * 0.85);
  }
  throw new Error("La imagen sigue siendo muy pesada. Prueba con una más sencilla.");
}

function confirm() {
  if (!bitmap.value) return;
  busy.value = true;
  try {
    emit("done", compress());
  } catch (e) {
    error.value = e instanceof Error ? e.message : "No se pudo preparar la foto.";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pc-bg {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(10, 18, 32, 0.6);
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.pc-card {
  width: min(24rem, 100%);
  background: var(--mirestaurante-panel);
  color: var(--mirestaurante-ink);
  border: 1px solid var(--mirestaurante-line);
  border-radius: 1.2rem;
  padding: 1rem;
  display: grid; gap: 0.7rem;
}
.pc-card h3 { margin: 0; font-size: 1.15rem; font-weight: 700; }
.pc-hint { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-muted); }
.pc-err { margin: 0; font-size: 0.88rem; color: var(--mirestaurante-danger, #b42318); }
.pc-frame {
  position: relative; width: 100%; overflow: hidden; touch-action: none; user-select: none;
  border-radius: 0.8rem; background: var(--mirestaurante-surface);
  outline: 2px solid var(--mirestaurante-primary);
}
.pc-frame img { position: absolute; max-width: none; pointer-events: none; }
.pc-zoom { display: flex; align-items: center; gap: 0.7rem; font-size: 0.85rem; font-weight: 700; }
.pc-zoom input { width: 100%; }
.pc-acts { display: flex; justify-content: flex-end; gap: 0.5rem; }
.pc-btn {
  min-height: 2.6rem; padding: 0 1rem; border-radius: 0.7rem; cursor: pointer; font-weight: 700;
  border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-surface); color: var(--mirestaurante-ink);
}
.pc-primary { background: var(--mirestaurante-primary); border-color: var(--mirestaurante-primary); color: #fff; }
.pc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
