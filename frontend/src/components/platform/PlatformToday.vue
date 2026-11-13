<template>
  <section>
    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err">{{ err }}</p>
    <template v-else>
      <div class="kpis">
        <div class="kpi"><b>{{ data.clients.total }}</b><span>Clientes</span></div>
        <div class="kpi"><b>{{ data.clients.active }}</b><span>Activos</span></div>
        <div class="kpi"><b>{{ data.clients.trialing }}</b><span>En prueba</span></div>
        <div class="kpi"><b>{{ data.clients.pastDue }}</b><span>Pago atrasado</span></div>
        <div class="kpi"><b>{{ data.clients.suspended }}</b><span>Suspendidos</span></div>
        <div class="kpi"><b>{{ data.signupsWeek }}</b><span>Altas (7 días)</span></div>
        <div class="kpi"><b>{{ data.signupsMonth }}</b><span>Altas del mes</span></div>
        <div class="kpi" :class="{ loss: data.tickets.open > 0 }"><b>{{ data.tickets.open }}</b><span>Tickets esperando</span></div>
      </div>

      <div class="panel">
        <h2>Para atender hoy</h2>
        <p v-if="!data.attention.length" class="muted">Nada pendiente. Todo en orden.</p>
        <ul v-else class="rows">
          <li v-for="item in data.attention" :key="item.kind + item.id">
            <button type="button" class="row" @click="$emit('open', item.id)">
              <span>
                <strong>{{ item.businessName }}</strong>
                <span class="sub"> · {{ item.planName }}</span>
              </span>
              <span>
                <span class="pill" :class="item.kind">{{ item.label }}</span>
                <span v-if="item.at" class="sub"> {{ fmtDate(item.at) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="data.waiting.length" class="panel">
        <h2>Tickets esperando respuesta</h2>
        <ul class="rows">
          <li v-for="t in data.waiting" :key="t.id">
            <button type="button" class="row" @click="$emit('support')">
              <span><strong>{{ t.businessName }}</strong> <span class="sub">· {{ t.subject }}</span></span>
              <span class="sub">desde {{ fmtDateTime(t.at) }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>Movimientos del equipo</h2>
        <p v-if="!activity.length" class="muted">Todavía no hay movimientos.</p>
        <ul v-else class="rows">
          <li v-for="a in activity" :key="a.id">
            <span>
              {{ a.message }}
              <span v-if="a.businessName" class="sub"> · {{ a.businessName }}</span>
            </span>
            <span class="sub">{{ a.actor }} · {{ fmtDateTime(a.at) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { errorText, fmtDate, fmtDateTime } from "./format";

defineEmits(["open", "support"]);

const data = ref(null);
const activity = ref([]);
const loading = ref(true);
const err = ref("");

onMounted(async () => {
  try {
    const [overview, log] = await Promise.all([apiService.platformOverview(), apiService.platformActivity(15)]);
    data.value = overview;
    activity.value = log.items || [];
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar el resumen");
  } finally {
    loading.value = false;
  }
});
</script>
