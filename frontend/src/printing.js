// Imprime cuentas, comandas y cortes de caja.
// Con una térmica configurada en ESTE dispositivo (menú Más → Impresora) sale directo; si no, se abre la vista de impresión
// del navegador como siempre. Si la térmica falla, se ofrece imprimir con el navegador para no perder el ticket.
import { apiService } from "./apiService";
import { authStore } from "./authStore";
import { venueStore } from "./venueStore";
import { channelLabel, modalityLabel } from "./labels";
import { buildCashClose, buildKitchen, buildReceipt } from "./escpos";
import { cashTicketData, orderTicketData } from "./ticketData";
import { directPrinting, paperCols, printBytes, printerStore } from "./thermalPrinter";

const venue = () => ({
  shop: venueStore.businessName,
  businessType: venueStore.businessType,
  address: venueStore.address,
  phone: venueStore.phone,
  cashier: authStore.username,
});

const orderUrl = (id, kind, auto) => `/print/order/${id}?mode=${kind}${auto ? "&autoprint=1" : ""}`;
const cashUrl = (id) => `/print/cash/${id}?autoprint=1`;

/** ¿Hay que imprimir el ticket sin preguntar al cobrar? (térmica activa y esa opción encendida) */
export const shouldAutoPrint = () => directPrinting() && printerStore.autoPrint;

function fallback(error, url) {
  if (window.confirm(`No se pudo imprimir en la térmica: ${error.message}\n\n¿Imprimir con el navegador?`)) window.open(url, "_blank");
  return false;
}

/**
 * Cuenta (kind «receipt») o comanda de cocina (kind «kitchen») de un pedido. Acepta el pedido o su id.
 * @returns true si se mandó a imprimir
 */
export async function printOrder(orderOrId, kind = "receipt", { auto = false } = {}) {
  const given = orderOrId && typeof orderOrId === "object" ? orderOrId : null;
  const id = given ? given.id : orderOrId;
  if (!directPrinting()) {
    window.open(orderUrl(id, kind, auto), "_blank");
    return true;
  }
  try {
    const order = given?.items ? given : await apiService.getOrdersById(String(id));
    const t = orderTicketData(order, venue(), { modality: modalityLabel, channel: channelLabel }, kind);
    const cols = paperCols();
    // El cajón solo se abre con un cobro en efectivo
    const drawer = printerStore.drawer && kind === "receipt" && order.paymentStatus === "paid" && order.paymentMethod === "cash";
    await printBytes(kind === "kitchen" ? buildKitchen(t, { cols }) : buildReceipt(t, { cols, openDrawer: drawer }));
    return true;
  } catch (error) {
    return fallback(error, orderUrl(id, kind, true));
  }
}

/** Corte de caja de una sesión ya cerrada, en la térmica de este dispositivo. */
export async function printCashClose(sessionId) {
  try {
    const session = await apiService.getCashSessionById(String(sessionId));
    const all = await apiService.getOrders();
    const orders = (all || []).filter((o) => o.cashSessionId === String(sessionId));
    await printBytes(buildCashClose(cashTicketData(session, orders, venue()), { cols: paperCols() }));
    return true;
  } catch (error) {
    return fallback(error, cashUrl(sessionId));
  }
}

export { directPrinting };
