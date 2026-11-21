<template>
  <AppShell>
    <div class="orders-page">
      <div class="cash-banner" :class="{ open: cashOpen }">
        <div v-if="!cashOpen">
          <strong>Caja cerrada</strong>
          <p>Ábrela para poder cobrar pedidos.</p>
          <div class="cash-actions">
            <label>Fondo inicial
              <input v-model.number="openingFloat" type="number" min="0" step="1" />
            </label>
            <button type="button" class="btn-primary" :disabled="cashBusy" @click="openCash">
              Abrir caja
            </button>
          </div>
        </div>
        <div v-else>
          <strong>Caja abierta</strong>
          <p>
            Fondo {{ money(session.openingFloat) }} ·
            Ventas {{ money(cashTotals.total) }} ·
            Efectivo esperado {{ money((session.openingFloat || 0) + cashTotals.cash) }}
          </p>
          <div class="cash-actions">
            <label>Efectivo contado
              <input v-model.number="countedCash" type="number" min="0" step="0.01" @input="countedDirty = true" />
            </label>
            <button type="button" class="btn-danger" :disabled="cashBusy" @click="closeCash">
              Cerrar caja
            </button>
          </div>
        </div>
        <p v-if="cashMsg" class="ok">{{ cashMsg }}</p>
        <p v-if="cashErr" class="err">{{ cashErr }}</p>
      </div>

      <UberStoreStatus :refresh-key="cashOpen" />

      <div class="toolbar">
        <p>Cobro y seguimiento de pedidos del salón.</p>
        <router-link to="/menu" class="btn-primary">Nuevo pedido</router-link>
      </div>

      <!-- De dónde viene el pedido: así los de Uber Eats no se mezclan con los del local -->
      <div class="sources" role="group" aria-label="Origen del pedido">
        <button
          v-for="s in sourceOptions"
          :key="s.id"
          type="button"
          :class="{ active: source === s.id }"
          :aria-pressed="source === s.id"
          @click="source = s.id"
        >{{ s.label }} <span class="count">{{ s.count }}</span></button>
      </div>
      <div class="filters" role="group" aria-label="Estado del pedido">
        <button
          v-for="f in visibleFilters"
          :key="f.id"
          type="button"
          :class="{ active: filter === f.id }"
          :aria-pressed="filter === f.id"
          @click="filter = f.id"
        >{{ f.label }} <span class="count">{{ countOf(f.id) }}</span></button>
      </div>

      <div class="list">
        <template v-for="(o, idx) in filtered" :key="o.id">
        <h4 v-if="groupStart(idx)" class="group-head">{{ groupLabel[sourceOf(o)] }} <span class="count">{{ groupCount[sourceOf(o)] }}</span></h4>
        <article class="card">
          <div class="head">
            <div>
              <h3>{{ o.tableName || 'Sin mesa' }}</h3>
              <p class="meta">{{ formatDate(o.createdAt) }} · {{ modalityText(o.modality) }}<template v-if="o.channel && o.channel !== 'local'"> · {{ channelLabel[o.channel] }}</template></p>
            </div>
            <div class="tags">
              <span class="badge" :class="`st-${o.status}`">{{ statusText(o.status) }}</span>
              <span class="badge" :class="o.paymentStatus">{{ paymentText(o.paymentStatus) }}</span>
            </div>
          </div>
          <p v-if="readyText(o)" class="ready-at">{{ readyText(o) }}</p>
          <p v-if="readyFailed(o)" class="allergy-alert" role="alert">{{ o.external.readyError }} Reintenta, o márcalo «Listo» en la tablet de Uber Eats.</p>
          <p v-if="o.external && o.external.state === 'accepted' && !isDone(o) && !ownDelivery(o)" class="ready-at">{{ handoff(o).hint }}</p>
          <p v-if="courierText(o)" class="ready-at">{{ courierText(o) }}</p>
          <p v-if="o.external?.releaseAt && !isDone(o)" class="allergy-alert" role="alert"><strong>El repartidor está por llegar.</strong> {{ o.status === "ready" ? "Entrégalo en cuanto llegue." : "El pedido debe estar listo ya." }}</p>
          <p v-if="uberReadyText(o)" class="ready-at">{{ uberReadyText(o) }}</p>
          <p v-if="uberSummary(o) && !isDone(o)" class="ready-at">{{ uberSummary(o) }}</p>
          <p v-if="o.external?.askingCustomer && !isDone(o)" class="allergy-alert" role="alert">Esperando que el cliente responda por «{{ o.external.askingCustomer.name }}». Si no responde, Uber cancela el pedido.</p>
          <p v-if="o.external?.priceAdjust && !isDone(o)" class="ready-at">Cambio de precio enviado ({{ money(o.external.priceAdjust.amount) }}): esperando la respuesta del cliente. «Revisar en Uber» muestra el total.</p>
          <p v-if="isScheduled(o)" class="ready-at">Pedido programado confirmado. Uber lo volverá a pedir a su hora y tendrás que aceptarlo otra vez; hasta entonces no se cobra ni pasa a cocina.</p>
          <p v-if="o.external?.editedAt && !isDone(o)" class="allergy-alert" role="alert">El cliente modificó este pedido en Uber Eats. Revisa los platillos de abajo.</p>
          <div v-if="waiting(o)" class="awaiting" role="alert">
            <p><strong>{{ channelLabel[o.channel] || 'La plataforma' }} espera tu respuesta</strong> · {{ remaining(o) }}</p>
            <p v-if="o.external?.secondRound" class="allergy-alert" role="alert"><strong>Pedido programado:</strong> ya es su hora. Acéptalo otra vez o Uber lo cancelará.</p>
            <p v-if="o.external?.allergy" class="allergy-alert"><strong>Atención:</strong> este pedido trae alergias. Revísalas abajo antes de aceptar; si no puedes cumplirlas, rechaza el pedido.</p>
            <label class="prep">Listo en
              <select v-model.number="prepMinutes">
                <option v-for="m in PREP_OPTIONS" :key="m" :value="m">{{ m }} min</option>
              </select>
            </label>
            <label class="prep pickup">Indicaciones para el repartidor (opcional)
              <input v-model.trim="pickupNote" type="text" maxlength="200" placeholder="Ej. La entrada está cerrada, usen el carril de autoservicio" />
            </label>
            <div class="awaiting-actions">
              <button type="button" class="btn-primary" :disabled="!cashOpen || extBusy" :title="cashOpen ? '' : 'Abre la caja primero'" @click="acceptExternal(o)">Aceptar pedido</button>
              <button type="button" :disabled="extBusy" @click="askDeny(o)">Rechazar</button>
            </div>
          </div>
          <p v-if="o.delivery" class="deliver">
            <strong>{{ o.delivery.name }}</strong><template v-if="o.delivery.phone"> · <a :href="`tel:${o.delivery.phone}`">{{ o.delivery.phone }}</a></template>
            <template v-if="o.delivery.address"><br />{{ o.delivery.address }}</template><template v-if="o.delivery.reference"> ({{ o.delivery.reference }})</template>
          </p>
          <ul class="items">
            <li v-for="(item, i) in o.items || []" :key="i">
              {{ item.quantity }}× {{ item.name }} — {{ money(item.price * item.quantity) }}
              <small v-if="item.notes" class="item-note" :class="{ allergy: isAllergyNote(item.notes) }">{{ item.notes }}</small>
            </li>
          </ul>
          <p v-if="o.notes" class="order-note">{{ o.notes }}</p>
          <div class="foot">
            <strong>{{ money(o.total) }}</strong>
            <div class="actions">
              <a class="link-btn" :href="`/print/order/${o.id}?mode=receipt`" target="_blank" rel="noopener" @click="printLink($event, o)">Imprimir</a>
              <button
                v-if="o.paymentStatus !== 'paid' && o.paymentStatus !== 'refunded' && o.status !== 'cancelled' && !waiting(o) && !isScheduled(o)"
                type="button"
                class="btn-primary"
                :disabled="!cashOpen"
                :title="cashOpen ? '' : 'Abre la caja primero'"
                @click="openPay(o)"
              >Cobrar</button>
              <button v-if="o.status === 'pending' && !waiting(o) && !isScheduled(o)" type="button" @click="setStatus(o, 'preparing')">A cocina</button>
              <!-- Pedido de Uber ya aceptado: «listo» es lo que le avisa a Uber que mande al repartidor -->
              <button
                v-if="canMarkReady(o)"
                type="button"
                class="btn-primary"
                title="Avisa a Uber Eats que el pedido ya está listo para recoger"
                @click="setStatus(o, 'ready')"
              >Listo para recoger</button>
              <button v-if="readyFailed(o)" type="button" @click="setStatus(o, 'ready')">Reintentar aviso a Uber</button>
              <button v-if="canAddPrep(o)" type="button" :disabled="extBusy" title="Le avisa a Uber que tardará 10 minutos más" @click="addPrep(o, 10)">+10 min</button>
              <button v-if="canAskOutOfItem(o)" type="button" :disabled="extBusy" title="Avisa al cliente en su app de un producto agotado o de una alergia o nota que no puedes cumplir" @click="askOutOfItem(o)">Avisar un problema</button>
              <button v-if="canAdjustPrice(o)" type="button" :disabled="extBusy" title="Sube o baja el precio del pedido; el cliente lo acepta en su app" @click="askPrice(o)">Cambiar precio</button>
              <button v-if="isLive(o) && !ownDelivery(o)" type="button" :disabled="extBusy" title="Pide a Uber cómo va el pedido" @click="refreshFromUber(o)">Revisar en Uber</button>
              <template v-if="ownDelivery(o)">
                <button v-if="!o.external.deliveryStatus" type="button" :disabled="extBusy" @click="deliveryStep(o, 'started')">Salió a entregar</button>
                <button v-if="o.external.deliveryStatus === 'started'" type="button" :disabled="extBusy" @click="deliveryStep(o, 'arriving')">Va llegando</button>
                <button type="button" class="btn-primary" :disabled="extBusy" @click="deliveryStep(o, 'delivered')">Entregado</button>
              </template>
              <button
                v-else-if="(o.external ? o.status === 'ready' : o.modality === 'delivery') && !waiting(o) && !['served', 'cancelled'].includes(o.status)"
                type="button"
                :title="handoff(o).hint"
                @click="setStatus(o, 'served')"
              >{{ handoff(o).label }}</button>
              <button v-if="canCancelExternal(o)" type="button" :disabled="extBusy" @click="askCancel(o)">{{ deniedCancellable(o) ? 'Cancelar en Uber' : 'Cancelar pedido' }}</button>
            </div>
          </div>
        </article>
        </template>
        <p v-if="!filtered.length" class="empty">No hay pedidos en este filtro.</p>
      </div>

      <p v-if="extErr" class="err" role="alert">{{ extErr }}</p>
      <p v-if="extNote" class="ok" role="status">{{ extNote }}</p>

      <Teleport to="body">
        <div v-if="denyTarget" class="modal-bg" @click.self="denyTarget = null">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="deny-title">
            <h3 id="deny-title">{{ reasonMode === 'cancel' ? 'Cancelar pedido' : 'Rechazar pedido' }}</h3>
            <label>Motivo (se lo decimos a {{ channelLabel[denyTarget.channel] || 'la plataforma' }})
              <select v-model="denyCode">
                <option v-for="r in reasons" :key="r.code" :value="r.code">{{ r.label }}</option>
              </select>
            </label>
            <label v-if="denyCode === 'OTHER'">Detalle<span v-if="reasonMode === 'deny'"> (opcional)</span>
              <input v-model.trim="reasonDetails" type="text" maxlength="150" :required="reasonMode === 'cancel'" />
            </label>
            <fieldset v-if="reasonMode === 'deny' && denyCode === 'ITEM_AVAILABILITY' && denyChoices.length" class="item-pick">
              <legend>¿Qué producto se agotó? (se lo decimos a Uber)</legend>
              <label v-for="i in denyChoices" :key="i.cartItemId" class="pick"><input v-model="denyItems" type="checkbox" :value="i.cartItemId" /> {{ i.quantity }}× {{ i.name }}</label>
            </fieldset>
            <!-- Así lo dice Uber en su documentación de «Deny Order»: la tablet de Uber Eats Orders puede seguir mostrándolo -->
            <p v-if="reasonMode === 'deny' && denyTarget.external?.provider === 'uber'" class="deny-note">
              Si la tienda tiene la tablet de Uber Eats Orders, Uber puede dejar el pedido ahí unos minutos con «Error de sincronización con el
              PDV». Si nadie lo acepta en la tablet, se cancela solo a los 11.5 minutos. Para quitarlo ya, recházalo también en la tablet.
            </p>
            <div class="modal-actions">
              <button type="button" @click="denyTarget = null">Volver</button>
              <button type="button" class="btn-danger" :disabled="extBusy || (reasonMode === 'cancel' && denyCode === 'OTHER' && !reasonDetails)" @click="confirmDeny">{{ reasonMode === 'cancel' ? 'Cancelar pedido' : 'Rechazar pedido' }}</button>
            </div>
          </div>
        </div>
        <div v-if="oosTarget" class="modal-bg" @click.self="oosTarget = null">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="oos-title">
            <h3 id="oos-title">Avisar un problema</h3>
            <p class="deliver">Uber se lo pregunta al cliente en su app para que lo resuelva. Mientras responde, el pedido sigue abierto; si no responde, Uber lo cancela.</p>
            <label>¿Qué pasa?
              <select v-model="oosType">
                <option v-for="t in ISSUE_TYPES" :key="t.code" :value="t.code">{{ t.label }}</option>
              </select>
            </label>
            <fieldset v-if="oosType !== 'CANNOT_FULFILL_MERCHANT_INSTRUCTION'" class="item-pick">
              <legend>¿Cuál producto?</legend>
              <label v-for="i in oosChoices" :key="i.cartItemId" class="pick"><input v-model="oosItem" type="radio" name="oos-item" :value="i.cartItemId" /> {{ i.quantity }}× {{ i.name }}</label>
            </fieldset>
            <label>Mensaje para el cliente (opcional)
              <input v-model.trim="oosMessage" type="text" maxlength="150" placeholder="Ej. Se acabó la leche de avena" />
            </label>
            <div class="modal-actions">
              <button type="button" @click="oosTarget = null">Volver</button>
              <button type="button" class="btn-primary" :disabled="extBusy || (!oosItem && oosType !== 'CANNOT_FULFILL_MERCHANT_INSTRUCTION')" @click="confirmOutOfItem">Avisar al cliente</button>
            </div>
          </div>
        </div>
        <div v-if="priceTarget" class="modal-bg" @click.self="priceTarget = null">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="price-title">
            <h3 id="price-title">Cambiar el precio</h3>
            <p class="deliver">El cliente tiene que aceptar el cambio en su app. Uber limita el monto (por defecto 50 pesos). Pon un número negativo para bajar el precio.</p>
            <label>Monto (pesos)
              <input v-model.number="priceAmount" type="number" step="0.01" placeholder="Ej. 25 o -10" />
            </label>
            <label>Motivo
              <select v-model="priceReason">
                <option v-for="r in PRICE_REASONS" :key="r.code" :value="r.code">{{ r.label }}</option>
              </select>
            </label>
            <label v-if="priceReason === 'OTHER'">Explica el motivo
              <input v-model.trim="priceCustom" type="text" maxlength="150" />
            </label>
            <label>IVA incluido en el precio (%)
              <input v-model.number="priceTax" type="number" min="0" max="60" step="0.01" />
            </label>
            <div class="modal-actions">
              <button type="button" @click="priceTarget = null">Volver</button>
              <button type="button" class="btn-primary" :disabled="extBusy || !priceAmount || (priceReason === 'OTHER' && !priceCustom)" @click="confirmPrice">Enviar al cliente</button>
            </div>
          </div>
        </div>
        <div v-if="payOrder" class="modal-bg" @click.self="!payBusy && (payOrder = null)">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pay-title">
            <h3 id="pay-title">Cobrar {{ money(payOrder.total) }}</h3>
            <p v-if="isPlatformChannel(payOrder.channel)" class="deliver">Lo cobra {{ channelLabel[payOrder.channel] }}: se registra como «Plataforma».</p>
            <label v-else>Método de pago
              <select v-model="payMethod">
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="other">Otro</option>
              </select>
            </label>
            <TerminalNote v-if="!isPlatformChannel(payOrder.channel) && payMethod === 'card'" v-model:manual="payManual" :term="term" :waiting="waitingTerminal" @cancel="cancelTerminal" />
            <p v-if="payErr" class="err" role="alert">{{ payErr }}</p>
            <div class="modal-actions">
              <button type="button" :disabled="payBusy" @click="payOrder = null">Cancelar</button>
              <button type="button" class="btn-primary" :disabled="payBusy" @click="confirmPay">{{ payBusy ? 'Cobrando…' : 'Confirmar cobro' }}</button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </AppShell>
