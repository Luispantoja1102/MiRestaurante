<template>
  <header class="tk-head">
    <img v-if="logo" class="tk-logo" :src="logo" alt="" />
    <!-- Servicio de mesa: tenedor, plato y cuchillo -->
    <div class="tk-setting" aria-hidden="true">
      <i></i>
      <svg viewBox="0 0 24 24" class="tk-cutlery" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6M10 3v6M13 3v6M7 9a3 3 0 0 0 6 0M10 12v9" /></svg>
      <svg viewBox="0 0 24 24" class="tk-plate" fill="none" stroke="#000" stroke-width="1.7"><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="5.6" /></svg>
      <svg viewBox="0 0 24 24" class="tk-cutlery" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V3c3.4 1.4 4.8 4.6 4.8 9H9" fill="#000" /></svg>
      <i></i>
    </div>
    <p class="tk-shop">{{ name }}</p>
    <p class="tk-kind">{{ kind }}</p>
    <p v-if="address" class="tk-addr">{{ address }}</p>
    <p v-if="phone" class="tk-addr">Tel. {{ phone }}</p>
  </header>
</template>

<script setup>
import { computed } from "vue";
import { venueStore } from "../venueStore";
import { BUSINESS_TYPE_LABEL } from "../ticketShell";

// Sin props usa los datos guardados; con props sirve de vista previa
const props = defineProps({
  preview: { type: Object, default: null },
});
const src = computed(() => props.preview || venueStore);
const name = computed(() => src.value.businessName || "MiRestaurante");
const kind = computed(() => BUSINESS_TYPE_LABEL[src.value.businessType] || BUSINESS_TYPE_LABEL.restaurant);
const address = computed(() => src.value.address || "");
const phone = computed(() => src.value.phone || "");
// El logo propio del negocio (no el de la app) sale en blanco y negro
const logo = computed(() => (src.value.logoUrl && src.value.logoUrl !== "/logo.svg" ? src.value.logoUrl : ""));
</script>

<style scoped>
.tk-head {
  display: grid;
  justify-items: center;
  gap: 0.8mm;
  text-align: center;
}
.tk-logo {
  display: block;
  max-width: 34mm;
  max-height: 20mm;
  margin-bottom: 1mm;
  object-fit: contain;
  filter: grayscale(1) contrast(1.6);
}
.tk-setting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.6mm;
  width: 100%;
  margin-bottom: 1.4mm;
}
.tk-setting i { flex: 1; border-top: 1.5px solid #000; }
.tk-cutlery { width: 6.4mm; height: 6.4mm; flex: none; }
.tk-plate { width: 8.6mm; height: 8.6mm; flex: none; }
.tk-shop {
  margin: 0;
  max-width: 100%;
  font-family: "Bricolage Grotesque", Georgia, "Times New Roman", serif;
  font-size: 1.85em;
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.tk-kind {
  margin: 0.6mm 0 0.8mm;
  font-size: 0.74em;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
.tk-kind::before,
.tk-kind::after { content: "✦"; margin: 0 1.6mm; font-size: 0.9em; letter-spacing: 0; }
.tk-addr {
  margin: 0;
  font-size: 0.86em;
  line-height: 1.3;
}
</style>
