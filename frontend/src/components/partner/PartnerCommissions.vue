<template>
  <section>
    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err" role="alert">{{ err }}</p>
    <template v-else>
      <div class="kpis">
        <div class="kpi"><b>{{ percent(d.rate) }}</b><span>Comisión actual</span></div>
        <div class="kpi"><b>{{ d.closedSales }}</b><span>Ventas cerradas</span></div>
        <div class="kpi"><b>{{ money(d.pending) }}</b><span>Por cobrar</span></div>
        <div class="kpi"><b>{{ money(d.paid) }}</b><span>Ya pagado</span></div>
        <div class="kpi"><b>{{ money(d.earned) }}</b><span>Total ganado</span></div>
      </div>

      <div class="panel">
        <h2>Tu escalera</h2>
        <p class="sub">
          Una venta cerrada es un negocio tuyo que ya pagó al menos una vez. Cada cobro paga la comisión del nivel que tengas en ese momento.
          <span v-if="d.next"> Te faltan {{ d.next.missing }} para subir a {{ percent(d.next.rate) }}.</span>
        </p>
        <ul class="rows">
          <li v-for="(t, i) in d.ladder" :key="t.from">
            <span :class="{ ok: i === current }">Nivel {{ i + 1 }} <span class="sub">· desde {{ t.from }} ventas</span></span>
            <strong :class="{ ok: i === current }">{{ percent(t.rate) }}</strong>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>Comisiones</h2>
        <p v-if="!d.commissions.length" class="muted">Cuando tus clientes paguen, aquí verás cada comisión.</p>
        <ul v-else class="rows">
          <li v-for="c in d.commissions" :key="c.id">
            <span>{{ c.businessName }} <span class="sub">· {{ money(c.amount) }} × {{ percent(c.rate) }} · {{ fmtDate(c.createdAt) }}</span></span>
            <span>
              <strong>{{ money(c.commission) }}</strong>
              <span class="pill" :class="c.status === 'paid' ? 'active' : c.status === 'void' ? 'suspended' : 'past_due'"> {{ COMMISSION_STATUS[c.status] }}</span>
            </span>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>Pagos recibidos</h2>
        <p v-if="!d.payouts.length" class="muted">Todavía no te han liquidado.</p>
        <ul v-else class="rows">
          <li v-for="p in d.payouts" :key="p.id">
            <span>{{ fmtDate(p.paidAt) }} <span class="sub">· {{ p.count }} cobros {{ p.note }}</span></span>
            <strong>{{ money(p.total) }}</strong>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { COMMISSION_STATUS, errorText, fmtDate, money, percent } from "../platform/format";

const d = ref(null);
const loading = ref(true);
const err = ref("");
const current = computed(() => d.value.ladder.filter((t) => d.value.closedSales >= t.from).length - 1);

onMounted(async () => {
  try {
    d.value = await apiService.partnerCommissions();
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar tus comisiones");
  } finally {
    loading.value = false;
  }
});
</script>
