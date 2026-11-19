<template>
  <Teleport to="body">
    <div v-if="d" class="dlg-bg" @click.self="cancel">
      <div ref="box" class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h3 id="dlg-title">{{ d.title || titles[d.kind] }}</h3>
        <p id="dlg-msg" class="dlg-msg">{{ d.message }}</p>
        <input
          v-if="d.kind === 'text'"
          ref="field"
          v-model="text"
          class="dlg-input"
          type="text"
          :placeholder="d.placeholder || ''"
          aria-labelledby="dlg-msg"
          @keydown.enter.prevent="ok"
        />
        <div class="dlg-actions">
          <button v-if="d.kind !== 'notify'" type="button" class="dlg-btn" @click="cancel">{{ d.cancelText || "Cancelar" }}</button>
          <button ref="okBtn" type="button" class="dlg-btn dlg-ok" :class="{ danger: d.danger }" @click="ok">
            {{ d.confirmText || (d.kind === "notify" ? "Entendido" : "Aceptar") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeDialog, dialogState } from "../dialog";

const d = computed(() => dialogState.current);
const titles = { confirm: "¿Seguro?", text: "Escribe un dato", notify: "Aviso" };
const text = ref("");
const box = ref(null);
const field = ref(null);
const okBtn = ref(null);

// Al abrirse, el foco va al campo (o al botón principal) y se recuerda dónde estaba el usuario para devolvérselo al cerrar
let previous = null;
watch(d, async (now, before) => {
  if (now && !before) previous = document.activeElement;
  if (now) {
    text.value = now.value ?? "";
    await nextTick();
    (field.value || okBtn.value)?.focus();
    field.value?.select?.();
  } else if (before) {
    previous?.focus?.();
    previous = null;
  }
});

onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));

function ok() {
  closeDialog(d.value.kind === "text" ? text.value : true);
}
function cancel() {
  closeDialog(d.value.kind === "text" ? null : d.value.kind === "notify");
}
// Esc cancela; Tab no se sale del aviso. Se escucha en toda la página mientras haya un aviso abierto (aunque el foco no esté dentro)
function onKey(e) {
  if (!d.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  } else if (e.key === "Tab" && box.value) {
    const items = [...box.value.querySelectorAll("input, button")];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
</script>

<style scoped>
.dlg-bg {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: rgba(10, 16, 14, 0.55);
  backdrop-filter: blur(6px);
}
.dlg {
  width: min(24rem, 100%);
  max-height: 85vh;
  overflow-y: auto;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.85rem;
  padding: 1.35rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  border: 1px solid var(--mirestaurante-line);
  border-radius: 1.15rem 1.15rem 0.85rem 0.85rem;
  background: var(--mirestaurante-panel);
  color: var(--mirestaurante-ink);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.25);
  animation: dlg-in 0.18s ease both;
}
.dlg h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.dlg-msg {
  margin: 0;
  white-space: pre-line; /* respeta los saltos de línea del mensaje */
  line-height: 1.45;
  font-size: 0.95rem;
  color: var(--mirestaurante-ink);
  overflow-wrap: anywhere;
}
.dlg-input {
  width: 100%;
  min-height: 3rem;
  box-sizing: border-box;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--mirestaurante-line);
  border-radius: 0.75rem;
  background: var(--mirestaurante-panel-elevated);
  color: var(--mirestaurante-ink);
  font: inherit;
}
.dlg-actions {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 0.55rem;
  margin-top: 0.25rem;
}
.dlg-btn {
  min-height: 3.15rem;
  border: 1px solid var(--mirestaurante-line);
  border-radius: 0.85rem;
  background: var(--mirestaurante-surface, var(--mirestaurante-panel-elevated));
  color: var(--mirestaurante-ink);
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
}
.dlg-ok {
  border: none;
  background: var(--mirestaurante-primary);
  color: var(--mirestaurante-on-primary);
}
.dlg-ok.danger {
  background: var(--mirestaurante-danger);
  color: #fff;
}
.dlg-btn:focus-visible,
.dlg-input:focus-visible {
  outline: 3px solid var(--mirestaurante-accent, var(--mirestaurante-primary));
  outline-offset: 2px;
}
@keyframes dlg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@media (min-width: 720px) {
  .dlg-bg { align-items: center; padding: 1.5rem; }
  .dlg { border-radius: 1.15rem; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3); }
}
@media (prefers-reduced-motion: reduce) {
  .dlg { animation: none; }
}
</style>
