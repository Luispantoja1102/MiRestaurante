<template>
  <div class="delivery-fields">
    <label>Nombre de quien recibe
      <input v-model="d.name" type="text" maxlength="40" autocomplete="off" placeholder="Ana Pérez" />
    </label>
    <label>Teléfono <em v-if="platform">(opcional)</em>
      <input v-model="d.phone" type="tel" maxlength="20" inputmode="tel" autocomplete="off" placeholder="55 1234 5678" />
    </label>
    <label>Dirección <em v-if="platform">(opcional)</em>
      <input v-model="d.address" type="text" maxlength="160" autocomplete="off" placeholder="Calle, número y colonia" />
    </label>
    <label>Referencia <em>(opcional)</em>
      <input v-model="d.reference" type="text" maxlength="80" autocomplete="off" placeholder="Portón negro, 2.º piso" />
    </label>
  </div>
</template>

<script setup>
// Edita el objeto que le pasa quien lo usa (v-model:delivery no hace falta: es el mismo objeto reactivo)
const props = defineProps({ delivery: { type: Object, required: true }, platform: Boolean });
const d = props.delivery;
</script>

<style scoped>
.delivery-fields { display: grid; gap: 0.5rem; }
label { display: grid; gap: 0.2rem; font-size: 0.78rem; font-weight: 600; color: var(--mirestaurante-muted); }
label em { font-weight: 400; }
input {
  min-height: 2.6rem;
  padding: 0.45rem 0.7rem;
  border: 1.5px solid var(--mirestaurante-line);
  border-radius: 0.6rem;
  background: var(--mirestaurante-panel);
  color: var(--mirestaurante-ink);
  font: inherit;
  font-size: 16px; /* evita zoom en iOS */
}
input:focus-visible { outline: 2px solid var(--mirestaurante-primary); outline-offset: 1px; }
</style>
