<template>
  <p v-if="waiting" class="terminal-note" role="status">
    Esperando el pago en la terminal…
    <button type="button" class="tn-link" @click="$emit('cancel')">Cancelar cobro</button>
  </p>
  <p v-else-if="term.ok && !manual" class="terminal-note" role="status">
    <template v-if="readyTerminals.length > 1">
      Cobrar en
      <select v-model="term.selected" class="tn-select" aria-label="Terminal de cobro">
        <option v-for="t in readyTerminals" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>
    </template>
    <template v-else>Se cobrará en tu terminal de Mercado Pago ({{ selectedName }}).</template>
    <button type="button" class="tn-link" @click="$emit('update:manual', true)">Ya cobré aparte</button>
  </p>
  <p v-else-if="term.ok && manual" class="terminal-note" role="status">
    La tarjeta se registrará sin usar la terminal.
    <button type="button" class="tn-link" @click="$emit('update:manual', false)">Usar la terminal</button>
  </p>
  <p v-else-if="term.connected && term.code !== 'no_terminal'" class="terminal-note warn" role="status">
    La terminal no está disponible: {{ term.message }} Puedes registrar la tarjeta a mano.
  </p>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({ term: { type: Object, required: true }, waiting: Boolean, manual: Boolean });
defineEmits(["cancel", "update:manual"]);

const readyTerminals = computed(() => (props.term.terminals || []).filter((t) => t.ok));
const selectedName = computed(() => readyTerminals.value.find((t) => t.id === props.term.selected)?.name || props.term.terminalLabel);
</script>

<style scoped>
.terminal-note { margin: 0; padding: 0.65rem 0.8rem; border-radius: 0.8rem; font-size: 0.88rem; background: var(--mirestaurante-primary-soft); }
.terminal-note.warn { background: color-mix(in srgb, var(--mirestaurante-warning, #e8a020) 14%, transparent); }
.tn-select { margin: 0 0.3rem; padding: 0.2rem 0.4rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-border, #ccc); background: var(--mirestaurante-surface, transparent); color: inherit; font: inherit; font-weight: 700; }
.tn-link { margin-left: 0.4rem; background: none; border: none; padding: 0; color: var(--mirestaurante-primary); font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
</style>
