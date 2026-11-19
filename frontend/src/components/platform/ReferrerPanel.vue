<template>
  <div class="scrim" @click.self="$emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Ficha del vendedor">
      <p v-if="loading" class="muted">Cargando…</p>
      <p v-else-if="loadErr" class="err">{{ loadErr }}</p>
      <template v-else>
        <div class="head">
          <div>
            <h2>{{ r.name }}</h2>
            <code>{{ r.code }}</code>
            <span class="pill" :class="r.status === 'active' ? 'active' : 'past_due'"> {{ REFERRER_STATUS[r.status] }}</span>
            <div class="sub">
              Nivel {{ r.tier + 1 }} · {{ percent(r.rate) }} de comisión · {{ r.closedSales }} ventas cerradas
              <span v-if="r.next"> · le faltan {{ r.next.missing }} para {{ percent(r.next.rate) }}</span>
            </div>
          </div>
          <button type="button" class="btn" @click="$emit('close')">Cerrar</button>
        </div>

        <div class="tabs">
          <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="select(t.id)">{{ t.label }}</button>
        </div>

        <div v-if="tab === 'summary'">
          <div class="stats">
            <div><b>{{ r.clients }}</b><span>Negocios</span></div>
            <div><b>{{ r.activeClients }}</b><span>Activos</span></div>
            <div><b>{{ money(r.pending) }}</b><span>Por pagar</span></div>
            <div><b>{{ money(r.paid) }}</b><span>Pagado</span></div>
          </div>
          <form class="form" @submit.prevent="save">
            <label>Nombre<input v-model="form.name" required minlength="2" /></label>
            <div class="two">
              <label>Correo<input v-model="form.email" type="email" required /></label>
              <label>Teléfono<input v-model="form.phone" /></label>
            </div>
            <div class="two">
              <label>Estado<input v-model="form.state" /></label>
              <label>Ciudad<input v-model="form.city" /></label>
            </div>
            <h2>Datos para pagarle</h2>
            <div class="two">
              <label>Titular<input v-model="form.payoutHolder" /></label>
              <label>Banco<input v-model="form.payoutBank" /></label>
            </div>
            <label>CLABE (18 dígitos)<input v-model="form.payoutClabe" inputmode="numeric" maxlength="18" /></label>
            <label>Notas internas<input v-model="form.notes" maxlength="300" /></label>
            <div class="actions">
              <button type="submit" class="btn primary" :disabled="busy">{{ busy ? "Guardando…" : "Guardar cambios" }}</button>
              <button v-if="r.status === 'active'" type="button" class="btn danger" @click="setStatus('paused')">Pausar</button>
              <button v-else type="button" class="btn" @click="setStatus('active')">Activar</button>
            </div>
            <p v-if="msg" class="ok" role="status">{{ msg }}</p>
            <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>
          </form>
        </div>

        <div v-else-if="tab === 'clients'">
          <p v-if="!r.clientsList.length" class="muted">Todavía no hay negocios con este código.</p>
          <ul v-else class="rows">
            <li v-for="c in r.clientsList" :key="c.id">
              <span><strong>{{ c.businessName }}</strong> <span class="sub">· desde {{ fmtDate(c.referredAt) }}</span></span>
              <span><span class="pill" :class="c.billingStatus">{{ BILLING_NAMES[c.billingStatus] }}</span> <strong>{{ money(c.billed) }}</strong></span>
            </li>
          </ul>
        </div>

        <div v-else-if="tab === 'commissions'">
          <div class="panel">
            <p><strong>{{ money(r.pending) }}</strong> por pagar en {{ r.pendingCount }} {{ r.pendingCount === 1 ? "cobro" : "cobros" }}.</p>
            <div class="form">
              <label>Nota del pago (opcional)<input v-model="payNote" maxlength="200" placeholder="SPEI, referencia…" /></label>
              <div class="actions">
                <button type="button" class="btn primary" :disabled="busy || !r.pendingCount" @click="payOut">Liquidar lo pendiente</button>
              </div>
            </div>
            <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>
          </div>
          <h2>Comisiones</h2>
          <p v-if="!r.commissions.length" class="muted">Aún no hay cobros de sus negocios.</p>
          <ul v-else class="rows">
            <li v-for="c in r.commissions" :key="c.id">
              <span>
                {{ c.businessName }} <span class="sub">· {{ money(c.amount) }} × {{ percent(c.rate) }} · {{ fmtDate(c.createdAt) }}</span>
              </span>
              <span>
                <strong>{{ money(c.commission) }}</strong>
                <span class="pill" :class="c.status === 'pending' ? 'past_due' : c.status === 'paid' ? 'active' : 'suspended'"> {{ COMMISSION_STATUS[c.status] }}</span>
                <button v-if="c.status === 'pending'" type="button" class="btn danger" @click="voidIt(c)">Anular</button>
              </span>
            </li>
          </ul>
          <h2>Pagos hechos</h2>
          <p v-if="!r.payouts.length" class="muted">Todavía no se le ha liquidado nada.</p>
          <ul v-else class="rows">
            <li v-for="p in r.payouts" :key="p.id">
              <span>{{ fmtDate(p.paidAt) }} <span class="sub">· {{ p.count }} cobros · {{ p.by }} {{ p.note }}</span></span>
              <strong>{{ money(p.total) }}</strong>
            </li>
          </ul>
        </div>

        <div v-else>
          <p class="sub">Cuentas con las que entra al portal de socios. El dueño ve el dinero y maneja a su equipo; el asesor solo atiende negocios.</p>
          <ul class="rows">
            <li v-for="u in users" :key="u.id">
              <span>
                <strong>{{ u.name }} {{ u.lastName }}</strong> <span class="sub">· {{ u.roleName }} · {{ u.username }}</span>
                <span v-if="u.disabled" class="pill suspended"> Desactivado</span>
              </span>
              <button type="button" class="btn" :class="{ danger: !u.disabled }" @click="toggleUser(u)">{{ u.disabled ? "Reactivar" : "Desactivar" }}</button>
            </li>
            <li v-if="!users.length" class="muted">Este vendedor aún no tiene acceso al portal.</li>
          </ul>
          <form class="form" @submit.prevent="addUser">
            <h2>Dar acceso</h2>
            <div class="two">
              <label>Nombre<input v-model="user.name" required minlength="2" /></label>
              <label>Apellido<input v-model="user.lastName" /></label>
            </div>
            <label>Correo<input v-model="user.email" type="email" required /></label>
            <div class="two">
              <label>Usuario<input v-model="user.username" required pattern="[A-Za-z0-9._\-]{3,40}" autocomplete="off" /></label>
              <label>Contraseña inicial<input v-model="user.password" type="password" required minlength="8" autocomplete="new-password" /></label>
            </div>
            <label>Rol<select v-model="user.role"><option value="partner_admin">Dueño</option><option value="partner_staff">Asesor</option></select></label>
            <div class="actions"><button type="submit" class="btn primary" :disabled="busy">Crear acceso</button></div>
            <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>
          </form>
        </div>
      </template>
    </aside>
  </div>
