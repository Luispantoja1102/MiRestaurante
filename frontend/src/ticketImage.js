// Cuenta con diseño de restaurante dibujada como imagen (canvas): se manda a la térmica como imagen blanco y negro.
// Usa los mismos datos que el ticket de texto (orderTicketData). Solo corre en el navegador.
// Se dibuja compacta: una imagen más corta se transmite y se imprime más rápido.
import { money, rasterBytes } from "./escpos";
import { TICKET_ICONS } from "./ticketData";

const DISPLAY = '"Bricolage Grotesque","Georgia","Times New Roman",serif';
const HAND = '"Caveat","Segoe Print","Bradley Hand",cursive';
const SANS = '"Figtree","Segoe UI","Helvetica Neue",Arial,sans-serif';
const BASE = 512; // puntos útiles de una térmica de 80 mm (72 mm de impresión); todo se escala a partir de aquí

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Logo en blanco y negro con tramado (Floyd–Steinberg) para que se vea bien en la térmica. */
function ditheredLogo(img, maxW, maxH) {
  const w0 = img.naturalWidth || 200;
  const h0 = img.naturalHeight || 200;
  const r = Math.min(maxW / w0, maxH / h0);
  const w = Math.max(1, Math.round(w0 * r));
  const h = Math.max(1, Math.round(h0 * r));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = lum[i];
      const val = old < 128 ? 0 : 255;
      const err = old - val;
      if (x + 1 < w) lum[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) lum[i + w - 1] += (err * 3) / 16;
        lum[i + w] += (err * 5) / 16;
        if (x + 1 < w) lum[i + w + 1] += err / 16;
      }
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = val;
      px[i * 4 + 3] = 255;
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('800 30px "Bricolage Grotesque"'),
      document.fonts.load('700 30px "Caveat"'),
      document.fonts.load('600 16px "Figtree"'),
      document.fonts.load('800 16px "Figtree"'),
    ]);
  } catch {
    /* sin tipografías de internet se usan las del sistema */
  }
}

/**
 * Dibuja la cuenta. `t` = orderTicketData(...). Devuelve un canvas con el alto justo.
 * @param {{width?: number, logoUrl?: string}} opts width: puntos de ancho (512 = 80 mm estándar, 576 = 80 mm completo, 384 = 58 mm)
 */
