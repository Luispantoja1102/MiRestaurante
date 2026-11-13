<template>
  <section>
    <div class="toolbar">
      <input v-model="query" type="search" placeholder="Buscar por negocio, dueño o correo" aria-label="Buscar clientes" />
      <label class="inline"><input v-model="onlyMine" type="checkbox" /> Solo los míos</label>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err" role="alert">{{ err }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th>Negocio</th><th>Estado</th><th>Atención</th><th>Último acceso</th><th>Atiende</th><th>Registro</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in shown" :key="c.id" class="click" tabindex="0" @click="openId = c.id" @keydown.enter="openId = c.id">
            <td><strong>{{ c.businessName }}</strong><div class="sub">{{ c.ownerName || "Sin dueño" }}<span v-if="c.ownerEmail"> · {{ c.ownerEmail }}</span></div></td>
            <td><span class="pill" :class="c.billingStatus">{{ c.billingStatusName }}</span></td>
            <td><span v-if="c.attention" class="pill" :class="TONE[c.attention.tone]">{{ c.attention.label }}</span><span v-else class="muted">—</span></td>
            <td>{{ fmtAgo(c.lastSeenAt) }}</td>
            <td>{{ c.assigneeName || "—" }}</td>
            <td>{{ fmtDate(c.referredAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!shown.length" class="empty">{{ clients.length ? "Ningún cliente coincide." : "Todavía nadie se ha registrado con tu código." }}</p>
    </div>

    <PartnerClientPanel v-if="openId" :id="openId" :is-owner="isOwner" @close="openId = ''" @changed="load" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { apiService } from "../../apiService";
import { authStore } from "../../authStore";
import PartnerClientPanel from "./PartnerClientPanel.vue";
import { errorText, fmtAgo, fmtDate } from "../platform/format";

const props = defineProps({ isOwner: Boolean, focusId: { type: String, default: "" } });

const TONE = { bad: "suspended", warn: "past_due", info: "never_logged" };
const clients = ref([]);
const loading = ref(true);
const err = ref("");
const query = ref("");
const onlyMine = ref(false);
const openId = ref(props.focusId);

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return clients.value.filter((c) => {
    if (onlyMine.value && c.assignee !== authStore.username) return false;
    return !q || [c.businessName, c.ownerName, c.ownerEmail].some((v) => String(v || "").toLowerCase().includes(q));
  });
});

async function load() {
  try {
    clients.value = await apiService.partnerClients();
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar tus clientes");
  } finally {
    loading.value = false;
  }
}

watch(() => props.focusId, (id) => id && (openId.value = id));
onMounted(load);
</script>
