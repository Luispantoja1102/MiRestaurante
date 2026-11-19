<template>
  <div class="scrim" @click.self="$emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Ficha del cliente">
      <p v-if="loading" class="muted">Cargando…</p>
      <p v-else-if="loadErr" class="err">{{ loadErr }}</p>
      <template v-else>
        <div class="head">
          <div>
            <h2>{{ client.businessName }}</h2>
            <span class="pill" :class="client.billingStatus">{{ client.billingStatusName }}</span>
            <span class="sub"> · {{ client.planName }} · Alta {{ fmtDate(client.createdAt) }}</span>
          </div>
          <button type="button" class="btn" @click="$emit('close')">Cerrar</button>
        </div>

        <div class="tabs">
          <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="select(t.id)">
            {{ t.label }}
          </button>
        </div>

        <div v-if="tab === 'summary'">
          <div v-if="client.usage" class="stats">
            <div><b>{{ client.usersCount }}</b><span>Usuarios</span></div>
            <div><b>{{ client.usage.tables }}</b><span>Mesas</span></div>
            <div><b>{{ client.usage.foods }}</b><span>Platillos</span></div>
            <div><b>{{ client.usage.orders30d }}</b><span>Pedidos 30 d</span></div>
          </div>
          <p class="sub">
            Dueño: {{ client.ownerName || "—" }}<span v-if="client.ownerEmail"> · {{ client.ownerEmail }}</span>
            · Último acceso: {{ fmtAgo(client.lastSeenAt) }}
          </p>

          <div class="panel">
            <p class="sub">
              Vendedor:
              <strong v-if="client.referrer">{{ client.referrer.name }} · <code>{{ client.referrer.code }}</code></strong>
              <span v-else>sin vendedor</span>
            </p>
            <form v-if="canEdit" class="toolbar" @submit.prevent="assignReferrer">
              <input v-model="referrerCode" placeholder="Código MR-XXXXXX" maxlength="20" aria-label="Código del vendedor" autocomplete="off" />
              <button type="submit" class="btn" :disabled="saving || !referrerCode.trim()">Asignar</button>
              <button v-if="client.referrer" type="button" class="btn danger" :disabled="saving" @click="removeReferrer">Quitar</button>
            </form>
          </div>

          <form class="form" @submit.prevent="save">
            <label>Nombre del negocio<input v-model="form.businessName" required minlength="2" :disabled="!canEdit" /></label>
            <div class="two">
              <label>Teléfono<input v-model="form.phone" :disabled="!canEdit" /></label>
              <label>Dirección<input v-model="form.address" :disabled="!canEdit" /></label>
            </div>
            <div class="two">
              <label>
                Plan
                <select v-model="form.plan" :disabled="!canEdit">
                  <option value="basic">Básico</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label>
                Estado
                <select v-model="form.billingStatus" :disabled="!canEdit">
                  <option value="trialing">Prueba</option>
                  <option value="active">Activo</option>
                  <option value="past_due">Pago atrasado</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </label>
            </div>
            <label>Fin de la prueba<input v-model="form.trialEndsOn" type="date" :disabled="!canEdit" /></label>
            <label v-if="form.billingStatus === 'suspended'">
              Motivo de la suspensión<input v-model="form.suspendedReason" maxlength="200" :disabled="!canEdit" />
            </label>
            <div v-if="canEdit" class="actions">
              <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Guardando…" : "Guardar cambios" }}</button>
              <button v-if="client.billingStatus !== 'suspended'" type="button" class="btn danger" @click="suspend">Suspender</button>
              <template v-else>
                <button type="button" class="btn" @click="reactivate('active')">Reactivar</button>
                <button type="button" class="btn ghost" @click="reactivate('trial')">Reactivar con prueba nueva</button>
              </template>
            </div>
            <p v-if="msg" class="ok" role="status">{{ msg }}</p>
            <p v-if="saveErr" class="err" role="alert">{{ saveErr }}</p>
          </form>
        </div>

        <ul v-else-if="tab === 'people'" class="rows">
          <li v-for="u in client.users" :key="u.id">
            <span>
              <strong>{{ u.name }} {{ u.lastName }}</strong>
              <span class="sub"> · {{ ROLE_NAMES[u.role] || u.role }}</span>
              <div class="sub">{{ u.username }}<span v-if="u.email"> · {{ u.email }}</span></div>
            </span>
            <span class="sub">Entró: {{ fmtAgo(u.lastLoginAt) }}</span>
          </li>
          <li v-if="!client.users.length" class="muted">Este negocio no tiene usuarios.</li>
        </ul>

        <div v-else-if="tab === 'support'">
          <p v-if="!tickets.length && ticketsLoaded" class="muted">Este negocio no tiene tickets.</p>
          <ul class="rows">
            <li v-for="t in tickets" :key="t.id">
              <button type="button" class="row" @click="openTicketId = t.id">
                <span><strong>{{ t.subject }}</strong> <span class="sub">· {{ t.messages.length }} mensajes · {{ fmtDateTime(t.updatedAt) }}</span></span>
                <span class="pill" :class="TICKET_PILL[t.status]">{{ TICKET_STATUS[t.status] }}</span>
              </button>
            </li>
          </ul>
          <form class="form" @submit.prevent="createTicket">
            <h2>Escribirle al cliente</h2>
            <p class="sub">Abre un ticket dirigido al dueño del negocio. Él lo ve en su cuenta (Soporte) y, si hay correo configurado, también le llega un aviso.</p>
            <label>Asunto<input v-model="ticketDraft.subject" required minlength="3" maxlength="120" /></label>
            <label>Mensaje<textarea v-model="ticketDraft.message" rows="3" required maxlength="4000"></textarea></label>
            <div class="actions"><button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Enviando…" : "Abrir ticket" }}</button></div>
            <p v-if="saveErr" class="err" role="alert">{{ saveErr }}</p>
          </form>
        </div>

        <form v-else-if="tab === 'payment'" class="form" @submit.prevent="pay">
          <p class="sub">
            Para un pago recibido fuera de la app (transferencia, efectivo). Activa el negocio y extiende su periodo pagado
            desde el fin del periodo vigente, o desde hoy si ya venció.
            <span v-if="client.currentPeriodEnd"> Hoy paga hasta {{ fmtDate(client.currentPeriodEnd) }}.</span>
          </p>
          <div class="two">
            <label>Monto cobrado (MXN)<input v-model.number="payment.amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Meses que cubre<input v-model.number="payment.months" type="number" min="1" max="36" step="1" required /></label>
          </div>
          <label>Nota (opcional)<input v-model="payment.note" maxlength="200" placeholder="Transferencia SPEI, efectivo…" /></label>
          <div class="actions">
            <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Registrando…" : "Registrar pago" }}</button>
          </div>
          <p v-if="msg" class="ok" role="status">{{ msg }}</p>
          <p v-if="saveErr" class="err" role="alert">{{ saveErr }}</p>
        </form>

        <ul v-else class="rows">
          <li v-for="a in activity" :key="a.id">
            <span>
              {{ a.message }}
              <strong v-if="a.amount != null"> · {{ money(a.amount) }}</strong>
            </span>
            <span class="sub">{{ a.actor }} · {{ fmtDateTime(a.at) }}</span>
          </li>
          <li v-if="activityLoaded && !activity.length" class="muted">El equipo aún no ha hecho cambios en este cliente.</li>
        </ul>
      </template>
    </aside>
    <TicketPane v-if="openTicketId" :id="openTicketId" :business-name="client?.businessName || ''" @close="openTicketId = ''" @changed="loadTickets" />
  </div>
