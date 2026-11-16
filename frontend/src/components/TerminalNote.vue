<template>
  <p v-if="waiting" class="terminal-note" role="status">
    Esperando el pago en la terminal…
    <button type="button" class="tn-link" @click="$emit('cancel')">Cancelar cobro</button>
  </p>
  <p v-else-if="term.ok && !manual" class="terminal-note" role="status">
    Se cobrará en tu terminal de Mercado Pago ({{ term.terminalLabel }}).
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
defineProps({ term: { type: Object, required: true }, waiting: Boolean, manual: Boolean });
defineEmits(["cancel", "update:manual"]);
</script>

<style scoped>
.terminal-note { margin: 0; padding: 0.65rem 0.8rem; border-radius: 0.8rem; font-size: 0.88rem; background: var(--mirestaurante-primary-soft); }
.terminal-note.warn { background: color-mix(in srgb, var(--mirestaurante-warning, #e8a020) 14%, transparent); }
.tn-link { margin-left: 0.4rem; background: none; border: none; padding: 0; color: var(--mirestaurante-primary); font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
</style>