export async function renderReceiptImage(t, { width = BASE, logoUrl = "" } = {}) {
  const k = width / BASE;
  const S = (n) => Math.round(n * k);
  const [logo] = await Promise.all([loadImage(logoUrl), loadFonts()]);

  const c = document.createElement("canvas");
  c.width = width;
  c.height = S(1500 + t.items.length * 220 + (t.notes ? 200 : 0));
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.strokeStyle = "#000";

  const L = S(16);
  const R = width - S(16);
  const inner = R - L;
  const mid = width / 2;
  let y = S(10);

  // En papel térmico las líneas finas se pierden: un peso más y letras no menores a 12 puntos
  const HEAVIER = { 400: 600, 500: 600, 600: 700, 700: 800 };
  const font = (size, weight = "400", family = SANS, style = "") => {
    const w = family === SANS ? HEAVIER[weight] || weight : weight;
    g.font = `${style} ${w} ${S(Math.max(size, 12))}px ${family}`.trim();
  };
  const spacing = (px) => {
    if ("letterSpacing" in g) g.letterSpacing = `${S(px)}px`;
  };
  const wrapLines = (text, maxW) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width <= maxW || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const center = (text, size, weight, family, style, gap = 1.25, space = 0) => {
    font(size, weight, family, style);
    spacing(space);
    g.textAlign = "center";
    for (const line of wrapLines(text, inner)) {
      g.fillText(line, mid + (space ? S(space) / 2 : 0), y + S(size));
      y += S(size * gap);
    }
    spacing(0);
  };
  const left = (text, size, weight = "400", style = "", x = L, maxW = inner, family = SANS) => {
    font(size, weight, family, style);
    g.textAlign = "left";
    for (const line of wrapLines(text, maxW)) {
      g.fillText(line, x, y + S(size));
      y += S(size * 1.25);
    }
  };
  const lr = (a, b, size, weight = "400") => {
    font(size, weight);
    g.textAlign = "left";
    g.fillText(a, L, y + S(size));
    g.textAlign = "right";
    g.fillText(b, R, y + S(size));
    y += S(size * 1.4);
  };
  const dashed = (gap = 6) => {
    g.save();
    g.lineWidth = S(2);
    g.setLineDash([S(6), S(5)]);
    g.beginPath();
    g.moveTo(L, y + S(gap));
    g.lineTo(R, y + S(gap));
    g.stroke();
    g.restore();
    y += S(gap * 2);
  };
  const roundRect = (x, yy, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, yy);
    g.arcTo(x + w, yy, x + w, yy + h, r);
    g.arcTo(x + w, yy + h, x, yy + h, r);
    g.arcTo(x, yy + h, x, yy, r);
    g.arcTo(x, yy, x + w, yy, r);
    g.closePath();
  };
  const doubleRule = (yy) => {
    g.lineWidth = S(2);
    g.beginPath();
    g.moveTo(L, yy);
    g.lineTo(R, yy);
    g.moveTo(L, yy + S(5));
    g.lineTo(R, yy + S(5));
    g.stroke();
  };
  // Título de sección con una línea a cada lado
  const section = (text) => {
    font(12, "800");
    spacing(3);
    const w = g.measureText(text).width;
    spacing(0);
    const yc = y + S(8);
    g.lineWidth = S(1.5);
    g.beginPath();
    g.moveTo(L, yc);
    g.lineTo(mid - w / 2 - S(8), yc);
    g.moveTo(mid + w / 2 + S(8), yc);
    g.lineTo(R, yc);
    g.stroke();
    spacing(3);
    g.textAlign = "center";
    g.fillText(text, mid + S(1.5), y + S(13));
    spacing(0);
    y += S(24);
  };

  // Un icono de TICKET_ICONS (cuadrícula de 24) centrado en (cx, cy)
  const drawIcon = (name, cx, cy, size) => {
    g.save();
    g.translate(cx - size / 2, cy - size / 2);
    g.scale(size / 24, size / 24);
    g.lineWidth = 1.8;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const p of TICKET_ICONS[name] || []) {
      const path = new Path2D(p.d);
      if (p.fill) g.fill(path);
      else g.stroke(path);
    }
    g.restore();
  };
  // Tres iconos del rubro (servicio de mesa, taza, copa, campana…) con una línea a cada lado
  const tableSetting = () => {
    const yc = y + S(18);
    const [a, b, c2] = t.icons || ["fork", "plate", "knife"];
    g.lineWidth = S(2);
    g.beginPath();
    g.moveTo(L, yc);
    g.lineTo(mid - S(74), yc);
    g.moveTo(mid + S(74), yc);
    g.lineTo(R, yc);
    g.stroke();
    const side = (name) => (["diamond", "star"].includes(name) ? S(22) : S(36));
    drawIcon(b, mid, yc, S(38));
    drawIcon(a, mid - S(46), yc, side(a));
    drawIcon(c2, mid + S(46), yc, side(c2));
    y += S(40);
  };

  const get = (label) => t.info.find(([l]) => l === label)?.[1];

  // ——— Encabezado ———
  if (logo) {
    try {
      const l = ditheredLogo(logo, S(170), S(110));
      g.drawImage(l, Math.round((width - l.width) / 2), y);
      y += l.height + S(8);
    } catch {
      /* logo de otro origen o ilegible: se imprime sin él */
    }
  }
  tableSetting();
  center(String(t.shop).toUpperCase(), 34, "800", DISPLAY, "", 1.1);
  center(`✦  ${t.kind}  ✦`, 12, "800", SANS, "", 1.5, 3);
  if (t.address) center(t.address, 14, "400");
  if (t.phone) center(`Tel. ${t.phone}`, 14, "400");
  y += S(6);

  // ——— Título ———
  {
    font(17, "900");
    spacing(6);
    const w = g.measureText("CUENTA").width;
    spacing(0);
    const yc = y + S(11);
    g.lineWidth = S(1.5);
    for (const dy of [-2.5, 2.5]) {
      g.beginPath();
      g.moveTo(L, yc + S(dy));
      g.lineTo(mid - w / 2 - S(10), yc + S(dy));
      g.moveTo(mid + w / 2 + S(10), yc + S(dy));
      g.lineTo(R, yc + S(dy));
      g.stroke();
    }
    spacing(6);
    g.textAlign = "center";
    g.fillText("CUENTA", mid + S(3), y + S(17));
    spacing(0);
    y += S(30);
  }

  // ——— Mesa (o turno) en un círculo, con la fecha al lado ———
  {
    const counter = Boolean(get("Atención"));
    const badgeTop = counter ? "TURNO" : "MESA";
    const badgeMain = counter ? String(get("Turno") || "").replace("#", "") || "—" : String(get("Mesa") || "").replace(/^MESA\s*/i, "") || "—";
    const who = counter ? get("Atención") : get("Servicio");
    const stamp = get("Cobro") || get("Apertura") || "";
    const r = S(40);
    const cx = L + r + S(4);
    const cy = y + r + S(2);
    g.lineWidth = S(3);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = S(1.5);
    g.beginPath();
    g.arc(cx, cy, r + S(4.5), 0, Math.PI * 2);
    g.stroke();
    font(11, "800");
    spacing(2.5);
    g.textAlign = "center";
    g.fillText(badgeTop, cx + S(1.2), cy - S(15));
    spacing(0);
    if (badgeMain.length > 3) {
      font(20, "800", DISPLAY);
      g.fillText(badgeMain.slice(0, 7), cx, cy + S(14));
    } else {
      font(38, "800", DISPLAY);
      g.fillText(badgeMain, cx, cy + S(20));
    }
    const tx = cx + r + S(18);
    const maxW = R - tx;
    const startY = y;
    y = startY + S(4);
    if (who) left(String(who), 20, "900", "", tx, maxW);
    if (stamp) {
      const [d, hm] = stamp.split(" ");
      left(d || stamp, 16, "600", "", tx, maxW);
      if (hm) left(hm, 17, "800", "", tx, maxW);
    }
    const cashier = get("Atendió");
    if (cashier) left(`Atendió ${cashier}`, 13, "400", "", tx, maxW);
    y = Math.max(y, cy + r + S(10));
  }

  // Los demás datos del servicio (origen, entrega…)
  const SHOWN = new Set(["Mesa", "Atención", "Turno", "Servicio", "Apertura", "Cobro", "Atendió", "Artículos"]);
  for (const [label, value] of t.info.filter(([l]) => !SHOWN.has(l))) lr(label, String(value), 15, "600");
  y += S(4);

  // ——— Su orden ———
  section(String(t.orderTitle || "Su orden").toUpperCase());
  for (const item of t.items) {
    const startY = y;
    font(26, "800", DISPLAY);
    g.textAlign = "left";
    g.fillText(`${item.qty}×`, L, y + S(24));
    const nameX = L + S(50);
    font(20, "800");
    g.textAlign = "right";
    g.fillText(money(item.amount), R, y + S(21));
    const amountW = g.measureText(money(item.amount)).width + S(10);
    y = startY;
    left(item.name, 20, "800", "", nameX, R - nameX - amountW);
    y = Math.max(y, startY + S(28));
    if (item.qty > 1) left(`${money(item.unit)} c/u`, 14, "400", "", nameX);
    for (const o of item.options) left(`+ ${o.label} ×${o.qty}${o.amount > 0 ? `  (${money(o.amount)})` : ""}`, 14, "400", "", nameX, R - nameX);
    if (item.notes) left(`“${item.notes}”`, 14, "400", "italic", nameX, R - nameX);
    y += S(6);
  }
  dashed(5);

  // ——— Totales ———
  // Pedidos nuevos: el IVA ya va dentro del subtotal (se avisa bajo el total). Los de antes lo sumaban aparte.
  if (!t.taxIncluded || t.deliveryFee) lr("Subtotal", money(t.subtotal), 16);
  if (!t.taxIncluded && t.tax) lr(t.taxLabel.replace("I.V.A.", "IVA"), money(t.tax), 16);
  if (t.deliveryFee) lr("Envío", money(t.deliveryFee), 16);
  y += S(6);
  doubleRule(y);
  y += S(12);
  font(18, "900");
  spacing(5);
  g.textAlign = "left";
  g.fillText("TOTAL", L, y + S(30));
  spacing(0);
  font(36, "800", DISPLAY);
  g.textAlign = "right";
  g.fillText(money(t.total), R, y + S(33));
  y += S(46);
  doubleRule(y);
  y += S(8);
  if (t.taxIncluded) {
    font(14, "600");
    g.textAlign = "right";
    g.fillText(`Incluye ${t.taxLabel.replace("I.V.A.", "IVA")}: ${money(t.tax)}`, R, y + S(14));
    y += S(22);
  }
  y += S(10);

  // ——— Propina sugerida y renglones a mano ———
  if (t.tips.length && !t.paid) {
    section("PROPINA SUGERIDA");
    const gap = S(8);
    const w = Math.floor((inner - gap * (t.tips.length - 1)) / t.tips.length);
    t.tips.forEach(([label, amount], i) => {
      const x = L + i * (w + gap);
      g.lineWidth = S(2);
      roundRect(x, y, w, S(50), S(8));
      g.stroke();
      font(12, "700");
      g.textAlign = "center";
      g.fillText(label, x + w / 2, y + S(18));
      font(17, "800");
      g.fillText(money(amount), x + w / 2, y + S(40));
    });
    y += S(60);
    for (const text of ["Propina $", "Total con propina $"]) {
      font(15, "700");
      g.textAlign = "left";
      g.fillText(text, L, y + S(18));
      const w2 = g.measureText(text).width;
      g.lineWidth = S(1.5);
      g.beginPath();
      g.moveTo(L + w2 + S(8), y + S(20));
      g.lineTo(R, y + S(20));
      g.stroke();
      y += S(30);
    }
    y += S(2);
  }

  // ——— Pago ———
  if (t.paid) {
    lr(t.methodText, money(t.total), 17, "700");
    if (t.received != null) {
      lr("Recibido", money(t.received), 16);
      lr("Cambio", money(t.change), 16, "700");
    }
    y += S(4);
  }
  // Sello: PAGADO (girado) o recuadro punteado si falta cobrar
  if (t.paid) {
    g.save();
    g.translate(mid, y + S(30));
    g.rotate(-0.06);
    g.lineWidth = S(3.5);
    roundRect(-S(88), -S(23), S(176), S(46), S(8));
    g.stroke();
    font(28, "900");
    spacing(4);
    g.textAlign = "center";
    g.fillText("PAGADO", S(2), S(10));
    spacing(0);
    g.restore();
    y += S(68);
  } else {
    g.save();
    g.lineWidth = S(2.5);
    g.setLineDash([S(9), S(6)]);
    roundRect(L, y, inner, S(44), S(8));
    g.stroke();
    g.restore();
    font(17, "800");
    spacing(2);
    g.textAlign = "center";
    g.fillText("PENDIENTE DE PAGO", mid + S(1), y + S(29));
    spacing(0);
    y += S(56);
  }

  if (t.notes) {
    left(`Observaciones: ${t.notes}`, 14, "400", "italic");
    y += S(2);
  }

  // ——— Despedida ———
  center(t.bye || "¡Gracias!", 38, "700", HAND, "", 1.05);
  center(t.thanks || "Gracias por su visita", 14, "700");
  y += S(4);
  center("Este comprobante no es factura fiscal. Solicite factura en caja si aplica.", 11, "400", SANS, "", 1.3);
  center(`Folio ${t.folio}`, 11, "700");
  y += S(2);

  // Borde de ticket recortado
  g.beginPath();
  g.moveTo(0, y);
  const tooth = S(12);
  for (let x = 0; x < width; x += tooth) {
    g.lineTo(x + tooth / 2, y + S(7));
    g.lineTo(x + tooth, y);
  }
  g.lineWidth = S(2);
  g.stroke();
  y += S(12);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = Math.ceil(y);
  out.getContext("2d").drawImage(c, 0, 0);
  return out;
}

