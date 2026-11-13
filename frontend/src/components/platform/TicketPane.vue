<template>
  <div class="scrim" @click.self="$emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Ticket de soporte">
      <p v-if="loading" class="muted">Cargando…</p>
      <p v-else-if="loadErr" class="err">{{ loadErr }}</p>
      <template v-else>
        <div class="head">
          <div>
            <h2>{{ ticket.subject }}</h2>
            <span class="pill" :class="TICKET_PILL[ticket.status]">{{ TICKET_STATUS[ticket.status] }}</span>
            <span class="sub"> · {{ businessName }}<template v-if="ticket.requester?.name"> · {{ ticket.requester.name }}</template></span>
            <div v-if="ticket.requester?.email" class="sub">{{ ticket.requester.email }}</div>
          </div>
          <button type="button" class="btn" @click="$emit('close')">Cerrar ventana</button>
        </div>

        <ol class="thread" aria-label="Mensajes del ticket">
          <li v-for="m in ticket.messages" :key="m.id" :class="m.direction">
            <div class="who">{{ m.direction === "out" ? "Equipo" : "Cliente" }} · {{ m.author }} <span>{{ fmtDateTime(m.at) }}</span></div>
            <p>{{ m.text }}</p>
          </li>
        </ol>

        <form class="form" @submit.prevent="send">
          <label>
            Tu respuesta
            <textarea v-model="reply" rows="4" maxlength="4000" placeholder="Escribe la respuesta para el cliente…"></textarea>
          </label>
          <div class="actions">
            <button type="submit" class="btn primary" :disabled="busy || reply.trim().length < 2">{{ busy ? "Enviando…" : "Responder" }}</button>
            <button v-if="ticket.status !== 'closed'" type="button" class="btn" :disabled="busy" @click="setClosed(true)">Cerrar ticket</button>
            <button v-else type="button" class="btn" :disabled="busy" @click="setClosed(false)">Reabrir</button>
          </div>
          <p v-if="msg" class="ok" role="status">{{ msg }}</p>
          <p v-if="err" class="err" role="alert">{{ err }}</p>
        </form>
      </template>
    </aside>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { errorText, fmtDateTime, TICKET_PILL, TICKET_STATUS } from "./format";

const props = defineProps({ id: { type: String, required: true }, businessName: { type: String, default: "" } });
const emit = defineEmits(["close", "changed"]);

const ticket = ref(null);
const loading = ref(true);
const loadErr = ref("");
const reply = ref("");
const busy = ref(false);
const msg = ref("");
const err = ref("");

async function load() {
  try {
    ticket.value = await apiService.platformGetTicket(props.id);
  } catch (e) {
    loadErr.value = errorText(e, "No se pudo abrir el ticket");
  } finally {
    loading.value = false;
  }
}

async function run(fn, done) {
  busy.value = true;
  msg.value = "";
  err.value = "";
  try {
    ticket.value = await fn();
    msg.value = done;
    emit("changed");
  } catch (e) {
    err.value = errorText(e, "No se pudo completar la acción");
  } finally {
    busy.value = false;
  }
}

const send = () =>
  run(async () => {
    const updated = await apiService.platformReplyTicket(props.id, reply.value);
    reply.value = "";
    return updated;
  }, "Respuesta enviada.");

const setClosed = (closed) => run(() => apiService.platformSetTicketClosed(props.id, closed), closed ? "Ticket cerrado." : "Ticket reabierto.");

onMounted(load);
</script>

<style scoped>
.thread { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; gap: 0.6rem; }
.thread li { border: 1px solid #2a3530; border-radius: 0.75rem; padding: 0.65rem 0.8rem; background: #141b18; max-width: 92%; }
.thread li.out { margin-left: auto; background: #1d2722; border-color: #3d4b44; }
.who { font-size: 0.75rem; color: #9aa8a1; margin-bottom: 0.25rem; }
.who span { margin-left: 0.4rem; color: #7d8b84; }
.thread p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
