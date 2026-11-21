<template>
  <div class="tk-view">
    <div class="tk-bar">
      <button type="button" class="tk-btn" title="Cerrar (Esc)" @click="close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        Cerrar
      </button>
      <div class="tk-bar-title">
        <strong>{{ order ? `${kitchen ? "Comanda" : "Cuenta"} #${folio}` : kitchen ? "Comanda" : "Cuenta" }}</strong>
        <small v-if="order">{{ kitchen ? `${badge.top} ${badge.main} · ${countText}` : `${statusText} · ${money(t.total)}` }}</small>
      </div>
      <div class="tk-seg" role="group" aria-label="Ancho del papel">
        <button type="button" :aria-pressed="paper === '80'" @click="setPaper('80')">80<span class="tk-mm"> mm</span></button>
        <button type="button" :aria-pressed="paper === '58'" @click="setPaper('58')">58<span class="tk-mm"> mm</span></button>
      </div>
      <button type="button" class="tk-btn primary tk-print" :disabled="!order" @click="print">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V4h10v5" /><path d="M7 17H5a1 1 0 01-1-1v-5a2 2 0 012-2h12a2 2 0 012 2v5a1 1 0 01-1 1h-2" /><path d="M7 14h10v6H7z" /></svg>
        Imprimir
      </button>
    </div>

    <div class="tk-stage">
      <div class="tk-sheet">
        <article class="tk-paper" :class="{ w58: paper === '58', 'rt-kitchen': kitchen }">
          <p v-if="loading" class="tk-state">Cargando…</p>
          <p v-else-if="err" class="tk-state err">{{ err }}</p>

          <template v-else-if="order">
            <TicketHeader />

            <div v-if="kitchen" class="tk-band"><span>Comanda</span><small>Folio {{ folio }}</small></div>
            <p v-else class="rt-title"><span>Cuenta</span></p>

            <!-- Mesa (o turno) en un círculo, con la fecha al lado -->
            <div class="rt-table">
              <div class="rt-badge" :class="{ long: badge.main.length > 3 }">
                <span>{{ badge.top }}</span>
                <strong>{{ badge.main }}</strong>
              </div>
              <div class="rt-when">
                <b class="big">{{ whoText }}</b>
                <span>{{ dayName(stamp) }} {{ shortDate(stamp) }}</span>
                <b>{{ clock(stamp) }}</b>
                <small v-if="!kitchen && cashier">Atendió {{ cashier }}</small>
              </div>
            </div>

            <div v-if="details.length" class="pr-details">
              <div v-for="[label, value] in details" :key="label" class="tk-line">
                <span>{{ label }}</span><i class="tk-dots"></i><span>{{ value }}</span>
              </div>
            </div>

            <!-- ===== Comanda de cocina ===== -->
            <template v-if="kitchen">
              <p class="tk-sec">Platillos</p>
              <div>
                <div v-for="(item, i) in t.items" :key="i" class="rt-course">
                  <span class="rt-qty">{{ item.qty }}×</span>
                  <div>
                    <p class="rt-dish-name">{{ item.name }}</p>
                    <p v-for="(o, j) in item.options" :key="j" class="rt-dish-extra">+ {{ o.label }} ×{{ o.qty }}</p>
                    <p v-if="item.notes" class="rt-dish-note">{{ item.notes }}</p>
                  </div>
                </div>
              </div>
              <p v-if="t.notes" class="tk-flag">{{ t.notes }}</p>
              <div class="tk-stamp-row">
                <div class="tk-stamp">
                  <b>A cocina</b>
                  <small>{{ clock(new Date()) }}</small>
                </div>
              </div>
            </template>

            <!-- ===== Cuenta del cliente ===== -->
            <template v-else>
              <p class="tk-sec">{{ t.orderTitle }}</p>
              <div class="rt-menu">
                <div v-for="(item, i) in t.items" :key="i" class="rt-dish">
                  <span class="rt-qty">{{ item.qty }}×</span>
                  <div>
                    <div class="tk-line">
                      <span class="rt-dish-name">{{ item.name }}</span>
                      <i class="tk-dots"></i>
                      <span>{{ money(item.amount) }}</span>
                    </div>
                    <p v-if="item.qty > 1" class="rt-dish-extra">{{ money(item.unit) }} c/u</p>
                    <p v-for="(o, j) in item.options" :key="j" class="rt-dish-extra">+ {{ o.label }} ×{{ o.qty }}<template v-if="o.amount > 0"> ({{ money(o.amount) }})</template></p>
                    <p v-if="item.notes" class="rt-dish-note">“{{ item.notes }}”</p>
                  </div>
                </div>
              </div>

              <hr class="tk-rule" />
              <!-- Pedidos nuevos: el IVA ya va dentro del subtotal. Los de antes lo sumaban aparte. -->
              <div v-if="!t.taxIncluded || t.deliveryFee" class="tk-line">
                <span>Subtotal</span><i class="tk-dots"></i><span>{{ money(t.subtotal) }}</span>
              </div>
              <div v-if="!t.taxIncluded && t.tax" class="tk-line">
                <span>{{ t.taxLabel }}</span><i class="tk-dots"></i><span>{{ money(t.tax) }}</span>
              </div>
              <div v-if="t.deliveryFee" class="tk-line">
                <span>Envío</span><i class="tk-dots"></i><span>+{{ money(t.deliveryFee) }}</span>
              </div>

              <div class="rt-total">
                <span>Total</span>
                <strong>{{ money(t.total) }}</strong>
              </div>
              <p v-if="t.taxIncluded" class="pr-ivanote">Incluye {{ t.taxLabel }}: {{ money(t.tax) }}</p>

              <!-- Propina sugerida: solo en cuentas de mesa sin cobrar -->
              <template v-if="t.tips.length && !paid">
                <p class="tk-sec">Propina sugerida</p>
                <div class="rt-tips">
                  <div v-for="[label, amount] in t.tips" :key="label">
                    <span>{{ label }}</span><strong>{{ money(amount) }}</strong>
                  </div>
                </div>
                <div class="rt-fill"><span>Propina $</span><i></i></div>
                <div class="rt-fill"><span>Total con propina $</span><i></i></div>
              </template>

              <div v-if="paid" class="tk-pay" :class="{ single: t.received == null }">
                <div>
                  <span>Pagó con</span>
                  <strong>{{ t.methodText }}</strong>
                  <em v-if="t.received != null">{{ money(t.received) }}</em>
                </div>
                <div v-if="t.received != null" class="tk-change">
                  <span>Su cambio</span>
                  <strong>{{ money(t.change) }}</strong>
                </div>
              </div>

              <p v-if="t.notes" class="tk-flag">{{ t.notes }}</p>

              <div class="tk-stamp-row">
                <div class="tk-stamp" :class="{ solid: status !== 'paid' }">
                  <b>{{ stampWord }}</b>
                  <small>{{ stampSub }}</small>
                </div>
              </div>

              <p class="rt-bye">{{ t.bye }}</p>
              <p class="rt-thanks">{{ t.thanks }}</p>
              <p class="tk-note pr-legal">Este comprobante no es factura fiscal. Solicite factura en caja si aplica.</p>
            </template>

            <div class="tk-foot">
              <p class="tk-made">Hecho con <b>MiRestaurante</b></p>
            </div>
          </template>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { errorText } from "../format";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import "../ticket.css";
