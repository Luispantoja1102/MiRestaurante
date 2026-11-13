<template>
  <section>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="Buscar por negocio, dueño o correo" aria-label="Buscar clientes" />
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.id"
        type="button"
        class="btn chip"
        :class="{ on: filter === f.id }"
        @click="filter = f.id"
      >
        {{ f.label }} <span class="muted">{{ counts[f.id] }}</span>
      </button>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err">{{ err }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Negocio</th>
            <th>Plan</th>
            <th>Estado</th>
            <th>Prueba hasta</th>
            <th>Último acceso</th>
            <th>Usuarios</th>
            <th>Alta</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in shown" :key="t.id" class="click" tabindex="0" @click="open(t.id)" @keydown.enter="open(t.id)">
            <td>
              <strong>{{ t.businessName }}</strong>
              <span v-if="t.waiting" class="pill past_due" :title="`${t.waiting} ticket(s) esperando respuesta`"> {{ t.waiting }} ticket{{ t.waiting === 1 ? "" : "s" }}</span>
              <div class="sub">{{ t.ownerName || "Sin dueño" }}<span v-if="t.ownerEmail"> · {{ t.ownerEmail }}</span></div>
            </td>
            <td>{{ t.planName }}</td>
            <td><span class="pill" :class="t.billingStatus">{{ t.billingStatusName }}</span></td>
            <td>{{ t.billingStatus === "trialing" ? fmtDate(t.trialEndsAt) : "—" }}</td>
            <td>{{ fmtAgo(t.lastSeenAt) }}</td>
            <td>{{ t.usersCount }}</td>
            <td>{{ fmtDate(t.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!shown.length" class="empty">{{ tenants.length ? "Ningún cliente coincide con la búsqueda." : "No hay clientes aún." }}</p>
    </div>

    <ClientPanel v-if="openId" :id="openId" :can-edit="canEdit" @close="close" @changed="load" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { apiService } from "../../apiService";
import ClientPanel from "./ClientPanel.vue";
import { errorText, fmtAgo, fmtDate, STATUS_FILTERS } from "./format";

const props = defineProps({ canEdit: Boolean, focusId: { type: String, default: "" } });

const tenants = ref([]);
const loading = ref(true);
const err = ref("");
const query = ref("");
const filter = ref("all");
const openId = ref(props.focusId);

const counts = computed(() => {
  const out = { all: tenants.value.length, trialing: 0, active: 0, past_due: 0, suspended: 0 };
  for (const t of tenants.value) if (t.billingStatus in out) out[t.billingStatus] += 1;
  return out;
});

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return tenants.value.filter((t) => {
    if (filter.value !== "all" && t.billingStatus !== filter.value) return false;
    if (!q) return true;
    return [t.businessName, t.ownerName, t.ownerEmail, t.ownerUsername].some((v) => String(v || "").toLowerCase().includes(q));
  });
});

async function load() {
  err.value = "";
  try {
    tenants.value = await apiService.platformListTenants();
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar los clientes");
  } finally {
    loading.value = false;
  }
}

const open = (id) => (openId.value = id);
const close = () => (openId.value = "");
watch(() => props.focusId, (id) => id && (openId.value = id));
onMounted(load);
</script>
