<template>
  <div class="logo-field">
    <span class="logo-label">Logo</span>
    <div class="logo-row">
      <span class="logo-box"><img :src="logoUrl || '/logo.svg'" alt="Logo del negocio" /></span>
      <div class="logo-acts">
        <label class="logo-btn">
          Subir imagen
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only" @change="onLogo" />
        </label>
        <button v-if="logoUrl && logoUrl !== '/logo.svg'" type="button" class="logo-btn danger" @click="useStockLogo">
          Usar el de MiRestaurante
        </button>
        <p class="logo-hint">
          PNG o JPG cuadrado. Lo ajustamos a 256 px para que cargue rápido. Aparece arriba en la app, y con sus colores armamos la
          paleta de tu negocio.
        </p>
        <p v-if="hasBrand" class="brand-row">
          <i :style="{ background: primaryColor }" title="Color principal"></i>
          <i :style="{ background: accentColor }" title="Color para detalles"></i>
          <span>{{ hint }}</span>
        </p>
        <p v-if="brandNote" class="logo-hint">{{ brandNote }}</p>
        <p v-if="logoErr" class="logo-err" role="alert">{{ logoErr }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * Logo del negocio: se sube como archivo, se reduce a 256 px y de sus colores sale la paleta que se aplica a toda la app.
 * Lo usan Ajustes y el asistente inicial; quien lo usa guarda los tres valores.
 */
import { computed, ref } from "vue";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, applyBrandPreview, brandFromLogo, isDefaultPalette } from "../brandTheme";

const props = defineProps({
  logoUrl: { type: String, default: "" },
  primaryColor: { type: String, default: "" },
  accentColor: { type: String, default: "" },
  hint: { type: String, default: "Paleta de tu logo" },
});
const emit = defineEmits(["update:logoUrl", "update:primaryColor", "update:accentColor"]);

const logoErr = ref("");
const brandNote = ref("");
const hasBrand = computed(() => !isDefaultPalette(props.primaryColor, props.accentColor));

/** Con el logo nuevo se arma la paleta del negocio (color principal y uno más claro) y se ve en toda la app. */
async function adoptBrand(url) {
  brandNote.value = "";
  const palette = await brandFromLogo(url);
  if (!palette) {
    brandNote.value = "No pudimos sacar colores de esa imagen; se quedan los que tenías.";
    return;
  }
  emit("update:primaryColor", palette.primary);
  emit("update:accentColor", palette.accent);
}

function useStockLogo() {
  emit("update:logoUrl", "/logo.svg");
  emit("update:primaryColor", DEFAULT_PRIMARY);
  emit("update:accentColor", DEFAULT_ACCENT);
  brandNote.value = "";
  applyBrandPreview(DEFAULT_PRIMARY, DEFAULT_ACCENT);
}

function onLogo(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  logoErr.value = "";
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    logoErr.value = "Elige una imagen (PNG, JPG o SVG).";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    logoErr.value = "La imagen pesa más de 5 MB; elige una más ligera.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
      const w = Math.max(1, Math.round((img.width || max) * scale));
      const h = Math.max(1, Math.round((img.height || max) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let url = canvas.toDataURL("image/png");
      if (url.length > 300_000) url = canvas.toDataURL("image/jpeg", 0.85);
      emit("update:logoUrl", url);
      adoptBrand(url);
    };
    img.onerror = () => (logoErr.value = "No se pudo leer la imagen.");
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}
</script>

<style scoped>
.logo-field { grid-column: 1 / -1; display: grid; gap: 0.4rem; }
.logo-label { font-weight: 600; font-size: 0.9rem; }
.logo-row { display: flex; align-items: flex-start; gap: 1rem; }
.logo-box { flex-shrink: 0; width: 5.5rem; height: 5.5rem; display: grid; place-items: center; border-radius: 1rem; border: 1px solid var(--mirestaurante-line, rgba(0, 0, 0, 0.12)); background: #fff; overflow: hidden; }
.logo-box img { width: 100%; height: 100%; object-fit: contain; }
.logo-acts { display: grid; gap: 0.5rem; justify-items: start; min-width: 0; }
.logo-btn { position: relative; display: inline-flex; align-items: center; min-height: 2.4rem; padding: 0 1rem; border-radius: 0.6rem; border: 1.5px solid var(--mirestaurante-line, rgba(0, 0, 0, 0.12)); background: var(--mirestaurante-panel-elevated, #fff); color: var(--mirestaurante-ink, #1b1814); font-weight: 700; cursor: pointer; }
.logo-btn:focus-within { outline: 2px solid var(--mirestaurante-primary); outline-offset: 2px; }
.logo-btn.danger { color: var(--mirestaurante-danger, #b42318); }
.logo-hint { margin: 0; font-size: 0.82rem; color: var(--mirestaurante-muted, #6f665a); }
.logo-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger, #b42318); }
.brand-row { display: flex; align-items: center; gap: 0.4rem; margin: 0.2rem 0 0; font-size: 0.85rem; color: var(--mirestaurante-muted, #6f665a); }
.brand-row i { width: 1.4rem; height: 1.4rem; border-radius: 50%; border: 2px solid var(--mirestaurante-panel, #fff); box-shadow: 0 0 0 1px var(--mirestaurante-line, rgba(0, 0, 0, 0.12)); }
@media (max-width: 520px) { .logo-row { flex-direction: column; } }
</style>
