<template>
  <section>
    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err" role="alert">{{ err }}</p>
    <template v-else>
      <div class="panel">
        <p class="sub">Tu código de vendedor</p>
        <h2><code>{{ data.partner.code }}</code></h2>
        <p v-if="data.partner.status !== 'active'" class="err">Tu código está {{ data.partner.status === 'paused' ? 'pausado' : 'en revisión' }}: los registros nuevos no lo aceptan.</p>
        <p class="sub">Comparte este enlace: quien se registre con él queda como tu cliente.</p>
        <div class="toolbar">
          <input :value="link" readonly aria-label="Enlace de registro con tu código" @focus="$event.target.select()" />
          <button type="button" class="btn" @click="copy">{{ copied ? "Copiado" : "Copiar enlace" }}</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi"><b>{{ data.counts.total }}</b><span>Clientes</span></div>
        <div class="kpi"><b>{{ data.counts.active }}</b><span>Activos</span></div>
        <div class="kpi"><b>{{ data.counts.trialing }}</b><span>En prueba</span></div>
        <div class="kpi"><b>{{ data.counts.atRisk }}</b><span>En riesgo</span></div>
        <div class="kpi"><b>{{ data.counts.mine }}</b><span>Asignados a mí</span></div>
      </div>

      <div v-if="isOwner && data.money" class="kpis">
        <div class="kpi"><b>{{ percent(data.money.rate) }}</b><span>Tu comisión actual</span></div>
        <div class="kpi"><b>{{ data.money.closedSales }}</b><span>Ventas cerradas</span></div>
        <div class="kpi"><b>{{ money(data.money.pending) }}</b><span>Por cobrar</span></div>
        <div class="kpi"><b>{{ money(data.money.paid) }}</b><span>Ya pagado</span></div>
      </div>
      <p v-if="isOwner && data.money?.next" class="sub">
        Te faltan {{ data.money.next.missing }} {{ data.money.next.missing === 1 ? "venta" : "ventas" }} para subir a {{ percent(data.money.next.rate) }}.
      </p>

      <div class="panel">
        <h2>Para atender hoy</h2>
        <p v-if="!data.attention.length" class="muted">Nada urgente. Buen trabajo.</p>
        <ul v-else class="rows">
          <li v-for="a in data.attention" :key="a.id">
            <button type="button" class="row" @click="$emit('open', a.id)">
              <span>
                <strong>{{ a.businessName }}</strong>
                <span class="sub"> · {{ a.ownerName || "Sin dueño" }}<template v-if="a.assigneeName"> · atiende {{ a.assigneeName }}</template></span>
              </span>
              <span class="pill" :class="TONE[a.attention.tone]">{{ a.attention.label }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>Últimos registros</h2>
        <p v-if="!data.newest.length" class="muted">Todavía nadie se ha registrado con tu código.</p>
        <ul v-else class="rows">
          <li v-for="c in data.newest" :key="c.id">
            <button type="button" class="row" @click="$emit('open', c.id)">
              <span><strong>{{ c.businessName }}</strong> <span class="sub">· {{ fmtDate(c.referredAt) }}</span></span>
              <span class="pill" :class="c.billingStatus">{{ c.billingStatusName }}</span>
            </button>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { apiService } from "../../apiService";
import { errorText, fmtDate, money, percent } from "../platform/format";

defineProps({ isOwner: Boolean });
defineEmits(["open"]);

const TONE = { bad: "suspended", warn: "past_due", info: "never_logged" };
const data = ref(null);
const loading = ref(true);
const err = ref("");
const copied = ref(false);
const link = computed(() => `${window.location.origin}/register?ref=${data.value?.partner.code || ""}`);

async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* el campo está seleccionable: se puede copiar a mano */
  }
}

onMounted(async () => {
  try {
    data.value = await apiService.partnerHome();
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar tu inicio");
  } finally {
    loading.value = false;
  }
});
</script>