</template>

<script setup>
import { askText } from "../../dialog";
import { computed, onMounted, reactive, ref } from "vue";
import { apiService } from "../../apiService";
import TicketPane from "./TicketPane.vue";
import { errorText, fmtAgo, fmtDate, fmtDateTime, money, ROLE_NAMES, TICKET_PILL, TICKET_STATUS } from "./format";

const props = defineProps({ id: { type: String, required: true }, canEdit: Boolean });
const emit = defineEmits(["close", "changed"]);

const client = ref(null);
const loading = ref(true);
const loadErr = ref("");
const tab = ref("summary");
const activity = ref([]);
const activityLoaded = ref(false);
const saving = ref(false);
const msg = ref("");
const saveErr = ref("");
const form = reactive({ businessName: "", phone: "", address: "", plan: "basic", billingStatus: "trialing", trialEndsOn: "", suspendedReason: "" });

const payment = reactive({ amount: null, months: 1, note: "" });
const referrerCode = ref("");
const tickets = ref([]);
const ticketsLoaded = ref(false);
const openTicketId = ref("");
const ticketDraft = reactive({ subject: "", message: "" });

const tabs = computed(() => [
  { id: "summary", label: "Resumen" },
  { id: "people", label: `Personas (${client.value?.users?.length ?? 0})` },
  { id: "support", label: "Soporte" },
  ...(props.canEdit ? [{ id: "payment", label: "Cobro" }] : []),
  { id: "activity", label: "Actividad" },
]);