/**
 * Regla para saber cuántos puntos imprime de verdad una impresora: líneas verticales marcadas con su número.
 * La última línea que sale completa en el papel es el ancho útil.
 */
export function widthTestBytes() {
  const width = 576;
  const marks = [384, 416, 448, 480, 512, 544, 576];
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, c.height);
  g.fillStyle = "#000";
  g.strokeStyle = "#000";
  g.font = `700 20px ${SANS}`;
  g.textAlign = "left";
  g.fillText("PRUEBA DE ANCHO", 8, 28);
  g.font = `400 14px ${SANS}`;
  g.fillText("La última línea que veas completa", 8, 50);
  g.fillText("en el papel es el ancho de tu impresora.", 8, 68);
  marks.forEach((m, i) => {
    const x = m - 2;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 80 + (i % 2) * 14);
    g.lineTo(x, 280);
    g.stroke();
    g.font = `700 16px ${SANS}`;
    g.textAlign = "right";
    g.fillText(String(m), x - 4, 100 + (i % 2) * 14 + 14);
  });
  g.lineWidth = 3;
  g.strokeRect(2, 82, width - 4, 198);
  const { data } = g.getImageData(0, 0, width, c.height);
  return rasterBytes(width, c.height, data);
}

/** Bytes ESC/POS de la cuenta dibujada. */
export async function receiptImageBytes(t, { width = BASE, logoUrl = "", openDrawer = false, threshold = 190 } = {}) {
  const canvas = await renderReceiptImage(t, { width, logoUrl });
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  // threshold más alto = más negro: los bordes grises de las letras también se imprimen
  return rasterBytes(canvas.width, canvas.height, data, { openDrawer, threshold });
}
