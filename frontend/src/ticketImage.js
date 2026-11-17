// Cuenta con diseño de restaurante dibujada como imagen (canvas): se manda a la térmica como imagen blanco y negro.
// Usa los mismos datos que el ticket de texto (orderTicketData). Solo corre en el navegador.
import { money, rasterBytes } from "./escpos";

const SERIF = '"Georgia","Times New Roman",serif';
const SANS = '"Segoe UI","Helvetica Neue",Arial,sans-serif';
const BASE = 576; // puntos de una térmica de 80 mm; la de 58 mm (384) escala todo

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

/**
 * Dibuja la cuenta. `t` = orderTicketData(...). Devuelve un canvas con el alto justo.
 * @param {{width?: number, logoUrl?: string}} opts width: 576 (80 mm) o 384 (58 mm)
 */
export async function renderReceiptImage(t, { width = BASE, logoUrl = "" } = {}) {
  const k = width / BASE;
  const S = (n) => Math.round(n * k);
  const logo = await loadImage(logoUrl);

  const c = document.createElement("canvas");
  c.width = width;
  c.height = S(1800 + t.items.length * 260 + (t.notes ? 220 : 0));
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.strokeStyle = "#000";

  const M = S(22);
  const L = M;
  const R = width - M;
  const inner = R - L;
  let y = S(18);

  const font = (size, weight = "400", family = SANS, style = "") => {
    g.font = `${style} ${weight} ${S(size)}px ${family}`.trim();
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
  const center = (text, size, weight, family, style, gap = 1.3, space = 0) => {
    font(size, weight, family, style);
    spacing(space);
    g.textAlign = "center";
    for (const line of wrapLines(text, inner)) {
      g.fillText(line, width / 2 + (space ? S(space) / 2 : 0), y + S(size));
      y += S(size * gap);
    }
    spacing(0);
  };
  const left = (text, size, weight = "400", style = "", x = L, maxW = inner) => {
    font(size, weight, SANS, style);
    g.textAlign = "left";
    for (const line of wrapLines(text, maxW)) {
      g.fillText(line, x, y + S(size));
      y += S(size * 1.3);
    }
  };
  const lr = (a, b, size, weight = "400", family = SANS) => {
    font(size, weight, family);
    g.textAlign = "left";
    g.fillText(a, L, y + S(size));
    g.textAlign = "right";
    g.fillText(b, R, y + S(size));
    y += S(size * 1.45);
  };
  const dashed = (gap = 8) => {
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
  const ornament = () => {
    const mid = width / 2;
    g.lineWidth = S(2);
    g.beginPath();
    g.moveTo(L, y + S(10));
    g.lineTo(mid - S(26), y + S(10));
    g.moveTo(mid + S(26), y + S(10));
    g.lineTo(R, y + S(10));
    g.stroke();
    // un rombo en el centro, como remate
    g.beginPath();
    g.moveTo(mid, y + S(1));
    g.lineTo(mid + S(9), y + S(10));
    g.lineTo(mid, y + S(19));
    g.lineTo(mid - S(9), y + S(10));
    g.closePath();
    g.fill();
    y += S(26);
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

  // ——— Encabezado ———
  if (logo) {
    try {
      const l = ditheredLogo(logo, S(190), S(150));
      g.drawImage(l, Math.round((width - l.width) / 2), y);
      y += l.height + S(10);
    } catch {
      /* logo de otro origen o ilegible: se imprime sin él */
    }
  }
  center(String(t.shop).toUpperCase(), 40, "700", SERIF);
  center(t.kind, 15, "600", SANS, "", 1.5, 5);
  if (t.address) center(t.address, 17, "400");
  if (t.phone) center(`Tel. ${t.phone}`, 17, "400");
  y += S(8);
  ornament();

  // ——— Título y mesa ———
  g.fillStyle = "#000";
  const bh = S(46);
  roundRect(L + S(70), y, inner - S(140), bh, S(23));
  g.fill();
  g.fillStyle = "#fff";
  font(24, "700", SANS);
  spacing(4);
  g.textAlign = "center";
  g.fillText("CUENTA", width / 2 + S(2), y + S(32));
  spacing(0);
  g.fillStyle = "#000";
  y += bh + S(14);

  const table = t.info.find(([label]) => label === "Mesa" || label === "Atención");
  if (table) {
    g.lineWidth = S(3);
    roundRect(L, y, inner, S(64), S(10));
    g.stroke();
    // «MESA 4»: el nombre ya dice mesa, no se repite la etiqueta
    const redundant = String(table[1]).startsWith(table[0].toUpperCase());
    if (!redundant) {
      font(15, "600");
      g.textAlign = "left";
      g.fillText(table[0].toUpperCase(), L + S(14), y + S(24));
    }
    font(32, "700", SERIF);
    g.textAlign = "center";
    g.fillText(String(table[1]), width / 2, y + S(redundant ? 43 : 48));
    const turno = t.info.find(([label]) => label === "Turno");
    if (turno) {
      font(22, "700");
      g.textAlign = "right";
      g.fillText(String(turno[1]), R - S(14), y + S(40));
    }
    y += S(64) + S(12);
  }

  // ——— Datos del servicio (en dos columnas) ———
  const rest = t.info.filter((r) => r !== table && r[0] !== "Turno" && r[0] !== "Artículos");
  const colW = Math.floor(inner / 2) - S(6);
  for (let i = 0; i < rest.length; i += 2) {
    const startY = y;
    let h = 0;
    for (let j = 0; j < 2 && rest[i + j]; j++) {
      y = startY;
      const [label, value] = rest[i + j];
      const x = L + j * (colW + S(12));
      font(13, "600");
      g.textAlign = "left";
      g.fillText(String(label).toUpperCase(), x, y + S(13));
      y += S(17);
      left(String(value), 17, "600", "", x, colW);
      h = Math.max(h, y - startY);
    }
    y = startY + h + S(6);
  }
  y += S(2);
  dashed();

  // ——— Consumo ———
  font(13, "700");
  spacing(2);
  g.textAlign = "left";
  g.fillText("CONSUMO", L, y + S(13));
  g.textAlign = "right";
  g.fillText("IMPORTE", R, y + S(13));
  spacing(0);
  y += S(24);

  for (const item of t.items) {
    const boxW = S(56);
    const startY = y;
    g.lineWidth = S(2.5);
    roundRect(L, y + S(2), boxW, S(38), S(8));
    g.stroke();
    font(22, "700");
    g.textAlign = "center";
    g.fillText(`${item.qty}×`, L + boxW / 2, y + S(30));
    const nameX = L + boxW + S(14);
    const amountW = S(110);
    font(21, "700");
    g.textAlign = "right";
    g.fillText(money(item.amount), R, y + S(21)); // misma línea que el nombre
    y = startY;
    left(item.name, 21, "700", "", nameX, R - nameX - amountW);
    y = Math.max(y, startY + S(40));
    if (item.qty > 1) left(`${money(item.unit)} c/u`, 15, "400", "", nameX);
    for (const o of item.options) {
      left(`+ ${o.label} ×${o.qty}${o.amount > 0 ? `  (${money(o.amount)})` : ""}`, 16, "400", "", nameX, R - nameX);
    }
    if (item.notes) left(`“${item.notes}”`, 16, "400", "italic", nameX, R - nameX);
    y += S(10);
  }
  dashed();

  // ——— Totales ———
  lr("Subtotal", money(t.subtotal), 19);
  if (t.tax) lr(t.taxLabel.replace("I.V.A.", "IVA"), money(t.tax), 19);
  if (t.deliveryFee) lr("Envío", money(t.deliveryFee), 19);
  y += S(6);
  g.lineWidth = S(4);
  roundRect(L, y, inner, S(66), S(10));
  g.stroke();
  g.lineWidth = S(1.5);
  roundRect(L + S(6), y + S(6), inner - S(12), S(54), S(7));
  g.stroke();
  font(22, "700", SANS);
  spacing(3);
  g.textAlign = "left";
  g.fillText("TOTAL", L + S(20), y + S(43));
  spacing(0);
  font(36, "700", SERIF);
  g.textAlign = "right";
  g.fillText(money(t.total), R - S(20), y + S(47));
  y += S(66) + S(18);

  // ——— Propina sugerida ———
  if (t.tips.length) {
    center("Propina sugerida", 18, "700", SERIF, "italic", 1.4);
    y += S(2);
    const gap = S(10);
    const w = Math.floor((inner - gap * (t.tips.length - 1)) / t.tips.length);
    t.tips.forEach(([label, amount], i) => {
      const x = L + i * (w + gap);
      g.lineWidth = S(2);
      roundRect(x, y, w, S(62), S(9));
      g.stroke();
      font(15, "600");
      g.textAlign = "center";
      g.fillText(label, x + w / 2, y + S(21));
      font(19, "700");
      g.fillText(money(amount), x + w / 2, y + S(48));
    });
    y += S(62) + S(14);
    font(17, "400");
    g.textAlign = "left";
    g.fillText("Propina: $", L, y + S(17));
    g.lineWidth = S(1.5);
    g.beginPath();
    g.moveTo(L + S(100), y + S(19));
    g.lineTo(R, y + S(19));
    g.stroke();
    y += S(36);
  }

  // ——— Estado del pago ———
  if (t.paid) {
    lr(t.methodText, money(t.total), 19, "600");
    if (t.received != null) {
      lr("Recibido", money(t.received), 18);
      lr("Cambio", money(t.change), 18);
    }
    // sello «PAGADO» ligeramente girado
    g.save();
    g.translate(width / 2, y + S(42));
    g.rotate(-0.07);
    g.lineWidth = S(4);
    roundRect(-S(110), -S(30), S(220), S(60), S(8));
    g.stroke();
    font(34, "700", SANS);
    spacing(5);
    g.textAlign = "center";
    g.fillText("PAGADO", S(2), S(12));
    spacing(0);
    g.restore();
    y += S(96);
  } else {
    g.save();
    g.lineWidth = S(3);
    g.setLineDash([S(10), S(7)]);
    roundRect(L, y, inner, S(58), S(8));
    g.stroke();
    g.restore();
    font(20, "700");
    spacing(2);
    g.textAlign = "center";
    g.fillText("PENDIENTE DE PAGO", width / 2, y + S(37));
    spacing(0);
    y += S(58) + S(16);
  }

  if (t.notes) {
    dashed();
    left(`Observaciones: ${t.notes}`, 17, "400", "italic");
    y += S(4);
  }

  // ——— Despedida ———
  y += S(6);
  ornament();
  center("¡Gracias por su visita!", 30, "700", SERIF, "italic", 1.3);
  center("Buen provecho · Le esperamos pronto", 17, "400");
  y += S(8);
  center("Este comprobante no es factura fiscal. Solicite factura en caja si aplica.", 13, "400", SANS, "", 1.35);
  center(`Folio ${t.folio}`, 13, "600");
  y += S(6);

  // Borde de ticket recortado
  g.beginPath();
  g.moveTo(0, y);
  const tooth = S(14);
  for (let x = 0; x < width; x += tooth) {
    g.lineTo(x + tooth / 2, y + S(8));
    g.lineTo(x + tooth, y);
  }
  g.lineWidth = S(2);
  g.stroke();
  y += S(16);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = Math.ceil(y);
  out.getContext("2d").drawImage(c, 0, 0);
  return out;
}

/** Bytes ESC/POS de la cuenta dibujada. */
export async function receiptImageBytes(t, { width = BASE, logoUrl = "", openDrawer = false } = {}) {
  const canvas = await renderReceiptImage(t, { width, logoUrl });
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return rasterBytes(canvas.width, canvas.height, data, { openDrawer });
}
