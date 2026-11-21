<template>
  <div class="uh">
    <strong>Horarios especiales en Uber Eats</strong>
    <p class="uh-hint">
      Para festivos o días en que cierras o abres distinto. Ese día, Uber usa este horario en lugar del normal. Al guardar, la lista que ves
      <strong>reemplaza</strong> los horarios especiales de tu tienda en Uber Eats (aquí aparecen los que ya tiene).
    </p>

    <p v-if="loadError" class="uh-err" role="alert">{{ loadError }}</p>

    <template v-else-if="loaded">
      <ul v-if="days.length" class="uh-list">
        <li v-for="d in days" :key="d.date">
          <span class="uh-date">{{ dateText(d.date) }}</span>
          <span class="uh-what" :class="{ closed: d.closed }">{{ d.closed ? "Cerrado todo el día" : periodsText(d) }}</span>
          <button type="button" class="uh-link" :disabled="busy" @click="remove(d.date)">Quitar</button>
        </li>
      </ul>
      <p v-else class="uh-hint">No tienes horarios especiales: la tienda sigue su horario normal todos los días.</p>

      <form class="uh-add" @submit.prevent="add">
        <label>Día
          <input v-model="form.date" type="date" :min="today" required />
        </label>
        <label>Ese día
          <select v-model="form.mode">
            <option value="closed">Cerrado todo el día</option>
            <option value="hours">Abierto con otro horario</option>
          </select>
        </label>
        <template v-if="form.mode === 'hours'">
          <label>Abre <input v-model="form.start" type="time" required /></label>
          <label>Cierra <input v-model="form.end" type="time" required /></label>
        </template>
        <button type="submit" class="uh-btn" :disabled="busy">Agregar</button>
      </form>
      <p v-if="formError" class="uh-err" role="alert">{{ formError }}</p>

      <div class="uh-actions">
        <button type="button" class="uh-btn primary" :disabled="busy || !dirty" @click="save">{{ busy ? "Guardando…" : "Guardar horarios especiales" }}</button>
        <span v-if="dirty" class="uh-msg">Tienes cambios sin guardar.</span>
        <span v-else-if="msg" class="uh-msg" role="status">{{ msg }}</span>
      </div>
    </template>
    <p v-if="err" class="uh-err" role="alert">{{ err }}</p>
  </div>
</template>

<script setup>
import { errorText as errorOf } from "../format";
import { computed, onMounted, reactive, ref } from "vue";
import { apiService } from "../apiService";

const days = ref([]);
const today = ref("");
const loaded = ref(false);
const loadError = ref(""); // si no se pudo leer lo de Uber no se deja guardar: se borrarían horarios que no vimos
const busy = ref(false);
const msg = ref("");
const err = ref("");
const formError = ref("");
const saved = ref("[]");
const form = reactive({ date: "", mode: "closed", start: "09:00", end: "14:00" });

const dirty = computed(() => JSON.stringify(days.value) !== saved.value);
const dateText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const periodsText = (d) => d.periods.map((p) => `${p.start} a ${p.end}`).join(" y ");

function apply(data) {
  days.value = data.days;
  today.value = data.today;
  saved.value = JSON.stringify(data.days);
}

async function load() {
  try {
    apply(await apiService.uberHolidays());
    loaded.value = true;
  } catch (e) {
    loadError.value = errorOf(e, "No se pudieron leer los horarios especiales de Uber Eats.");
  }
}

function add() {
  formError.value = "";
  msg.value = "";
  if (!form.date || form.date < today.value) return void (formError.value = "Elige un día de hoy en adelante.");
  if (form.mode === "hours" && form.end <= form.start) return void (formError.value = "La hora de cierre debe ser después de la de apertura.");
  const entry = form.mode === "closed" ? { date: form.date, closed: true, periods: [] } : { date: form.date, closed: false, periods: [{ start: form.start, end: form.end }] };
  // Un día solo tiene un horario especial: si ya había, se cambia
  days.value = [...days.value.filter((d) => d.date !== form.date), entry].sort((a, b) => a.date.localeCompare(b.date));
  form.date = "";
}

function remove(date) {
  msg.value = "";
  days.value = days.value.filter((d) => d.date !== date);
}

async function save() {
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    apply(await apiService.uberSetHolidays(days.value));
    msg.value = "Guardado en Uber Eats.";
  } catch (e) {
    err.value = errorOf(e, "No se pudieron guardar los horarios especiales.");
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.uh { display: grid; gap: 0.55rem; padding: 0.7rem 0.9rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; background: var(--mirestaurante-panel-elevated); }
.uh-hint { margin: 0; font-size: 0.8rem; color: var(--mirestaurante-muted); }
.uh-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
.uh-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.6rem; align-items: baseline; padding: 0.45rem 0.6rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.6rem; background: var(--mirestaurante-panel); font-size: 0.88rem; }
.uh-date { font-weight: 700; }
.uh-date::first-letter { text-transform: uppercase; }
.uh-what { color: var(--mirestaurante-muted); }
.uh-what.closed { color: var(--mirestaurante-danger); font-weight: 700; }
.uh-link { background: none; border: none; padding: 0; color: var(--mirestaurante-danger); font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }
.uh-add { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; font-size: 0.86rem; }
.uh-add label { display: grid; gap: 0.25rem; font-weight: 600; }
.uh-add input, .uh-add select { min-height: 2.2rem; border-radius: 0.5rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; padding: 0 0.5rem; }
.uh-btn { min-height: 2.2rem; padding: 0 0.9rem; border-radius: 0.5rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-panel); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.uh-btn.primary:not(:disabled) { border-color: var(--mirestaurante-primary); background: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary, #fff); }
.uh-btn:disabled { opacity: 0.55; cursor: default; }
.uh-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
.uh-msg { font-size: 0.85rem; color: var(--mirestaurante-muted); }
.uh-err { margin: 0; font-size: 0.85rem; color: var(--mirestaurante-danger); }
</style>