import { apiService } from "../apiService";
import { authStore } from "../authStore";
import { venueStore, fetchVenueSettings } from "../venueStore";
import { channelLabel, modalityLabel } from "../labels";
import { orderTicketData } from "../ticketData";
import { storeClock, storeParts } from "../storeTime";
import { useTicketShell, folioOf, dayLong, monthShort } from "../ticketShell";
import TicketHeader from "../components/TicketHeader.vue";

const route = useRoute();
const { paper, setPaper, print, close } = useTicketShell("/orders");

const order = ref(null);
const loading = ref(true);
const err = ref("");
const kitchen = computed(() => route.query.mode === "kitchen");

const t = computed(() =>
  order.value
    ? orderTicketData(
        order.value,
        { shop: venueStore.businessName, businessType: venueStore.businessType, address: venueStore.address, phone: venueStore.phone, cashier: authStore.username },
        { modality: modalityLabel, channel: channelLabel },
        kitchen.value ? "kitchen" : "receipt"
      )
    : null
);
const folio = computed(() => folioOf(order.value?.id));
const cashier = computed(() => authStore.username || "");
const stamp = computed(() => order.value?.paidAt || order.value?.createdAt);
const counter = computed(() => order.value?.source === "counter");
const paid = computed(() => status.value === "paid");

