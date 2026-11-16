<template>
  <label class="channel-select">Origen del pedido
    <select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="(label, id) in channelLabel" :key="id" :value="id">{{ label }}</option>
    </select>
  </label>
</template>

<script setup>
import { channelLabel } from "../labels";

defineProps({ modelValue: { type: String, default: "local" } });
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.channel-select { display: grid; gap: 0.2rem; font-size: 0.78rem; font-weight: 600; color: var(--mirestaurante-muted); }
select {
  min-height: 2.6rem;
  padding: 0.45rem 0.7rem;
  border: 1.5px solid var(--mirestaurante-line);
  border-radius: 0.6rem;
  background: var(--mirestaurante-panel);
  color: var(--mirestaurante-ink);
  font: inherit;
  font-size: 16px; /* evita zoom en iOS */
}
select:focus-visible { outline: 2px solid var(--mirestaurante-primary); outline-offset: 1px; }
</style>