</template>

<script setup>
import { askConfirm, askText } from "../../dialog";
import { computed, onMounted, reactive, ref } from "vue";
import { apiService } from "../../apiService";
import { BILLING_NAMES, COMMISSION_STATUS, errorText, fmtDate, money, percent, REFERRER_STATUS } from "./format";

const props = defineProps({ id: { type: String, required: true } });
const emit = defineEmits(["close", "changed"]);

const r = ref(null);
const loading = ref(true);
const loadErr = ref("");
const tab = ref("summary");
const busy = ref(false);
const msg = ref("");
const actionErr = ref("");
const payNote = ref("");
const users = ref([]);
const form = reactive({ name: "", email: "", phone: "", state: "", city: "", payoutHolder: "", payoutBank: "", payoutClabe: "", notes: "" });
const user = reactive({ name: "", lastName: "", email: "", username: "", password: "", role: "partner_admin" });

const tabs = computed(() => [
  { id: "summary", label: "Resumen" },
  { id: "clients", label: `Negocios (${r.value?.clients ?? 0})` },
  { id: "commissions", label: "Comisiones" },
  { id: "access", label: "Accesos" },
]);

function fill(detail) {
  r.value = detail;
  for (const key of Object.keys(form)) form[key] = detail[key] || "";
}

async function load() {
  try {
    fill(await apiService.platformGetReferrer(props.id));
  } catch (e) {
    loadErr.value = errorText(e, "No se pudo abrir el vendedor");
  } finally {
    loading.value = false;
  }
}

async function select(id) {
  tab.value = id;
  msg.value = "";
  actionErr.value = "";
  if (id === "access") users.value = await apiService.platformReferrerUsers(props.id).catch(() => []);
}

async function run(fn, done) {
  busy.value = true;
  msg.value = "";
  actionErr.value = "";
  try {
    const result = await fn();
    if (result?.id === props.id) fill(result);
    else fill(await apiService.platformGetReferrer(props.id));
    msg.value = done || "";
    emit("changed");
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo completar la acción");
  } finally {
    busy.value = false;
  }
}

const save = () => run(() => apiService.platformUpdateReferrer(props.id, { ...form }), "Cambios guardados.");
const setStatus = (status) => run(() => apiService.platformUpdateReferrer(props.id, { status }), status === "paused" ? "Vendedor pausado: su código ya no sirve." : "Vendedor activo.");

async function payOut() {
  if (!(await askConfirm(`¿Marcar como pagados ${money(r.value.pending)}?`, { title: "Registrar pago", confirmText: "Marcar pagado" }))) return;
  return run(async () => {
    const detail = await apiService.platformPayReferrer(props.id, payNote.value);
    payNote.value = "";
    return detail;
  });
}

async function voidIt(c) {
  const reason = await askText("Motivo de la anulación", "cobro devuelto", { title: "Anular comisión", confirmText: "Anular" });
  if (reason === null) return;
  return run(() => apiService.platformVoidCommission(c.id, reason));
}

async function toggleUser(u) {
  actionErr.value = "";
  try {
    users.value = await apiService.platformSetReferrerUserActive(props.id, u.id, u.disabled);
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo cambiar el acceso");
  }
}

async function addUser() {
  busy.value = true;
  actionErr.value = "";
  try {
    await apiService.platformCreateReferrerUser(props.id, { ...user });
    Object.assign(user, { name: "", lastName: "", email: "", username: "", password: "", role: "partner_admin" });
    users.value = await apiService.platformReferrerUsers(props.id);
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo crear el acceso");
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>