function fill(c) {
  client.value = c;
  Object.assign(form, {
    businessName: c.businessName,
    phone: c.phone,
    address: c.address,
    plan: c.plan,
    billingStatus: c.billingStatus,
    trialEndsOn: c.trialEndsOn,
    suspendedReason: c.suspendedReason,
  });
}

async function load() {
  try {
    fill(await apiService.platformGetTenant(props.id));
  } catch (e) {
    loadErr.value = errorText(e, "No se pudo abrir el cliente");
  } finally {
    loading.value = false;
  }
}

async function select(id) {
  tab.value = id;
  msg.value = "";
  saveErr.value = "";
  if (id === "support") await loadTickets();
  if (id === "activity" && !activityLoaded.value) {
    try {
      activity.value = (await apiService.platformTenantActivity(props.id)).items || [];
    } catch {
      activity.value = [];
    }
    activityLoaded.value = true;
  }
}

async function run(fn, done) {
  saving.value = true;
  msg.value = "";
  saveErr.value = "";
  try {
    await fn();
    fill(await apiService.platformGetTenant(props.id));
    activityLoaded.value = false;
    msg.value = done;
    emit("changed");
  } catch (e) {
    saveErr.value = errorText(e, "No se pudo guardar");
  } finally {
    saving.value = false;
  }
}

const pay = () =>
  run(async () => {
    await apiService.platformManualPayment(props.id, { ...payment });
    Object.assign(payment, { amount: null, months: 1, note: "" });
  }, "Pago registrado. El negocio quedó activo.");

async function loadTickets() {
  tickets.value = await apiService.platformTenantTickets(props.id).catch(() => []);
  ticketsLoaded.value = true;
}

async function createTicket() {
  saving.value = true;
  saveErr.value = "";
  try {
    const ticket = await apiService.platformCreateTicket(props.id, { ...ticketDraft });
    Object.assign(ticketDraft, { subject: "", message: "" });
    await loadTickets();
    openTicketId.value = ticket.id;
    emit("changed");
  } catch (e) {
    saveErr.value = errorText(e, "No se pudo abrir el ticket");
  } finally {
    saving.value = false;
  }
}

const assignReferrer = () =>
  run(async () => {
    await apiService.platformSetTenantReferrer(props.id, referrerCode.value.trim());
    referrerCode.value = "";
  }, "Vendedor asignado.");

const removeReferrer = () => run(() => apiService.platformSetTenantReferrer(props.id, null), "Vendedor quitado.");

const save = () => run(() => apiService.platformUpdateTenant(props.id, { ...form }), "Cambios guardados.");

async function suspend() {
  const reason = await askText("Motivo de la suspensión", "manual", { title: "Suspender negocio", confirmText: "Suspender" });
  if (reason === null) return;
  return run(() => apiService.platformSuspendTenant(props.id, reason || "manual"), "Negocio suspendido.");
}

const reactivate = (mode) => run(() => apiService.platformReactivateTenant(props.id, mode), "Negocio reactivado.");

onMounted(load);
</script>
