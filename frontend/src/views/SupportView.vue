<template>
  <AppShell>
    <div class="support">
      <header class="head">
        <h1>Soporte</h1>
        <p>Cuéntanos qué necesitas y el equipo de MiRestaurante te responde aquí mismo.</p>
      </header>

      <div v-if="loading" class="card">Cargando…</div>
      <div v-else-if="loadErr" class="card err" role="alert">{{ loadErr }}</div>
      <template v-else>
        <!-- Conversación abierta -->
        <section v-if="current" class="card">
          <button type="button" class="link" @click="current = null">← Todos mis mensajes</button>
          <div class="thread-head">
            <h2>{{ current.subject }}</h2>
            <span class="status" :class="current.status">{{ STATUS[current.status] }}</span>
          </div>
          <ol class="thread" aria-label="Mensajes">
            <li v-for="m in current.messages" :key="m.id" :class="m.direction">
              <div class="who">{{ m.direction === "out" ? "MiRestaurante" : "Tú" }} · {{ fmt(m.at) }}</div>
              <p>{{ m.text }}</p>
            </li>
          </ol>
          <form class="form" @submit.prevent="reply">
            <label>
              {{ current.status === "closed" ? "Escribe para reabrir este mensaje" : "Tu respuesta" }}
              <textarea v-model="replyText" rows="3" maxlength="4000" placeholder="Escribe tu mensaje…"></textarea>
            </label>
            <button type="submit" class="btn" :disabled="busy || replyText.trim().length < 2">{{ busy ? "Enviando…" : "Enviar" }}</button>
            <p v-if="err" class="err" role="alert">{{ err }}</p>
          </form>
        </section>

        <template v-else>
          <section class="card">
            <h2>Nuevo mensaje</h2>
            <form class="form" @submit.prevent="create">
              <label>Asunto<input v-model="draft.subject" required minlength="3" maxlength="120" placeholder="¿En qué te ayudamos?" /></label>
              <label>Mensaje<textarea v-model="draft.message" rows="4" required minlength="8" maxlength="4000" placeholder="Cuéntanos con detalle qué pasa o qué necesitas."></textarea></label>
              <button type="submit" class="btn" :disabled="busy">{{ busy ? "Enviando…" : "Enviar a soporte" }}</button>
              <p v-if="err" class="err" role="alert">{{ err }}</p>
            </form>
          </section>

          <section class="card">
            <h2>Mis mensajes</h2>
            <p v-if="!tickets.length" class="muted">Todavía no has escrito a soporte.</p>
            <ul v-else class="list">
              <li v-for="t in tickets" :key="t.id">
                <button type="button" class="row" @click="current = t">
                  <span>
                    <strong>{{ t.subject }}</strong>
                    <span class="muted"> · {{ t.messages.length }} {{ t.messages.length === 1 ? "mensaje" : "mensajes" }} · {{ fmt(t.updatedAt) }}</span>
                  </span>
                  <span class="status" :class="t.status">{{ STATUS[t.status] }}</span>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>
  </AppShell>
</template>

<script setup>
import { errorText as message } from "../format";
import { onMounted, reactive, ref } from "vue";
import AppShell from "../components/AppShell.vue";
import { apiService } from "../apiService";

// Lo que ve el negocio: "open" = ya lo tenemos y esperamos al equipo
const STATUS = { open: "En revisión", answered: "Respondido", closed: "Cerrado" };

const tickets = ref([]);
const current = ref(null);
const loading = ref(true);
const loadErr = ref("");
const busy = ref(false);
const err = ref("");
const replyText = ref("");
const draft = reactive({ subject: "", message: "" });

const fmt = (value) =>
  value ? new Date(value).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

async function load() {
  try {
    tickets.value = await apiService.supportList();
  } catch (e) {
    loadErr.value = message(e, "No se pudieron cargar tus mensajes");
  } finally {
    loading.value = false;
  }
}

async function create() {
  busy.value = true;
  err.value = "";
  try {
    const ticket = await apiService.supportCreate({ ...draft });
    Object.assign(draft, { subject: "", message: "" });
    await load();
    current.value = tickets.value.find((t) => t.id === ticket.id) || ticket;
  } catch (e) {
    err.value = message(e, "No se pudo enviar tu mensaje");
  } finally {
    busy.value = false;
  }
}

async function reply() {
  busy.value = true;
  err.value = "";
  try {
    const updated = await apiService.supportReply(current.value.id, replyText.value);
    replyText.value = "";
    current.value = updated;
    await load();
  } catch (e) {
    err.value = message(e, "No se pudo enviar tu mensaje");
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.support { max-width: 52rem; margin: 0 auto; display: grid; gap: 1rem; }
.head h1 { margin: 0; font-family: var(--font-display); font-size: 1.65rem; letter-spacing: -0.02em; }
.head p { margin: 0.25rem 0 0; color: var(--mirestaurante-muted); }
.card { background: var(--mirestaurante-panel); border: 1px solid var(--mirestaurante-line); border-radius: 1rem; padding: 1rem 1.1rem; }
.card h2 { margin: 0 0 0.6rem; font-family: var(--font-display); font-size: 1.15rem; }
.card.err, .err { color: var(--mirestaurante-danger); }
.muted { color: var(--mirestaurante-muted); }
.form { display: grid; gap: 0.7rem; }
.form label { display: grid; gap: 0.25rem; font-size: 0.85rem; color: var(--mirestaurante-muted); }
.form input, .form textarea {
  font: inherit; color: inherit; padding: 0.6rem 0.75rem; border-radius: 0.65rem; resize: vertical;
  border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-surface);
}
.btn {
  min-height: 3rem; border: none; border-radius: 0.8rem; padding: 0 1.2rem; justify-self: start;
  background: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary); font-weight: 700; cursor: pointer;
}
.btn:disabled { opacity: 0.6; cursor: default; }
.link { background: none; border: 0; padding: 0; color: var(--mirestaurante-muted); cursor: pointer; font: inherit; margin-bottom: 0.5rem; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { border-bottom: 1px solid var(--mirestaurante-line); }
.list li:last-child { border-bottom: 0; }
.row { all: unset; box-sizing: border-box; width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.75rem 0; cursor: pointer; }
.row:focus-visible { outline: 2px solid var(--mirestaurante-primary); outline-offset: 2px; }
.status { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.2rem 0.55rem; border-radius: 999px; background: var(--mirestaurante-surface); white-space: nowrap; }
.status.answered { color: var(--mirestaurante-primary); }
.thread-head { display: flex; justify-content: space-between; gap: 0.75rem; align-items: flex-start; }
.thread { list-style: none; margin: 0.5rem 0 1rem; padding: 0; display: grid; gap: 0.6rem; }
.thread li { border: 1px solid var(--mirestaurante-line); border-radius: 0.75rem; padding: 0.65rem 0.8rem; background: var(--mirestaurante-surface); max-width: 92%; }
.thread li.in { margin-left: auto; }
.who { font-size: 0.75rem; color: var(--mirestaurante-muted); margin-bottom: 0.25rem; }
.thread p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
