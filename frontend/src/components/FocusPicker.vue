<template>
  <div class="focus-list" role="radiogroup" aria-label="Cómo trabaja tu negocio">
    <label v-for="f in SERVICE_FOCUSES" :key="f.id" class="focus-card" :class="{ on: modelValue === f.id }">
      <input
        type="radio"
        name="serviceFocus"
        class="focus-input"
        :value="f.id"
        :checked="modelValue === f.id"
        :disabled="disabled"
        @change="$emit('update:modelValue', f.id)"
      />
      <span class="focus-title">{{ f.label }}</span>
      <span class="focus-tagline">{{ f.tagline }}</span>
      <span class="focus-desc">{{ f.description }}</span>
      <span class="focus-roles">
        <span v-for="r in f.roles" :key="r" class="focus-role">{{ roleLabel[r] }}</span>
      </span>
    </label>
  </div>
</template>

<script setup>
import { SERVICE_FOCUSES, roleLabel } from "../roles";

defineProps({ modelValue: { type: String, default: "" }, disabled: Boolean });
defineEmits(["update:modelValue"]);
</script>

<style scoped>
/* Hereda el color de texto de donde se use (asistente claro o ajustes con el tema de la app) */
.focus-list { display: grid; gap: 0.7rem; }
.focus-card {
  position: relative;
  display: grid;
  gap: 0.2rem;
  padding: 0.85rem 1rem 0.85rem 2.6rem;
  border-radius: 0.9rem;
  cursor: pointer;
  border: 1.5px solid color-mix(in srgb, currentColor 22%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.focus-card:hover { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.focus-card.on { border-color: var(--mirestaurante-primary); background: var(--mirestaurante-primary-soft); }
.focus-card:has(.focus-input:focus-visible) { outline: 2px solid var(--mirestaurante-primary); outline-offset: 2px; }
/* El punto de selección es el propio radio, a la izquierda de la tarjeta */
.focus-input {
  position: absolute; left: 0.95rem; top: 1.05rem; width: 1.15rem; height: 1.15rem; margin: 0; cursor: pointer;
  /* Dibujado a mano: el radio nativo pierde su borde con los estilos globales de formularios */
  appearance: none; -webkit-appearance: none; padding: 0; border-radius: 50%; background: transparent;
  border: 2px solid color-mix(in srgb, currentColor 50%, transparent);
}
.focus-input:checked {
  border-color: var(--mirestaurante-primary);
  background: radial-gradient(circle, var(--mirestaurante-primary) 0 42%, transparent 46%);
}
.focus-title { font-weight: 700; font-size: 1.02rem; }
.focus-tagline { font-size: 0.8rem; font-weight: 600; opacity: 0.75; }
.focus-desc { font-size: 0.88rem; line-height: 1.4; opacity: 0.85; }
.focus-roles { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.35rem; }
.focus-role {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
}
</style>
