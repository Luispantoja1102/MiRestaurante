// Datos de los tickets para la térmica: lo mismo que muestran las vistas de impresión (PrintOrderView y PrintCashCloseView).
// Sin imports: la prueba del backend lo carga como módulo (backend/tests/escpos.test.js).

const pad = (n) => String(n).padStart(2, "0");

export function dateText(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export const shortId = (id) => String(id || "").slice(-8).toUpperCase();

const TYPE_LABEL = { restaurant: "RESTAURANTE", cafe: "CAFÉ", bar: "BAR", hotel: "HOTEL / RESTAURANTE", other: "ESTABLECIMIENTO" };
const PAY = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", platform: "Plataforma", other: "Otro" };
const PAY_SHORT = { cash: "EFEC", card: "TARJ", transfer: "TRANS", platform: "PLAT", other: "OTRO" };
const truncate = (s, n) => {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}.` : t;
};

/** Encabezado del negocio que comparten todos los tickets. */
function business(v) {
  return { shop: v.shop || "MiRestaurante", kind: TYPE_LABEL[v.businessType] || "RESTAURANTE", address: v.address || "", phone: v.phone || "" };
}

/**
 * Cuenta o comanda de un pedido.
 * v: { shop, businessType, address, phone, cashier, now }; labels: { modality: {id: texto}, channel: {id: texto} }
 */
export function orderTicketData(order, v = {}, labels = {}, kind = "receipt") {
  const kitchen = kind === "kitchen";
  const items = (order.items || []).map((i) => ({
    qty: Number(i.quantity) || 0,
    name: i.name || "Producto",
    unit: Number(i.price) || 0,
    amount: (Number(i.price) || 0) * (Number(i.quantity) || 0),
    options: (i.options || []).map((o) => ({ label: o.label || "", qty: Number(o.quantity) || 0, amount: (Number(o.unitPrice) || 0) * (Number(o.quantity) || 0) })),
    notes: i.notes || "",
  }));
  const info = [];
  if (order.source === "counter") info.push(["Atención", `MOSTRADOR${order.customerName ? ` - ${order.customerName}` : ""}`.toUpperCase()]);
  else info.push(["Mesa", String(order.tableName || "Sin mesa").toUpperCase()]);
  if (order.turno) info.push(["Turno", `#${order.turno}`]);
  info.push(["Servicio", String(labels.modality?.[order.modality] || order.modality || "").toUpperCase()]);
  if (order.channel && order.channel !== "local") info.push(["Origen", String(labels.channel?.[order.channel] || order.channel).toUpperCase()]);
  if (order.delivery) {
    info.push(["Entrega", String(order.delivery.name || "").toUpperCase()]);
    if (order.delivery.phone) info.push(["Teléfono", order.delivery.phone]);
    if (order.delivery.address) info.push(["Dirección", String(order.delivery.address).toUpperCase()]);
    if (order.delivery.reference) info.push(["Referencia", String(order.delivery.reference).toUpperCase()]);
  }
  info.push(["Apertura", dateText(order.createdAt)]);
  if (!kitchen && order.paidAt) info.push(["Cobro", dateText(order.paidAt)]);
  if (v.cashier) info.push(["Atendió", String(v.cashier).toUpperCase()]);
  info.push(["Artículos", items.reduce((n, i) => n + i.qty, 0)]);

  const paid = order.paymentStatus === "paid";
  const cashPaid = paid && order.paymentMethod === "cash" && order.amountReceived != null;
  return {
    ...business(v),
    folio: shortId(order.id),
    dateText: "",
    nowText: dateText(v.now || new Date()),
    info,
    items,
    subtotal: Number(order.subtotal) || 0,
    tax: Number(order.tax) || 0,
    taxLabel: "I.V.A. (8%)",
    deliveryFee: Number(order.deliveryFee) || 0,
    total: Number(order.total) || 0,
    // La propina sugerida no va en el mostrador: ya se pagó en el momento
    tips: order.source === "counter" ? [] : [10, 15, 20].map((p) => [`${p}%`, (Number(order.total) || 0) * (p / 100)]),
    paid,
    methodText: PAY[order.paymentMethod] || "-",
    received: cashPaid ? Number(order.amountReceived) : null,
    change: cashPaid ? Number(order.change) || 0 : null,
    notes: order.notes || "",
  };
}

/** Corte de caja. `orders`: los pedidos de esa sesión. */
export function cashTicketData(session, orders = [], v = {}) {
  const s = session || {};
  const info = [
    ["Abrió", String(s.openedBy || "-").toUpperCase()],
    ["Apertura", dateText(s.openedAt)],
  ];
  if (s.closedAt) info.push(["Cerró", String(s.closedBy || "-").toUpperCase()], ["Cierre", dateText(s.closedAt)]);
  info.push(["Tickets", orders.length]);
  return {
    ...business(v),
    folio: shortId(s.id),
    info,
    rows: [
      ["Fondo inicial", s.openingFloat],
      ["Ventas efectivo", (Number(s.expectedCash) || 0) - (Number(s.openingFloat) || 0)],
      ["Ventas tarjeta", s.expectedCard],
      ["Transferencia", s.expectedTransfer],
      ["Plataformas", s.expectedPlatform],
      ["Otros", s.expectedOther],
    ],
    totals: [
      ["Total ventas", s.expectedTotal],
      ["Ef. esperado", s.expectedCash],
      ["Ef. contado", s.countedCash],
    ],
    difference: Number(s.difference) || 0,
    tickets: orders.map((o) => ({ table: truncate(o.tableName || "S/M", 10), pay: PAY_SHORT[o.paymentMethod] || "-", total: Number(o.total) || 0 })),
    notes: s.notes || "",
  };
}
