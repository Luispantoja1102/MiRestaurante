<template>
  <div class="scrim" @click.self="$emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Ficha del cliente">
      <p v-if="loading" class="muted">Cargando…</p>
      <p v-else-if="loadErr" class="err">{{ loadErr }}</p>
      <template v-else>
        <div class="head">
          <div>
            <h2>{{ c.businessName }}</h2>
            <span class="pill" :class="c.billingStatus">{{ c.billingStatusName }}</span>
            <span class="sub"> · {{ c.planName }} · Registro {{ fmtDate(c.referredAt) }}</span>
            <div v-if="c.attention" class="sub">⚠ {{ c.attention.label }}</div>
          </div>
          <button type="button" class="btn" @click="$emit('close')">Cerrar</button>
        </div>

        <div class="panel">
          <p><strong>{{ c.ownerName || "Sin dueño" }}</strong></p>
          <p class="sub">
            <a v-if="c.ownerPhone" :href="`tel:${c.ownerPhone}`">{{ c.ownerPhone }}</a>
            <span v-if="c.ownerEmail"> · <a :href="`mailto:${c.ownerEmail}`">{{ c.ownerEmail }}</a></span>
          </p>
          <p class="sub">Último acceso: {{ fmtAgo(c.lastSeenAt) }}<span v-if="c.trialEndsAt && c.billingStatus === 'trialing'"> · prueba hasta {{ fmtDate(c.trialEndsAt) }}</span></p>
        </div>

        <div v-if="c.usage" class="stats">
          <div><b>{{ c.usersCount }}</b><span>Usuarios</span></div>
          <div><b>{{ c.usage.tables }}</b><span>Mesas</span></div>
          <div><b>{{ c.usage.foods }}</b><span>Platillos</span></div>
          <div><b>{{ c.usage.orders30d }}</b><span>Pedidos 30 d</span></div>
        </div>

        <form v-if="isOwner" class="toolbar" @submit.prevent="assign">
          <label class="inline">
            Atiende
            <select v-model="assignee">
              <option value="">Sin asignar</option>
              <option v-for="m in team.filter((x) => !x.disabled)" :key="m.id" :value="m.username">{{ m.name }} {{ m.lastName }}</option>
            </select>
          </label>
          <button type="submit" class="btn" :disabled="busy">Guardar</button>
        </form>
        <p v-else class="sub">Atiende: {{ c.assigneeName || "sin asignar" }}</p>

        <h2>Seguimiento</h2>
        <form class="form" @submit.prevent="addNote">
          <label>Nueva nota<textarea v-model="note" rows="2" maxlength="1000" placeholder="Qué hablaste, qué sigue…"></textarea></label>
          <div class="actions"><button type="submit" class="btn primary" :disabled="busy || note.trim().length < 2">Agregar nota</button></div>
        </form>
        <p v-if="msg" class="ok" role="status">{{ msg }}</p>
        <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>
        <ul class="rows">
          <li v-for="n in c.notes" :key="n.id">
            <span>{{ n.text }}</span>
            <span class="sub">{{ n.authorName }} · {{ fmtDateTime(n.createdAt) }}</span>
          </li>
          <li v-if="!c.notes.length" class="muted">Aún no hay notas.</li>
        </ul>

        <h2>Personas del negocio</h2>
        <ul class="rows">
          <li v-for="p in c.people" :key="p.id">
            <span>{{ p.name }} <span class="sub">· {{ p.role }}<span v-if="p.email"> · {{ p.email }}</span></span></span>
            <span class="sub">Entró: {{ fmtAgo(p.lastLoginAt) }}</span>
          </li>
        </ul>

        <template v-if="isOwner && c.commissions">
          <h2>Comisiones de este negocio</h2>
          <p v-if="!c.commissions.length" class="muted">Todavía no ha pagado.</p>
          <ul v-else class="rows">
            <li v-for="x in c.commissions" :key="x.id">
              <span>{{ money(x.amount) }} × {{ percent(x.rate) }} <span class="sub">· {{ fmtDate(x.createdAt) }}</span></span>
              <span><strong>{{ money(x.commission) }}</strong> <span class="pill" :class="x.status === 'paid' ? 'active' : x.status === 'void' ? 'suspended' : 'past_due'">{{ COMMISSION_STATUS[x.status] }}</span></span>
            </li>
          </ul>
        </template>
      </template>
    </aside>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { COMMISSION_STATUS, errorText, fmtAgo, fmtDate, fmtDateTime, money, percent } from "../platform/format";

const props = defineProps({ id: { type: String, required: true }, isOwner: Boolean });
const emit = defineEmits(["close", "changed"]);

const c = ref(null);
const team = ref([]);
const loading = ref(true);
const loadErr = ref("");
const note = ref("");
const assignee = ref("");
const busy = ref(false);
const msg = ref("");
const actionErr = ref("");

async function load() {
  try {
    c.value = await apiService.partnerClient(props.id);
    assignee.value = c.value.assignee || "";
  } catch (e) {
    loadErr.value = errorText(e, "No se pudo abrir el cliente");
  } finally {
    loading.value = false;
  }
}

async function run(fn, done) {
  busy.value = true;
  msg.value = "";
  actionErr.value = "";
  try {
    await fn();
    await load();
    msg.value = done;
    emit("changed");
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo guardar");
  } finally {
    busy.value = false;
  }
}

const addNote = () =>
  run(async () => {
    await apiService.partnerAddNote(props.id, note.value);
    note.value = "";
  }, "Nota agregada.");

const assign = () => run(() => apiService.partnerAssign(props.id, assignee.value || null), "Responsable guardado.");

onMounted(async () => {
  await load();
  if (props.isOwner) team.value = await apiService.partnerTeam().catch(() => []);
});
</script>
