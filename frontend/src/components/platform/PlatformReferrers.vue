<template>
  <section>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="Buscar por nombre, correo o código" aria-label="Buscar vendedores" />
      <button type="button" class="btn primary" @click="dialog = true">Nuevo vendedor</button>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err" role="alert">{{ err }}</p>
    <template v-else>
      <div class="panel">
        <h2>Mi código de vendedor</h2>
        <template v-if="mine">
          <p><code>{{ mine.code }}</code> <span class="sub">· {{ percent(mine.rate) }} de comisión · {{ mine.closedSales }} ventas cerradas · {{ money(mine.pending) }} por cobrar · {{ money(mine.earned) }} ganado</span></p>
          <p class="sub">Con este enlace, quien se registre queda como tu cliente.</p>
          <div class="toolbar">
            <input :value="myLink" readonly aria-label="Tu enlace de registro con tu código" @focus="$event.target.select()" />
            <button type="button" class="btn" @click="copyLink">{{ copied ? "Copiado" : "Copiar enlace" }}</button>
            <button type="button" class="btn" @click="openId = mine.id">Ver mi ficha</button>
          </div>
        </template>
        <template v-else>
          <p class="sub">Activa tu propio código para referir negocios y ganar comisión como cualquier vendedor. Se crea con el nombre y el correo de tu cuenta.</p>
          <div class="actions">
            <button type="button" class="btn primary" :disabled="activating" @click="activate">{{ activating ? "Activando…" : "Activar mi código" }}</button>
          </div>
        </template>
        <p v-if="mineErr" class="err" role="alert">{{ mineErr }}</p>
      </div>

      <div class="kpis">
        <div class="kpi"><b>{{ data.totals.sellers }}</b><span>Vendedores</span></div>
        <div class="kpi"><b>{{ data.totals.clients }}</b><span>Negocios referidos</span></div>
        <div class="kpi"><b>{{ money(data.totals.pending) }}</b><span>Comisiones por pagar</span></div>
        <div class="kpi"><b>{{ money(data.totals.paid) }}</b><span>Comisiones pagadas</span></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Vendedor</th><th>Código</th><th>Estado</th><th>Negocios</th><th>Ventas cerradas</th><th>Por pagar</th><th>Pagado</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" class="click" tabindex="0" @click="openId = r.id" @keydown.enter="openId = r.id">
              <td><strong>{{ r.name }}</strong> <span v-if="mine && r.id === mine.id" class="pill">Tú</span><div class="sub">{{ r.email }}</div></td>
              <td><code>{{ r.code }}</code></td>
              <td><span class="pill" :class="r.status === 'active' ? 'active' : 'past_due'">{{ REFERRER_STATUS[r.status] }}</span></td>
              <td>{{ r.clients }} <span class="sub">({{ r.activeClients }} activos)</span></td>
              <td>{{ r.closedSales }} <span class="sub">· {{ percent(r.rate) }}</span></td>
              <td>{{ money(r.pending) }}</td>
              <td>{{ money(r.paid) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!shown.length" class="empty">{{ data.items.length ? "Ningún vendedor coincide." : "Todavía no hay vendedores. Crea el primero." }}</p>
      </div>
    </template>

    <div v-if="dialog" class="scrim center" @click.self="dialog = false">
      <form class="dialog form" role="dialog" aria-modal="true" aria-label="Nuevo vendedor" @submit.prevent="create">
        <h2>Nuevo vendedor</h2>
        <label>Nombre completo<input v-model="draft.name" required minlength="2" /></label>
        <div class="two">
          <label>Correo<input v-model="draft.email" type="email" required /></label>
          <label>Teléfono<input v-model="draft.phone" inputmode="tel" /></label>
        </div>
        <div class="two">
          <label>Estado<input v-model="draft.state" /></label>
          <label>Ciudad<input v-model="draft.city" /></label>
        </div>
        <label class="inline"><input v-model="withAccess" type="checkbox" /> Darle acceso al portal de socios</label>
        <div v-if="withAccess" class="two">
          <label>Usuario<input v-model="access.username" required pattern="[A-Za-z0-9._\-]{3,40}" autocomplete="off" /></label>
          <label>Contraseña inicial<input v-model="access.password" type="password" required minlength="8" autocomplete="new-password" /></label>
        </div>
        <p v-if="formErr" class="err" role="alert">{{ formErr }}</p>
        <div class="actions">
          <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Creando…" : "Crear vendedor" }}</button>
          <button type="button" class="btn" @click="dialog = false">Cancelar</button>
        </div>
      </form>
    </div>

    <ReferrerPanel v-if="openId" :id="openId" @close="openId = ''" @changed="load" />
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { apiService } from "../../apiService";
import ReferrerPanel from "./ReferrerPanel.vue";
import { errorText, money, percent, REFERRER_STATUS } from "./format";

const data = ref(null);
const loading = ref(true);
const err = ref("");
const query = ref("");
const openId = ref("");
const dialog = ref(false);
const saving = ref(false);
const formErr = ref("");
const withAccess = ref(true);
const blank = () => ({ name: "", email: "", phone: "", state: "", city: "" });
const draft = reactive(blank());
const access = reactive({ username: "", password: "" });

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (data.value?.items || []).filter((r) => !q || [r.name, r.email, r.code].some((v) => String(v || "").toLowerCase().includes(q)));
});

const mine = ref(null);
const mineErr = ref("");
const activating = ref(false);
const copied = ref(false);
const myLink = computed(() => `${window.location.origin}/register?ref=${mine.value?.code || ""}`);

async function activate() {
  activating.value = true;
  mineErr.value = "";
  try {
    const res = await apiService.platformActivateMySeller();
    mine.value = res.seller;
    await load();
  } catch (e) {
    mineErr.value = errorText(e, "No se pudo activar tu código");
  } finally {
    activating.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(myLink.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* el campo está seleccionable: se puede copiar a mano */
  }
}

async function load() {
  try {
    const [list, me] = await Promise.all([apiService.platformListReferrers(), apiService.platformMySeller().catch(() => null)]);
    data.value = list;
    mine.value = me?.seller || null;
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar los vendedores");
  } finally {
    loading.value = false;
  }
}

async function create() {
  saving.value = true;
  formErr.value = "";
  try {
    const created = await apiService.platformCreateReferrer({ ...draft, ...(withAccess.value ? { access: { ...access } } : {}) });
    Object.assign(draft, blank());
    Object.assign(access, { username: "", password: "" });
    dialog.value = false;
    await load();
    openId.value = created.id;
  } catch (e) {
    formErr.value = errorText(e, "No se pudo crear el vendedor");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
