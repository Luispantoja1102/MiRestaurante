<template>
  <section>
    <div class="toolbar">
      <label class="inline">
        Mes
        <input v-model="month" type="month" :max="currentMonth" required aria-label="Mes a consultar" />
      </label>
      <button v-for="s in SECTIONS" :key="s.id" type="button" class="btn chip" :class="{ on: section === s.id }" @click="section = s.id">
        {{ s.label }}
      </button>
      <button type="button" class="btn" :disabled="downloading || !books" @click="downloadCsv">
        {{ downloading ? "Preparando…" : "Descargar cobros (CSV)" }}
      </button>
    </div>

    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <p v-if="loading && !books" class="muted">Cargando números…</p>
    <template v-else-if="books">
      <div class="kpis">
        <div class="kpi"><b>{{ money(books.collected) }}</b><span>Cobrado en el mes</span></div>
        <div class="kpi"><b>{{ money(books.expected) }}</b><span>Esperado (planes activos)</span></div>
        <div class="kpi"><b>{{ money(books.expensesTotal) }}</b><span>Gastos</span></div>
        <div class="kpi"><b>{{ money(books.commissions.total) }}</b><span>Comisiones de vendedores</span></div>
        <div class="kpi" :class="{ loss: books.profit < 0 }"><b>{{ money(books.profit) }}</b><span>Utilidad</span></div>
        <div v-if="books.partners > 1" class="kpi">
          <b>{{ money(books.profitPerPartner) }}</b><span>Utilidad por socio ({{ books.partners }})</span>
        </div>
      </div>

      <div v-if="section === 'income'">
        <div class="panel">
          <h2>Últimos 6 meses</h2>
          <TrendChart :trend="books.trend" />
        </div>
        <div class="panel">
          <h2>Por plan</h2>
          <ul class="rows">
            <li v-for="p in books.byPlan" :key="p.id">
              <span><strong>{{ p.name }}</strong> <span class="sub">· {{ p.clients }} activos · {{ money(p.price) }} al mes</span></span>
              <strong>{{ money(p.amount) }}</strong>
            </li>
          </ul>
        </div>
        <div class="panel">
          <h2>Quién está pagando</h2>
          <p v-if="!books.payers.length" class="muted">Todavía no hay planes activos.</p>
          <ul v-else class="rows">
            <li v-for="p in books.payers" :key="p.id">
              <span>{{ p.businessName }} <span class="sub">· {{ p.planName }}</span></span>
              <strong>{{ money(p.amount) }}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div v-else-if="section === 'payments'" class="panel">
        <h2>Cobros del mes</h2>
        <p class="sub">Lo realmente cobrado. Hoy se registran a mano desde la ficha del cliente.</p>
        <p v-if="!books.payments.length" class="muted">No hay cobros registrados en este mes.</p>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Negocio</th><th>Plan</th><th>Meses</th><th>Nota</th><th>Monto</th></tr></thead>
            <tbody>
              <tr v-for="p in books.payments" :key="p.id">
                <td>{{ fmtDate(p.at) }}</td>
                <td>{{ p.businessName }}</td>
                <td>{{ p.planName || "—" }}</td>
                <td>{{ p.months || "—" }}</td>
                <td class="muted">{{ p.note }}</td>
                <td><strong>{{ money(p.amount) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="panel">
        <h2>Gastos</h2>
        <form class="form" @submit.prevent="addExpense">
          <div class="two">
            <label>Qué gasto es<input v-model="draft.label" required minlength="2" maxlength="80" placeholder="Hosting, dominio, publicidad…" /></label>
            <label>Monto (MXN)<input v-model.number="draft.amount" type="number" min="0.01" step="0.01" required /></label>
          </div>
          <label>Nota (opcional)<input v-model="draft.note" maxlength="200" /></label>
          <div class="actions">
            <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Guardando…" : "Anotar gasto" }}</button>
          </div>
        </form>
        <p class="sub">Los gastos nuevos se anotan en el mes en curso.</p>
        <p v-if="!books.expenses.length" class="muted">No hay gastos en este mes.</p>
        <ul v-else class="rows">
          <li v-for="e in books.expenses" :key="e.id">
            <span>{{ e.label }}<span v-if="e.note" class="sub"> · {{ e.note }}</span></span>
            <span>
              <strong>{{ money(e.amount) }}</strong>
              <button type="button" class="btn danger" @click="removeExpense(e)">Quitar</button>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { apiService } from "../../apiService";
import TrendChart from "./TrendChart.vue";
import { errorText, fmtDate, money } from "./format";

const SECTIONS = [
  { id: "income", label: "Ingresos" },
  { id: "payments", label: "Cobros" },
  { id: "expenses", label: "Gastos" },
];

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const month = ref(currentMonth);
const section = ref("income");
const books = ref(null);
const loading = ref(true);
const err = ref("");
const saving = ref(false);
const downloading = ref(false);
const draft = reactive({ label: "", amount: null, note: "" });

const validMonth = computed(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(month.value));

async function load() {
  if (!validMonth.value) return;
  loading.value = true;
  err.value = "";
  try {
    books.value = await apiService.platformFinance(month.value);
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar las finanzas");
  } finally {
    loading.value = false;
  }
}

async function addExpense() {
  saving.value = true;
  err.value = "";
  try {
    await apiService.platformCreateExpense({ label: draft.label, amount: draft.amount, note: draft.note });
    Object.assign(draft, { label: "", amount: null, note: "" });
    month.value = currentMonth; // el gasto cae en el mes en curso
    await load();
  } catch (e) {
    err.value = errorText(e, "No se pudo guardar el gasto");
  } finally {
    saving.value = false;
  }
}

async function removeExpense(e) {
  if (!window.confirm(`¿Quitar el gasto «${e.label}»?`)) return;
  try {
    await apiService.platformDeleteExpense(e.id);
    await load();
  } catch (error) {
    err.value = errorText(error, "No se pudo quitar el gasto");
  }
}

async function downloadCsv() {
  downloading.value = true;
  try {
    const blob = await apiService.platformFinanceCsv(month.value);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cobros_${month.value}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    err.value = errorText(e, "No se pudo preparar el archivo");
  } finally {
    downloading.value = false;
  }
}

watch(month, load);
onMounted(load);
</script>
