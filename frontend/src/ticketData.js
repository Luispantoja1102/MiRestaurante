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

// Iconos del encabezado (cuadrícula de 24): los usan la vista del navegador (SVG) y la imagen de la térmica (Path2D)
export const TICKET_ICONS = {
  fork: [{ d: "M7 3v6M10 3v6M13 3v6M7 9a3 3 0 0 0 6 0M10 12v9" }],
  knife: [{ d: "M9.5 3c3.4 1.4 4.8 4.6 4.8 9H9.5z", fill: true }, { d: "M9.5 3v18" }],
  plate: [{ d: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19z" }, { d: "M12 6.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 1 0 0-11.2z" }],
  cup: [{ d: "M4.5 10h11v4a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 4.5 14z" }, { d: "M15.5 11.5h1.2a2.4 2.4 0 0 1 0 4.8h-1.2" }, { d: "M8 3c-1.2 1.2 1.2 2.4 0 3.6M12 3c-1.2 1.2 1.2 2.4 0 3.6" }, { d: "M3 21h14" }],
  spoon: [{ d: "M12 3c-2 0-3 2-3 4s1 4 3 4 3-2 3-4-1-4-3-4zM12 11v10" }],
  bean: [{ d: "M12 3.5c-4 0-6.5 4-6.5 8.5s2.5 8.5 6.5 8.5 6.5-4 6.5-8.5S16 3.5 12 3.5z" }, { d: "M12 3.5c2.5 3.5-2.5 5 0 8.5s-2.5 5 0 8.5" }],
  martini: [{ d: "M3.5 4h17L12 13z" }, { d: "M12 13v7M7.5 20h9" }],
  diamond: [{ d: "M12 5l4.5 7-4.5 7-4.5-7z", fill: true }],
  star: [{ d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", fill: true }],
  bell: [{ d: "M4 17a8 8 0 0 1 16 0z" }, { d: "M2.5 20.5h19" }, { d: "M12 9V6.5M10 6.5h4" }],
  tag: [{ d: "M3.5 12.5V4.5h8l9 9-8 8z" }, { d: "M8 8.5h.01" }],
};

// Cómo se ve el ticket según el tipo de establecimiento: etiqueta, iconos (izquierda, centro, derecha), cierre y propina
export const TICKET_PROFILES = {
  restaurant: { label: "RESTAURANTE", icons: ["fork", "plate", "knife"], bye: "¡Buen provecho!", thanks: "Gracias por su visita · Le esperamos pronto", order: "Su orden", tips: true },
  cafe: { label: "CAFÉ", icons: ["spoon", "cup", "bean"], bye: "¡Que lo disfrutes!", thanks: "Gracias por su visita · Vuelva pronto", order: "Su pedido", tips: false },
  bar: { label: "BAR", icons: ["diamond", "martini", "diamond"], bye: "¡Salud!", thanks: "Gracias por su visita · Vuelva pronto", order: "Su consumo", tips: true },
  hotel: { label: "HOTEL · RESTAURANTE", icons: ["star", "bell", "star"], bye: "¡Buen provecho!", thanks: "Gracias por su preferencia", order: "Su orden", tips: true },
  other: { label: "ESTABLECIMIENTO", icons: ["star", "tag", "star"], bye: "¡Gracias!", thanks: "Gracias por su preferencia · Vuelva pronto", order: "Su pedido", tips: false },
};
export const ticketProfile = (businessType) => TICKET_PROFILES[businessType] || TICKET_PROFILES.restaurant;
const PAY = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", platform: "Plataforma", other: "Otro" };
const PAY_SHORT = { cash: "EFEC", card: "TARJ", transfer: "TRANS", platform: "PLAT", other: "OTRO" };
const truncate = (s, n) => {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}.` : t;
};

/** Encabezado del negocio que comparten todos los tickets. */
function business(v) {
  const p = ticketProfile(v.businessType);
  return { shop: v.shop || "MiRestaurante", kind: p.label, icons: p.icons, bye: p.bye, thanks: p.thanks, orderTitle: p.order, address: v.address || "", phone: v.phone || "" };
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
    // La propina sugerida no va en el mostrador (ya se pagó) ni en los rubros donde no es costumbre (café, otro)
    tips: order.source === "counter" || !ticketProfile(v.businessType).tips ? [] : [10, 15, 20].map((p) => [`${p}%`, (Number(order.total) || 0) * (p / 100)]),
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