</template>

<script setup>
import { money, errorText } from "../format";
import { askConfirm } from "../dialog";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { bindLive } from "../live";
import { useRoute, useRouter } from "vue-router";
import AppShell from "../components/AppShell.vue";
import TerminalNote from "../components/TerminalNote.vue";
import UberStoreStatus from "../components/UberStoreStatus.vue";
import { directPrinting, printCashClose, printOrder, shouldAutoPrint } from "../printing";
import { usePointTerminal } from "../point";
import { apiService } from "../apiService";
import { venueStore } from "../venueStore";
import {
  channelLabel,
  isAllergyNote,
  isPlatformChannel,
  labelOf,
  modalityLabel,
  orderStatusLabel,
  paymentStatusLabel,
} from "../labels";

const router = useRouter();
const route = useRoute();
const orders = ref([]);

// ——— Pedidos de una plataforma (Uber Eats) que esperan respuesta ———
const DENY_REASONS = [
  { code: "ITEM_AVAILABILITY", label: "Producto agotado" },
  { code: "CAPACITY", label: "Mucho trabajo, no alcanzamos" },
  { code: "STORE_CLOSED", label: "Estamos cerrados" },
  { code: "SPECIAL_INSTRUCTIONS", label: "No podemos cumplir las indicaciones o alergias" },
  { code: "OTHER", label: "Otro motivo" },
];
// Para cancelar un pedido que ya se aceptó (Uber exige uno de estos motivos)
const CANCEL_REASONS = [
  { code: "OUT_OF_ITEMS", label: "Se acabó un producto" },
  { code: "RESTAURANT_TOO_BUSY", label: "Mucho trabajo, no alcanzamos" },
  { code: "KITCHEN_CLOSED", label: "La cocina cerró" },
  { code: "CUSTOMER_CALLED_TO_CANCEL", label: "El cliente llamó para cancelar" },
  { code: "CANNOT_COMPLETE_CUSTOMER_NOTE", label: "No podemos cumplir la nota del cliente" },
  { code: "OTHER", label: "Otro motivo" },
];
const PREP_OPTIONS = [10, 15, 20, 30, 45];
const prepMinutes = ref(15);
const pickupNote = ref(""); // indicaciones para el repartidor al aceptar
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
const extBusy = ref(false);
const extErr = ref("");
const denyTarget = ref(null);
const denyCode = ref("ITEM_AVAILABILITY");
const reasonMode = ref("deny"); // deny: rechazar un pedido sin aceptar · cancel: cancelar uno ya aceptado
const reasonDetails = ref("");
const reasons = computed(() => (reasonMode.value === "cancel" ? CANCEL_REASONS : DENY_REASONS));
const isDone = (o) => ["served", "cancelled"].includes(o.status);
// Programado y confirmado una vez: espera a que Uber lo vuelva a pedir (se puede cancelar, pero no se cobra ni se entrega aún)
const isScheduled = (o) => o.external?.state === "scheduled" && !isDone(o);
const isLive = (o) => o.external?.state === "accepted" && !isDone(o);
// «Servido» no le avisa a Uber: si no lo reparte el restaurante, se puede cancelar 2 horas más (igual que en el servidor)
const servedCancellable = (o) =>
  o.status === "served" && o.external?.state === "accepted" && o.external.type !== "DELIVERY_BY_RESTAURANT" &&
  Date.now() - new Date(o.updatedAt || 0).getTime() <= 2 * 60 * 60 * 1000;
