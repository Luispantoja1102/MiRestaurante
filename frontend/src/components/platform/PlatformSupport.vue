<template>
  <section>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="Buscar por cliente, asunto o mensaje" aria-label="Buscar tickets" @input="schedule" />
      <button v-for="f in FILTERS" :key="f.id" type="button" class="btn chip" :class="{ on: status === f.id }" @click="setStatus(f.id)">
        {{ f.label }} <span class="muted">{{ count(f.id) }}</span>
      </button>
    </div>

    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <p v-if="loading && !data" class="muted">Cargando…</p>
    <div v-else-if="data" class="table-wrap">
      <table>
        <thead><tr><th>Cliente</th><th>Asunto</th><th>Estado</th><th>Último mensaje</th><th>Mensajes</th><th>Actualizado</th></tr></thead>
        <tbody>
          <tr v-for="t in data.items" :key="t.id" class="click" tabindex="0" @click="open(t)" @keydown.enter="open(t)">
            <td><strong>{{ t.businessName }}</strong><div class="sub">{{ t.from }}</div></td>
            <td>{{ t.subject }}</td>
            <td><span class="pill" :class="TICKET_PILL[t.status]">{{ TICKET_STATUS[t.status] }}</span></td>
            <td class="muted">{{ t.lastFrom }}: {{ t.preview }}</td>
            <td>{{ t.messageCount }}</td>
            <td>{{ fmtDateTime(t.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data.items.length" class="empty">{{ emptyText }}</p>
    </div>

    <TicketPane v-if="openTicket" :id="openTicket.id" :business-name="openTicket.businessName" @close="openTicket = null" @changed="load" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import TicketPane from "./TicketPane.vue";
import { errorText, fmtDateTime, TICKET_PILL, TICKET_STATUS } from "./format";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "open", label: "Esperando al equipo" },
  { id: "answered", label: "Respondidos" },
  { id: "closed", label: "Cerrados" },
];

const data = ref(null);
const loading = ref(true);
const err = ref("");
const query = ref("");
const status = ref("open");
const openTicket = ref(null);
let timer = null;

// El total de "Todos" sale de los otros tres: la bandeja devuelve el conteo de cada estado
const count = (id) => (data.value ? (id === "all" ? Object.values(data.value.counts).reduce((a, b) => a + b, 0) : data.value.counts[id]) : "");
const emptyText = computed(() =>
  query.value.trim() ? "Ningún ticket coincide con la búsqueda." : status.value === "open" ? "Nada esperando respuesta. Todo al día." : "No hay tickets aquí."
);

async function load() {
  err.value = "";
  try {
    data.value = await apiService.platformSupport({ status: status.value, q: query.value.trim() || undefined });
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar la bandeja");
  } finally {
    loading.value = false;
  }
}

const setStatus = (id) => {
  status.value = id;
  load();
};
// Espera a que la persona termine de escribir antes de buscar
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
};
const open = (t) => (openTicket.value = { id: t.id, businessName: t.businessName });

onMounted(load);
</script>