// El círculo: el número de mesa, o el turno cuando es mostrador
const badge = computed(() => {
  const o = order.value;
  if (!o) return { top: "", main: "" };
  if (counter.value) return { top: "Turno", main: o.turno ? String(o.turno) : "—" };
  const n = String(o.tableName || "").replace(/^mesa\s*/i, "").trim();
  return { top: "Mesa", main: n || "—" };
});
// Línea grande junto al círculo: a dónde va la orden
const whoText = computed(() => {
  const o = order.value;
  if (!o) return "";
  if (counter.value) return o.customerName ? `Mostrador · ${o.customerName}` : "Mostrador";
  return modalityLabel[o.modality] || "En mesa";
});
// El resto de los datos del servicio (origen, entrega…), sin repetir lo que ya sale arriba
const SHOWN = new Set(["Mesa", "Atención", "Turno", "Servicio", "Apertura", "Cobro", "Atendió", "Artículos"]);
const details = computed(() => (t.value?.info || []).filter(([l]) => !SHOWN.has(l)));

const countText = computed(() => {
  const n = (t.value?.items || []).reduce((s, i) => s + i.qty, 0);
  return `${n} ${n === 1 ? "artículo" : "artículos"}`;
});

const status = computed(() => {
  const o = order.value;
  if (!o) return "";
  if (o.status === "cancelled") return "cancelled";
  return o.paymentStatus === "paid" ? "paid" : "pending";
});
const statusText = computed(() => ({ paid: "Pagado", cancelled: "Cancelada", pending: "Pendiente de pago" })[status.value] || "");
const stampWord = computed(() => ({ paid: "Pagado", cancelled: "Cancelada", pending: "Por cobrar" })[status.value] || "");
const stampSub = computed(() => (status.value === "pending" ? "Pendiente de pago" : `${shortDate(stamp.value)} · ${clock(stamp.value)}`));

const moneyFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `$${moneyFmt.format(Number(n || 0))}`;
function shortDate(d) {
  const p = storeParts(d, venueStore.timezone);
  return p ? `${String(p.day).padStart(2, "0")} ${monthShort(p.month)} ${p.year}` : "";
}
const clock = (d) => storeClock(d, venueStore.timezone);
function dayName(d) {
  const p = storeParts(d, venueStore.timezone);
  return p ? dayLong(p.weekday) : "";
}

onMounted(async () => {
  try {
    await fetchVenueSettings().catch(() => {});
    order.value = await apiService.getOrdersById(String(route.params.id));
    if (route.query.autoprint === "1") setTimeout(() => window.print(), 400);
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar el pedido.");
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.pr-details { display: grid; gap: 0.8mm; margin-top: 2.4mm; font-size: 0.92em; }
.pr-ivanote { text-align: right; font-size: 0.82em; margin-bottom: 1mm; }
.pr-legal { font-size: 0.72em; opacity: 0.85; }
</style>