// Rechazado hace menos de 2 horas: puede seguir en la tablet de Uber; se intenta cancelar en Uber
const deniedCancellable = (o) =>
  o.external?.state === "denied" && !o.external.uberCanceledAt && Date.now() - new Date(o.external.closedAt || 0).getTime() <= 2 * 60 * 60 * 1000;
const canCancelExternal = (o) => isLive(o) || isScheduled(o) || servedCancellable(o) || deniedCancellable(o);
// Lo reparte el propio restaurante: Uber pide avisar que salió, que va llegando y que entregó
const ownDelivery = (o) => isLive(o) && o.external.type === "DELIVERY_BY_RESTAURANT";
const waiting = (o) => o.external?.state === "awaiting";
// Pedido de Uber aceptado que todavía no se marca listo; y el que se marcó listo pero Uber no recibió el aviso
const canMarkReady = (o) => isLive(o) && ["pending", "preparing"].includes(o.status);
const readyFailed = (o) => Boolean(o.external?.readyError) && !o.external?.readyNotifiedAt && !isDone(o);
// Pedido de una plataforma que NO reparte el restaurante: quien lo lleva (o lo recoge) es Uber o el cliente, y Uber no deja que
// el restaurante marque la entrega. Cerrarlo aquí solo lo cierra en MiRestaurante: no le avisa nada a la plataforma.
function handoff(o) {
  if (!o.external) return { label: "Marcar entregado", hint: "" };
  const own = ["PICK_UP", "DINE_IN"].includes(o.external.type);
  return own
    ? { label: "Ya lo recogió el cliente", hint: "El cliente lo recoge. Marcarlo aquí solo lo cierra en MiRestaurante; no se lo avisa a Uber." }
    : { label: "Ya lo recogió el repartidor", hint: "Uber hace la entrega y avisa al cliente. Marcarlo aquí solo lo cierra en MiRestaurante; no se lo avisa a Uber." };
}
// Pedido programado y/o la hora de recogida que estima Uber
function readyText(o) {
  const e = o.external;
  if (!e) return "";
  const at = e.readyAt ? new Date(e.readyAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return [e.scheduled ? "Pedido programado" : "", at && `Recogida estimada: ${at}`].filter(Boolean).join(" · ");
}
function remaining(o) {
  const left = new Date(o.external?.deadline).getTime() - now.value;
  if (!Number.isFinite(left)) return "";
  if (left <= 0) return "el tiempo se agotó: Uber puede cancelarlo";
  const s = Math.ceil(left / 1000);
  return `quedan ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function replaceOrder(updated) {
  const idx = orders.value.findIndex((x) => x.id === updated.id);
  if (idx >= 0) orders.value[idx] = updated;
}
// Al aceptar también se actualiza la caja (el pedido de plataforma entra como cobrado) y se limpian las indicaciones
const acceptExternal = (o) =>
  runExternal(() => apiService.acceptExternalOrder(o.id, prepMinutes.value, pickupNote.value), "No se pudo aceptar el pedido.", {
    after: async () => {
      pickupNote.value = "";
      await loadCash();
    },
  });
const CANCEL_BLOCK = { ORDER_READY: "el pedido ya está listo" };
const denyItems = ref([]); // productos agotados que se le dicen a Uber al rechazar
const pickable = (o) => (o?.items || []).filter((i) => i.cartItemId);
const denyChoices = computed(() => pickable(denyTarget.value));
function askDeny(o) {
  reasonMode.value = "deny";
  denyCode.value = "ITEM_AVAILABILITY";
  reasonDetails.value = "";
  denyItems.value = [];
  denyTarget.value = o;
}
async function askCancel(o) {
  extErr.value = "";
  let cur = o;
  // Antes de abrir el aviso se le pregunta a Uber si deja cancelar (si no contesta, se sigue como antes)
  if (o.external?.state === "accepted") {
    try {
      cur = await apiService.syncExternalOrder(o.id);
      replaceOrder(cur);
    } catch {
      cur = o;
    }
    if (isDone(cur) && !servedCancellable(cur)) return;
    // Pedido ya listo (o que Uber ya no deja cancelar): se pregunta antes y, si se confirma, se intenta; Uber decide
    const c = cur.external?.sync?.cancel;
    const ready = cur.status === "ready" || cur.external?.readyNotifiedAt || cur.external?.sync?.preparationStatus === "READY_FOR_HANDOFF";
    if (ready || (c && c.eligible === false)) {
      const why = c && c.eligible === false ? `\n\nUber indica que ya no lo deja cancelar (${CANCEL_BLOCK[c.reason] || c.reason || "sin motivo"}). Se intentará de todos modos y Uber decidirá.` : "";
      if (!(await askConfirm(`Este pedido ya está marcado como listo. ¿Seguro que quieres cancelarlo?${why}`, { title: "El pedido ya está listo", danger: true, confirmText: "Sí, cancelar", cancelText: "No, volver" }))) return;
    }
  }
  reasonMode.value = "cancel";
  denyCode.value = "OUT_OF_ITEMS";
  reasonDetails.value = "";
  denyTarget.value = cur;
}
// ——— Lo que Uber dice del pedido: repartidor, si ya lo ve listo, más tiempo y producto agotado ———
const COURIER_TEXT = {
  EN_ROUTE_TO_PICKUP: "Repartidor en camino al local",
  ARRIVED_AT_PICKUP: "El repartidor llegó al local",
  EN_ROUTE_TO_DROPOFF: "El repartidor ya lo recogió y va con el cliente",
  ARRIVED_AT_DROPOFF: "El repartidor llegó con el cliente",
  COMPLETED: "Entregado al cliente",
};
const courierText = (o) => (o.external?.provider === "uber" ? COURIER_TEXT[o.external?.courier?.status] || "" : "");
function uberReadyText(o) {
  const e = o.external;
  if (!e?.readyNotifiedAt || isDone(o)) return "";
  if (e.sync?.preparationStatus === "READY_FOR_HANDOFF") return "Uber confirmó que el pedido está listo para recoger.";
  return e.sync ? "Avisaste a Uber que está listo, pero Uber aún lo muestra en preparación. Usa «Revisar en Uber»." : "Ya le avisaste a Uber que está listo.";
}
// Uber deja cambiar la hora de listo una sola vez por pedido
const canAddPrep = (o) => canMarkReady(o) && !o.external?.readyNotifiedAt && !o.external?.readyAdjusted && o.external?.sync?.adjustReadyTime?.eligible !== false;
const canAskOutOfItem = (o) =>
  isLive(o) && !o.external?.readyNotifiedAt && !o.external?.askingCustomer && pickable(o).length > 0 && o.external?.sync?.outOfItem?.eligible !== false;
// Toda acción sobre un pedido de plataforma pasa por aquí: marca «ocupado», pone el pedido actualizado en la lista y, si falla,
// muestra el error y recarga. `after`: qué sigue si salió bien · `always`: qué se hace pase lo que pase (p. ej. cerrar el aviso).
async function runExternal(call, fallback, { after, always } = {}) {
  extBusy.value = true;
  extErr.value = "";
  extNote.value = "";
  try {
    replaceOrder(await call());
    await after?.();
  } catch (e) {
    extErr.value = errorText(e, fallback);
    await load();
  } finally {
    always?.();
    extBusy.value = false;
  }
}
// Lo que Uber dice del pedido, en una línea: estado, preparación y lo que ya no permite
const STATE_TEXT = { OFFERED: "Ofrecido", ACCEPTED: "Aceptado", HANDED_OFF: "Ya lo tiene el repartidor", SUCCEEDED: "Entregado", FAILED: "Cancelado o fallido" };
const PREP_TEXT = { PREPARING: "En preparación", READY_FOR_HANDOFF: "Listo para recoger", OUT_OF_ITEM_PENDING_CUSTOMER_RESPONSE: "Esperando al cliente por un producto agotado" };
function uberSummary(o) {
  const s = o.external?.sync;
  if (!s) return "";
  const when = new Date(s.at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const no = [s.cancel?.eligible === false && "cancelarlo", s.adjustReadyTime?.eligible === false && "cambiar la hora"].filter(Boolean);
  const parts = [STATE_TEXT[s.state], PREP_TEXT[s.preparationStatus], no.length && `Uber ya no deja ${no.join(" ni ")}`].filter(Boolean);
  return `Según Uber (${when}): ${parts.join(" · ") || "sin novedades"}`;
}
const extNote = ref("");
async function refreshFromUber(o) {
  await runExternal(() => apiService.syncExternalOrder(o.id), "No se pudo consultar a Uber Eats.");
  const cur = orders.value.find((x) => x.id === o.id);
  if (!extErr.value) extNote.value = (cur && uberSummary(cur)) || "Uber no dio más datos de este pedido.";
}
const addPrep = (o, minutes) => runExternal(() => apiService.setExternalReadyTime(o.id, minutes), "No se pudo cambiar la hora de listo.");
const ISSUE_TYPES = [
  { code: "OUT_OF_ITEM", label: "Se agotó un producto" },
  { code: "CANNOT_FULFILL_ALLERGY_REQUEST", label: "No puedo cumplir la alergia de un producto" },
  { code: "CANNOT_FULFILL_MERCHANT_INSTRUCTION", label: "No puedo cumplir la nota del pedido" },
];
const oosType = ref("OUT_OF_ITEM");
const oosTarget = ref(null);
const oosItem = ref("");
const oosMessage = ref("");
const oosChoices = computed(() => pickable(oosTarget.value));
function askOutOfItem(o) {
  oosType.value = "OUT_OF_ITEM";
  oosItem.value = "";
  oosMessage.value = "";
  oosTarget.value = o;
}
// ——— Cambiar el precio de un pedido activo (el cliente lo acepta en su app) ———
const PRICE_REASONS = [
  { code: "NEW_ITEM_ADDED", label: "Se agregó un producto" },
  { code: "REQUESTED_ADD_ONS", label: "El cliente pidió un extra" },
  { code: "BIGGER_SIZE", label: "El cliente pidió un tamaño mayor" },
  { code: "ITEM_SOLD_OUT", label: "Se agotó un producto" },
  { code: "REMOVED_ITEM", label: "Se quitó un producto" },
  { code: "ADD_ON_UNAVAILABLE", label: "Un extra no está disponible" },
  { code: "OTHER", label: "Otro motivo" },
];
const priceTarget = ref(null);
const priceAmount = ref(null);
const priceReason = ref("NEW_ITEM_ADDED");
const priceCustom = ref("");
const priceTax = ref(16);
const canAdjustPrice = (o) => isLive(o) && !o.external?.readyNotifiedAt && !o.external?.priceAdjust;
function askPrice(o) {
  priceAmount.value = null;
  priceReason.value = "NEW_ITEM_ADDED";
  priceCustom.value = "";
  priceTax.value = Math.round((Number(venueStore.taxRate) || 0) * 10000) / 100; // el IVA del negocio, en %
  priceTarget.value = o;
}
async function confirmPrice() {
  const o = priceTarget.value;
  priceTarget.value = null;
  await runExternal(
    () => apiService.adjustExternalPrice(o.id, { amount: priceAmount.value, reason: priceReason.value, customReason: priceCustom.value, taxRate: priceTax.value }),
    "No se pudo cambiar el precio."
  );
}
async function confirmOutOfItem() {
  const o = oosTarget.value;
  oosTarget.value = null;
  await runExternal(() => apiService.externalOutOfItem(o.id, oosItem.value, oosMessage.value, oosType.value), "No se pudo avisar del producto agotado.");
}
const deliveryStep = (o, status) => runExternal(() => apiService.externalDeliveryStatus(o.id, status), "No se pudo avisar a la plataforma.");
function confirmDeny() {
  const o = denyTarget.value;
  const cancel = reasonMode.value === "cancel";
  const label = reasons.value.find((r) => r.code === denyCode.value)?.label || "";
  return runExternal(
    () =>
      cancel
        ? apiService.cancelExternalOrder(o.id, denyCode.value, reasonDetails.value)
        : apiService.denyExternalOrder(o.id, denyCode.value, reasonDetails.value || label, denyItems.value),
    cancel ? "No se pudo cancelar el pedido." : "No se pudo rechazar el pedido.",
    { always: () => (denyTarget.value = null) }
  );
}
const filter = ref("open");
const payOrder = ref(null);
const payMethod = ref("cash");
const payBusy = ref(false);
const payErr = ref("");
const payManual = ref(false); // «Ya cobré aparte»: tarjeta sin usar la terminal
const { term, waiting: waitingTerminal, load: loadTerminal, charge: chargeOnTerminal, cancel: cancelTerminal } = usePointTerminal();

const cashOpen = ref(false);
const session = ref(null);
const cashTotals = ref({ cash: 0, card: 0, transfer: 0, other: 0, total: 0 });
const openingFloat = ref(0);
const countedCash = ref(0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Si el cajero ya tecleó el efectivo contado, una recarga automática no debe pisarlo
const countedDirty = ref(false);
const live = bindLive(["orders"], () => load(true));
const cashBusy = ref(false);
const cashMsg = ref("");
const cashErr = ref("");

// Estado: cada filtro dice qué pedidos deja pasar. Un pedido de plataforma aceptado ya viene cobrado, pero sigue abierto hasta entregarlo o cancelarlo.
const filterRules = {
  open: (o) => (o.paymentStatus !== "paid" && o.status !== "cancelled") || canCancelExternal(o),
  unpaid: (o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded" && o.status !== "cancelled",
  delivery: (o) => o.modality === "delivery" && !["served", "cancelled"].includes(o.status),
  paid: (o) => o.paymentStatus === "paid",
  pending: (o) => o.status === "pending",
  preparing: (o) => o.status === "preparing",
  ready: (o) => o.status === "ready",
  served: (o) => o.status === "served",
  cancelled: (o) => o.status === "cancelled",
  refunded: (o) => o.paymentStatus === "refunded",
  all: () => true,
};
const filters = [
  { id: "open", label: "Abiertos" },
  { id: "unpaid", label: "Por cobrar" },
  { id: "delivery", label: "A domicilio" },
  { id: "paid", label: "Pagados" },
  { id: "pending", label: "Pendientes" },
  { id: "preparing", label: "Preparando" },
  { id: "ready", label: "Listos" },
  { id: "served", label: "Servidos" },
  { id: "cancelled", label: "Cancelados" },
  { id: "refunded", label: "Devueltos" },
  { id: "all", label: "Todos" },
];

// En Uber Eats (y en el local) se filtra por pocos estados: abiertos, preparando, listos, entregados y cancelados
const UBER_FILTERS = [
  { id: "open", label: "Abiertos" },
  { id: "preparing", label: "Preparando" },
  { id: "ready", label: "Listos" },
  { id: "served", label: "Entregados" },
  { id: "cancelled", label: "Cancelados" },
  { id: "all", label: "Todos" },
];
// Local: los mismos, más «Por cobrar» (lo principal de la caja)
const LOCAL_FILTERS = [UBER_FILTERS[0], { id: "unpaid", label: "Por cobrar" }, ...UBER_FILTERS.slice(1)];
const visibleFilters = computed(() => (source.value === "uber" ? UBER_FILTERS : source.value === "local" ? LOCAL_FILTERS : filters));

// Origen: Uber Eats, otras apps de reparto o el local (mesa, mostrador, teléfono)
const sourceOf = (o) => (o.channel === "uber" || o.external?.provider === "uber" ? "uber" : isPlatformChannel(o.channel) ? "other" : "local");
const groupLabel = { uber: "Uber Eats", other: "Otras apps", local: "Local" };
const GROUP_ORDER = { uber: 0, other: 1, local: 2 }; // lo de Uber primero: corre el tiempo para aceptarlo
const source = ref("all");
const countBySource = computed(() => {
  const n = { all: orders.value.length, uber: 0, other: 0, local: 0 };
  for (const o of orders.value) n[sourceOf(o)]++;
  return n;
});
const sourceOptions = computed(() =>
  [{ id: "all", label: "Todos" }, { id: "local", label: "Local" }, { id: "uber", label: "Uber Eats" }, { id: "other", label: "Otras apps" }]
    .filter((s) => s.id !== "other" || countBySource.value.other > 0 || source.value === "other")
    .map((s) => ({ ...s, count: countBySource.value[s.id] }))
);
const bySource = computed(() => (source.value === "all" ? orders.value : orders.value.filter((o) => sourceOf(o) === source.value)));
const countOf = (id) => bySource.value.filter(filterRules[id]).length;

const filtered = computed(() => {
  const list = bySource.value.filter(filterRules[filter.value] || filterRules.open);
  // Con «Todos» los pedidos salen por secciones (Uber, otras apps, local), sin perder el orden dentro de cada una
  return source.value === "all" ? [...list].sort((a, b) => GROUP_ORDER[sourceOf(a)] - GROUP_ORDER[sourceOf(b)]) : list;
});
const groupCount = computed(() => {
  const n = { uber: 0, other: 0, local: 0 };
  for (const o of filtered.value) n[sourceOf(o)]++;
  return n;
});
// El título de sección solo se pone cuando se muestran pedidos de más de un origen
const mixed = computed(() => Object.values(groupCount.value).filter(Boolean).length > 1);
const groupStart = (idx) => source.value === "all" && mixed.value && (idx === 0 || sourceOf(filtered.value[idx - 1]) !== sourceOf(filtered.value[idx]));

// Se recuerda lo último que se eligió en este dispositivo
const VIEW_KEY = "mirestaurante_orders_view";
try {
  const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  if (filterRules[saved.filter]) filter.value = saved.filter;
  if (["all", "local", "uber", "other"].includes(saved.source)) source.value = saved.source;
} catch {
  /* sin memoria: se queda con lo de siempre */
}
// Si el estado elegido no existe en este origen (p. ej. «Devueltos» en Uber Eats), se vuelve a «Abiertos»
const keepValidFilter = () => {
  if (!visibleFilters.value.some((f) => f.id === filter.value)) filter.value = "open";
};
keepValidFilter();
watch(source, keepValidFilter);
watch([filter, source], () => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ filter: filter.value, source: source.value }));
  } catch {
    /* no pasa nada */
  }
});
// Si se llega desde el aviso de un pedido de plataforma (?origen=uber), Caja abre directo en esa pestaña, con los abiertos
watch(
  () => route.query.origen,
  (origen) => {
    if (!["all", "local", "uber", "other"].includes(origen)) return;
    source.value = origen;
    filter.value = "open";
    router.replace({ query: {} }); // la dirección queda limpia: recargar o cambiar de pestaña ya no lo vuelve a forzar
  },
  { immediate: true }
);

function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}
function statusText(s) {
  return labelOf(orderStatusLabel, s);
}
function paymentText(s) {
  return labelOf(paymentStatusLabel, s, "Sin pagar");
}
function modalityText(m) {
  return labelOf(modalityLabel, m);
}

// silent: recarga automática; si falla, deja en pantalla lo que ya había
async function loadCash(silent = false) {
  try {
    const data = await apiService.getCashSession();
    cashOpen.value = Boolean(data.open);
    session.value = data.session;
    cashTotals.value = data.totals || { cash: 0, card: 0, transfer: 0, other: 0, total: 0 };
    if (data.session && !countedDirty.value) {
      // A centavos: sumar decimales da cosas como 1285.199999999998
      countedCash.value = round2((data.session.openingFloat || 0) + (data.totals?.cash || 0));
    }
    if (!data.session) countedDirty.value = false;
  } catch {
    if (silent) return;
    cashOpen.value = false;
    session.value = null;
  }
}

async function openCash() {
  cashBusy.value = true;
  cashErr.value = "";
  cashMsg.value = "";
  try {
    await apiService.openCashSession(Number(openingFloat.value || 0));
    cashMsg.value = "Caja abierta.";
    await loadCash();
  } catch (e) {
    cashErr.value = errorText(e, "No se pudo abrir la caja");
  } finally {
    cashBusy.value = false;
  }
}

async function closeCash() {
  if (!(await askConfirm("¿Cerrar la caja con el efectivo contado?", { title: "Cerrar caja", confirmText: "Cerrar caja" }))) return;
  cashBusy.value = true;
  cashErr.value = "";
  cashMsg.value = "";
  try {
    const res = await apiService.closeCashSession(round2(countedCash.value));
    cashMsg.value = `Caja cerrada. Diferencia: ${money(res.session?.difference)}`;
    if (res.session?.id) {
      if (directPrinting()) printCashClose(res.session.id);
      else router.push(`/print/cash/${res.session.id}?autoprint=1`);
    }
    await loadCash();
  } catch (e) {
    cashErr.value = errorText(e, "No se pudo cerrar la caja");
  } finally {
    cashBusy.value = false;
  }
}

async function load(silent = false) {
  try {
    orders.value = (await apiService.getOrders()) || [];
  } catch {
    if (!silent) orders.value = [];
  }
  await loadCash(silent);
}

// Con térmica en este dispositivo el ticket sale directo; si no, el enlace abre la vista de impresión como siempre
function printLink(event, o) {
  if (!directPrinting()) return;
  event.preventDefault();
  printOrder(o, "receipt");
}

function openPay(o) {
  if (!cashOpen.value) {
    cashErr.value = "Abre la caja antes de cobrar.";
    return;
  }
  payOrder.value = o;
  payMethod.value = "cash";
  payManual.value = false;
  payErr.value = "";
  loadTerminal();
}

async function confirmPay() {
  if (!payOrder.value || payBusy.value) return;
  payBusy.value = true;
  payErr.value = "";
  try {
    // Con terminal, primero se cobra ahí; el pedido solo se marca cobrado si el cobro quedó aprobado
    let pointChargeId;
    if (!isPlatformChannel(payOrder.value.channel) && payMethod.value === "card" && term.ok && !payManual.value) {
      try {
        pointChargeId = await chargeOnTerminal(payOrder.value.id, payOrder.value.total);
      } catch (e) {
        payErr.value = e.message;
        return;
      }
    }
    const updated = await apiService.payOrder(payOrder.value.id, payMethod.value, pointChargeId);
    const idx = orders.value.findIndex((x) => x.id === updated.id);
    if (idx >= 0) orders.value[idx] = updated;
    const id = payOrder.value.id;
    payOrder.value = null;
    await loadCash();
    if (shouldAutoPrint()) printOrder(updated, "receipt");
    else if (await askConfirm("¿Imprimir cuenta?", { title: "Pedido cobrado", confirmText: "Imprimir", cancelText: "Ahora no" })) printOrder(updated, "receipt", { auto: true });
  } catch (e) {
    payErr.value = errorText(e, "No se pudo cobrar");
  } finally {
    payBusy.value = false;
  }
}

async function setStatus(o, status) {
  extErr.value = "";
  try {
    const updated = await apiService.updateOrderStatus(o.id, status);
    const idx = orders.value.findIndex((x) => x.id === updated.id);
    if (idx >= 0) orders.value[idx] = updated;
  } catch (e) {
    extErr.value = errorText(e, "No se pudo cambiar el estado del pedido.");
  }
}

onMounted(async () => {
  await live.ready;
  await load();
});
onUnmounted(() => {
  live.stop();
  clearInterval(tick);
});
</script>

<style scoped>
.orders-page { animation: t-fade-up .45s ease both; }
.cash-banner {
  margin-bottom: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 1rem;
  border: 1px solid var(--mirestaurante-line);
  background: var(--mirestaurante-warning-soft);
  color: var(--mirestaurante-ink);
}
.cash-banner.open { background: var(--mirestaurante-success-soft); }
.cash-banner p { margin: .25rem 0 .55rem; font-size: .9rem; color: var(--mirestaurante-muted); }
.cash-actions { display: flex; flex-wrap: wrap; gap: .55rem; align-items: end; }
.cash-actions label { display: grid; gap: .25rem; font-size: .8rem; font-weight: 700; }
.cash-actions input {
  min-height: 2.75rem;
  border: 1px solid var(--mirestaurante-line);
  border-radius: .65rem;
  padding: .5rem .7rem;
  background: var(--mirestaurante-panel-elevated);
  color: var(--mirestaurante-ink);
}
.toolbar { display:flex; justify-content:space-between; align-items:center; margin:1.1rem 0 1.2rem; gap:1rem; flex-wrap:wrap; }
.toolbar p { margin:0; color:var(--mirestaurante-muted); }
.btn-primary { background:var(--mirestaurante-primary); color:var(--mirestaurante-on-primary); border:none; border-radius:.8rem; padding:.75rem 1.1rem; font-weight:700; text-decoration:none; cursor:pointer; display:inline-block; min-height:3rem; box-shadow:var(--mirestaurante-shadow); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-danger { background:var(--mirestaurante-danger); color:#fff; border:none; border-radius:.8rem; padding:.75rem 1.1rem; font-weight:700; cursor:pointer; min-height:3rem; }
.filters { display:flex; gap:.45rem; flex-wrap:wrap; margin-bottom:1rem; }
.sources { display:inline-flex; gap:.2rem; flex-wrap:wrap; padding:.25rem; margin-bottom:.8rem; border:1px solid var(--mirestaurante-line); border-radius:999px; background:var(--mirestaurante-panel); }
.sources button { border:none; background:transparent; color:var(--mirestaurante-ink); border-radius:999px; padding:.5rem 1rem; cursor:pointer; font-size:.9rem; font-weight:700; min-height:2.6rem; }
.sources button.active { background:var(--mirestaurante-ink); color:var(--mirestaurante-panel); }
.count { display:inline-block; min-width:1.3em; margin-left:.25rem; padding:0 .35em; border-radius:999px; background:rgba(127,127,127,.22); font-size:.78em; font-weight:700; text-align:center; }
.group-head { margin:.9rem 0 0; font-size:.82rem; letter-spacing:.06em; text-transform:uppercase; color:var(--mirestaurante-muted); }
.group-head:first-child { margin-top:0; }
.filters button { border:1px solid var(--mirestaurante-line); background:var(--mirestaurante-panel-elevated); color:var(--mirestaurante-ink); border-radius:999px; padding:.55rem 1rem; cursor:pointer; font-size:.9rem; font-weight:700; min-height:2.85rem; }
.filters button.active { background:var(--mirestaurante-primary); color:var(--mirestaurante-on-primary); border-color:transparent; }
.list { display:grid; gap:.85rem; }
.card { background:var(--mirestaurante-panel); border:1px solid var(--mirestaurante-line); border-radius:1.1rem; padding:1.15rem; box-shadow:var(--mirestaurante-shadow); color:var(--mirestaurante-ink); }
.head { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; }
.head h3 { margin:0; font-family:var(--font-display); font-size:1.2rem; font-weight:700; letter-spacing:-0.01em; }
.meta { margin:.25rem 0 0; color:var(--mirestaurante-muted); font-size:.82rem; }
.tags { display:flex; gap:.4rem; flex-wrap:wrap; justify-content:flex-end; }
.badge {
  display: inline-flex; align-items: center; justify-content: center;
  height: 1.7rem; padding: 0 0.75rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 700; line-height: 1; white-space: nowrap;
  background: var(--mirestaurante-primary-soft); color: var(--mirestaurante-primary);
}
.badge.st-pending { background: var(--mirestaurante-warning-soft); color: var(--mirestaurante-warning); }
.badge.st-preparing { background: color-mix(in srgb, var(--mirestaurante-accent) 22%, transparent); color: var(--mirestaurante-accent); }
.badge.st-ready { background: var(--mirestaurante-primary-soft); color: var(--mirestaurante-primary); }
.badge.st-served { background: var(--mirestaurante-success-soft); color: var(--mirestaurante-success); }
.badge.st-cancelled { background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); }
.badge.refunded { background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); }
.ready-at { margin: 0.4rem 0 0; font-size: 0.85rem; font-weight: 600; }
.item-note { display: block; font-size: .82rem; color: var(--mirestaurante-muted); }
.item-note.allergy { font-weight: 800; color: var(--mirestaurante-danger); }
.order-note { margin: 0 0 .5rem; font-size: .85rem; font-style: italic; color: var(--mirestaurante-muted); }
.allergy-alert { padding: .5rem .7rem; border-radius: .6rem; background: var(--mirestaurante-danger-soft); color: var(--mirestaurante-danger); }
.prep { display: inline-flex; align-items: center; gap: .5rem; margin: 0 0 .5rem; font-size: .9rem; }
.badge.paid { background: var(--mirestaurante-success-soft); color: var(--mirestaurante-success); }
.badge.unpaid { background: var(--mirestaurante-warning-soft); color: var(--mirestaurante-warning); }
.items { margin:.85rem 0; padding-left:1.1rem; color:var(--mirestaurante-muted); font-size:.9rem; }
.foot { display:flex; justify-content:space-between; align-items:center; gap:1rem; }
.actions { display:flex; gap:.45rem; flex-wrap:wrap; }
.actions button:not(.btn-primary) { border:1px solid var(--mirestaurante-line); background:var(--mirestaurante-panel-elevated); color:var(--mirestaurante-ink); border-radius:.7rem; padding:.65rem .85rem; cursor:pointer; font-weight:700; min-height:2.85rem; }
.link-btn { display:inline-flex; align-items:center; border:1px solid var(--mirestaurante-line); background:var(--mirestaurante-panel-elevated); color:var(--mirestaurante-ink); border-radius:.7rem; padding:.65rem .85rem; font-weight:700; text-decoration:none; min-height:2.85rem; }
.empty { color:var(--mirestaurante-muted); }
.ok { color: var(--mirestaurante-success); font-size: .88rem; margin: .5rem 0 0; }
.err { color: var(--mirestaurante-danger); font-size: .88rem; margin: .5rem 0 0; }
.modal-bg {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(10, 16, 14, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}
.modal {
  background: var(--mirestaurante-panel);
  color: var(--mirestaurante-ink);
  border-radius: 1.15rem 1.15rem 0.85rem 0.85rem;
  padding: 1.35rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  width: min(24rem, 100%);
  max-height: min(85vh, 32rem);
  overflow: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.85rem;
  overflow-x: hidden;
  border: 1px solid var(--mirestaurante-line);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.2);
}
.modal > * { min-width: 0; }
.modal select, .modal input[type="text"] { width: 100%; max-width: 100%; box-sizing: border-box; }
.modal h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.01em;
  font-size: 1.35rem;
}
.deny-note { margin: 0; padding: 0.6rem 0.7rem; border-radius: 0.7rem; background: var(--mirestaurante-primary-soft); font-size: 0.82rem; line-height: 1.4; }
.modal label { display: grid; gap: 0.35rem; font-size: 0.9rem; font-weight: 600; }
.modal select {
  min-height: 3rem;
  padding: 0.65rem 0.8rem;
  border-radius: 0.75rem;
  border: 1px solid var(--mirestaurante-line);
  background: var(--mirestaurante-panel-elevated);
  color: var(--mirestaurante-ink);
  font: inherit;
}
.modal-actions {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 0.55rem;
  margin-top: 0.25rem;
}
.modal-actions button {
  min-height: 3.15rem;
  border-radius: 0.85rem;
  border: 1px solid var(--mirestaurante-line);
  background: var(--mirestaurante-surface);
  color: var(--mirestaurante-ink);
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
}
.modal-actions .btn-primary {
  border: none;
  background: var(--mirestaurante-primary);
  color: var(--mirestaurante-on-primary);
}

@media (min-width: 720px) {
  .modal-bg {
    align-items: center;
    padding: 1.5rem;
  }
  .modal {
    border-radius: 1.15rem;
    padding: 1.4rem;
  }
}
.awaiting { margin: 0.5rem 0 0; padding: 0.7rem 0.85rem; border-radius: 0.8rem; border: 1.5px solid var(--mirestaurante-warning, #e8a020); background: color-mix(in srgb, var(--mirestaurante-warning, #e8a020) 12%, transparent); }
.awaiting p { margin: 0 0 0.5rem; font-size: 0.9rem; }
.awaiting-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.deliver { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--mirestaurante-muted); line-height: 1.4; }
.deliver strong { color: var(--mirestaurante-ink); }
.prep.pickup { display: grid; width: 100%; gap: 0.35rem; }
.prep.pickup input { width: 100%; box-sizing: border-box; min-height: 2.75rem; padding: 0.55rem 0.8rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.7rem; background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); font: inherit; }
.item-pick { margin: 0; padding: 0.6rem 0.8rem; border: 1px solid var(--mirestaurante-line); border-radius: 0.8rem; display: grid; gap: 0.4rem; }
.item-pick legend { padding: 0 0.3rem; font-size: 0.85rem; color: var(--mirestaurante-muted); }
.item-pick .pick { display: flex; align-items: center; gap: 0.5rem; font-size: 0.92rem; }
/* Tarjeta de pedido: cada bloque (avisos, entrega, platillos, botones) con el mismo aire, sin márgenes sueltos */
.card { display: flex; flex-direction: column; gap: 0.8rem; }
.card > * { margin: 0; }
.card .allergy-alert { line-height: 1.4; font-size: 0.88rem; }
.card .foot { flex-wrap: wrap; padding-top: 0.8rem; border-top: 1px solid var(--mirestaurante-line); }
.card .actions { justify-content: flex-end; }
</style>
