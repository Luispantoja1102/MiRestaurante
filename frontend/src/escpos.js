// Ticket en comandos ESC/POS para impresoras térmicas (58 / 80 mm).
// Sin imports: la prueba del backend lo carga como módulo (backend/tests/escpos.test.js).

const ESC = 0x1b;
const GS = 0x1d;

// Página de códigos PC850 (ESC t 2): la que traen casi todas las térmicas genéricas y tiene acentos y ñ
const PC850 = {
  "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ü": 0x81, "Ü": 0x9a,
  "Á": 0xb5, "É": 0x90, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9, "¿": 0xa8, "¡": 0xad, "°": 0xf8, "º": 0xa7, "ª": 0xa6,
};
const LOOKALIKE = {
  "×": "x", "−": "-", "–": "-", "—": "-", "·": "-", "•": "-", "★": "*", "“": '"', "”": '"', "‘": "'", "’": "'",
  "«": '"', "»": '"', "…": "...", " ": " ", "\t": " ",
};

/** Texto a bytes PC850; lo que no existe se cambia por su parecido o se le quita el acento. */
export function encodeText(text) {
  const out = [];
  for (const ch of String(text ?? "")) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else if (ch === "\n") out.push(0x0a);
    else if (PC850[ch] != null) out.push(PC850[ch]);
    else if (LOOKALIKE[ch] != null) for (const c of LOOKALIKE[ch]) out.push(c.charCodeAt(0));
    else {
      const plain = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const c = plain.charCodeAt(0);
      out.push(plain && c >= 0x20 && c < 0x7f ? c : 0x3f);
    }
  }
  return out;
}

/** Largo visible (los caracteres que se imprimen) de un texto. */
function visibleLength(text) {
  return encodeText(text).length;
}

/** Corta un texto en renglones de `cols` caracteres sin partir palabras si se puede. */
export function wrap(text, cols) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (let word of words) {
    while (visibleLength(word) > cols) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!cur) cur = word;
    else if (visibleLength(cur) + 1 + visibleLength(word) <= cols) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Texto a la izquierda y a la derecha en el mismo renglón (con relleno). */
export function leftRight(left, right, cols, fill = " ") {
  const r = String(right ?? "");
  const room = Math.max(1, cols - visibleLength(r) - 1);
  const l = wrap(left, room);
  const last = l.pop();
  const gap = Math.max(1, cols - visibleLength(last) - visibleLength(r));
  return [...l, `${last}${fill.repeat(gap)}${r}`];
}

export class EscPos {
  constructor({ cols = 48 } = {}) {
    this.cols = cols;
    this.bytes = [];
  }
  raw(...b) {
    this.bytes.push(...b.flat());
    return this;
  }
  init() {
    return this.raw(ESC, 0x40, ESC, 0x74, 0x02);
  }
  align(where = "left") {
    return this.raw(ESC, 0x61, where === "center" ? 1 : where === "right" ? 2 : 0);
  }
  bold(on = true) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** Tamaño 1 o 2 (alto y ancho). */
  size(n = 1) {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00);
  }
  text(t = "") {
    return this.raw(encodeText(t));
  }
  line(t = "") {
    return this.text(t).raw(0x0a);
  }
  lines(list) {
    for (const l of list) this.line(l);
    return this;
  }
  /** Renglón ajustado al ancho, con o sin tamaño doble (que usa la mitad de columnas). */
  wrapped(t, { cols = this.cols } = {}) {
    return this.lines(wrap(t, cols));
  }
  lr(left, right, fill = " ") {
    return this.lines(leftRight(left, right, this.cols, fill));
  }
  rule(ch = "-") {
    return this.line(ch.repeat(this.cols).slice(0, this.cols));
  }
  feed(n = 1) {
    return this.raw(ESC, 0x64, n);
  }
  /** QR modelo 2 (GS ( k). */
  qr(data, { size = 6 } = {}) {
    const bytes = encodeText(data);
    const len = bytes.length + 3;
    return this.raw(
      GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size,
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
      GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, bytes,
      GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30
    );
  }
  /** Pulso para abrir el cajón de dinero (conector 2). */
  drawer() {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }
  /** Avanza y corta (corte parcial). */
  cut() {
    return this.raw(GS, 0x56, 0x42, 0x03);
  }
  build() {
    return Uint8Array.from(this.bytes);
  }
}

const moneyFmt = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(n) {
  const v = Number(n || 0);
  return `${v < 0 ? "-" : ""}$${moneyFmt.format(Math.abs(v))}`; // la diferencia de caja puede ser negativa: -$10.00
}

const THANKS = "¡GRACIAS POR SU VISITA!";

/** Encabezado del negocio, igual en todos los tickets. */
function header(p, t, { cols, banner }) {
  const half = Math.floor(cols / 2);
  p.align("center").bold().size(2).wrapped(String(t.shop || "MiRestaurante").toUpperCase(), { cols: half });
  p.size(1).bold(false);
  if (t.kind) p.line(t.kind);
  if (t.address) p.wrapped(t.address);
  if (t.phone) p.line(`Tel. ${t.phone}`);
  p.align("left").rule("=");
  p.align("center").bold().line(banner).bold(false).align("left").rule("=");
}

/**
 * Cuenta / recibo de un pedido. `t` lo arma ticketData.js → orderTicketData:
 * { shop, kind, address, phone, folio, dateText, info: [[etiqueta, valor]], items: [{ qty, name, unit, amount,
 *   options: [{ label, qty, amount }], notes }], subtotal, tax, taxLabel, deliveryFee, total, tips: [[texto, monto]],
 *   paid, methodText, received, change, notes }
 */
export function buildReceipt(t, { cols = 42, openDrawer = false } = {}) {
  const p = new EscPos({ cols });
  const half = Math.floor(cols / 2);
  p.init();
  if (openDrawer) p.drawer();
  header(p, t, { cols, banner: "CUENTA / RECIBO" });

  p.lr(`Folio ${t.folio || ""}`, t.dateText || "");
  for (const [label, value] of t.info || []) p.lr(label, String(value ?? ""));
  p.rule();

  for (const item of t.items || []) {
    p.bold().wrapped(item.name).bold(false);
    for (const o of item.options || []) {
      p.lr(`  + ${o.label} x${o.qty}`, o.amount > 0 ? money(o.amount) : "");
    }
    if (item.notes) p.wrapped(`  * ${item.notes}`);
    p.lr(`  ${item.qty} x ${money(item.unit)}`, money(item.amount));
  }
  p.rule();

  p.lr("Subtotal", money(t.subtotal));
  p.lr(t.taxLabel || "I.V.A.", money(t.tax));
  if (Number(t.deliveryFee)) p.lr("Envío / reparto", `+${money(t.deliveryFee)}`);
  p.bold().size(2);
  p.lines(leftRight("TOTAL", money(t.total), half));
  p.size(1).bold(false);

  if ((t.tips || []).length) {
    p.rule().align("center").bold().line("PROPINA SUGERIDA").bold(false).align("left");
    for (const [label, amount] of t.tips) p.lr(label, money(amount));
    p.align("center").line("Propina: $ ________").align("left");
  }

  p.rule();
  if (t.paid) {
    p.align("center").bold().line("FORMA DE PAGO").bold(false).align("left");
    p.lr(t.methodText || "-", money(t.total));
    if (t.received != null) p.lr("Recibido", money(t.received));
    if (t.change != null) p.bold().lr("Cambio", money(t.change)).bold(false);
    p.align("center").bold().line("** PAGADO **").bold(false).align("left");
  } else {
    p.align("center").bold().line("PENDIENTE DE PAGO").bold(false).align("left");
    p.lr("Efectivo", "$ ______").lr("Tarjeta", "$ ______").lr("Cambio", "$ ______");
  }
  if (t.notes) p.rule().wrapped(`OBS: ${t.notes}`);

  p.rule("=").align("center").bold().line(THANKS).bold(false);
  p.line("Le esperamos pronto");
  p.wrapped("Este comprobante no es factura fiscal. Solicite factura en caja si aplica.");
  p.feed(1).line("Hecho con MiRestaurante").align("left").feed(3).cut();
  return p.build();
}

/**
 * Comanda para la cocina: lo que hay que preparar, grande y sin precios.
 * `t`: { shop, folio, dateText, info: [[etiqueta, valor]], items: [{ qty, name, options: [{ label, qty }], notes }], notes, nowText }
 */
export function buildKitchen(t, { cols = 42 } = {}) {
  const p = new EscPos({ cols });
  const half = Math.floor(cols / 2);
  p.init();
  p.align("center").bold().size(2).wrapped("COMANDA", { cols: half });
  p.size(1).bold(false).line(String(t.shop || "").toUpperCase());
  p.align("left").rule("=");
  p.lr(`Folio ${t.folio || ""}`, t.dateText || "");
  for (const [label, value] of t.info || []) p.lr(label, String(value ?? ""));
  p.rule();

  p.align("center").bold().line("*** PLATILLOS ***").bold(false).align("left");
  for (const item of t.items || []) {
    p.bold().size(2).wrapped(`${item.qty} ${String(item.name || "").toUpperCase()}`, { cols: half });
    p.size(1).bold(false);
    for (const o of item.options || []) p.wrapped(`    + ${String(o.label || "").toUpperCase()} x${o.qty}`);
    if (item.notes) p.wrapped(`    NOTA: ${item.notes}`);
    p.feed(1);
  }
  if (t.notes) p.rule().wrapped(`ORDEN: ${t.notes}`);

  p.rule("=").align("center").bold().size(2).line("A COCINA").size(1).bold(false);
  if (t.nowText) p.line(t.nowText);
  p.align("left").feed(3).cut();
  return p.build();
}

/**
 * Corte de caja. `t`: { shop, kind, address, phone, folio, rows: [[etiqueta, monto]], totals: [[etiqueta, monto]],
 *   difference, tickets: [{ table, pay, total }], notes, info: [[etiqueta, valor]] }
 */
export function buildCashClose(t, { cols = 42 } = {}) {
  const p = new EscPos({ cols });
  const half = Math.floor(cols / 2);
  p.init();
  header(p, t, { cols, banner: "CORTE DE CAJA" });

  p.lr(`Sesión ${t.folio || ""}`, "");
  for (const [label, value] of t.info || []) p.lr(label, String(value ?? ""));
  p.rule();

  p.align("center").bold().line("RESUMEN DE VENTAS").bold(false).align("left");
  for (const [label, amount] of t.rows || []) p.lr(label, money(amount));
  p.rule();
  for (const [label, amount] of t.totals || []) p.lr(label, money(amount));
  p.rule("=").bold().size(2);
  p.lines(leftRight("DIFERENCIA", money(t.difference), half));
  p.size(1).bold(false).rule("=");

  if ((t.tickets || []).length) {
    p.align("center").bold().line("DETALLE DE TICKETS").bold(false).align("left");
    for (const k of t.tickets) p.lr(`${k.table}  ${k.pay}`, money(k.total));
    p.rule();
  }
  if (t.notes) p.wrapped(`OBS: ${t.notes}`).rule();

  p.align("center").bold().line("FIN DE CORTE DE CAJA").bold(false);
  p.line("Conserve este comprobante");
  p.feed(1).line("Hecho con MiRestaurante").align("left").feed(3).cut();
  return p.build();
}

/**
 * Ticket dibujado como imagen: convierte los píxeles RGBA (ImageData.data) a bandas de GS v 0 (blanco y negro).
 * Lleva el cajón (si se pide), el avance y el corte, igual que los tickets de texto.
 */
export function rasterBytes(width, height, rgba, { openDrawer = false, threshold = 160 } = {}) {
  const rowBytes = Math.ceil(width / 8);
  const out = [0x1b, 0x40];
  const BAND = 200; // filas por GS v 0: hay impresoras que no aceptan imágenes muy altas de una vez
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const rows = Math.min(BAND, height - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
    for (let y = y0; y < y0 + rows; y++) {
      for (let bx = 0; bx < rowBytes; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x >= width) continue;
          const i = (y * width + x) * 4;
          const a = rgba[i + 3] / 255; // lo transparente cuenta como papel
          const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
          if (lum < threshold) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04);
  if (openDrawer) out.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  out.push(0x1d, 0x56, 0x42, 0x00);
  return out;
}

export function buildTestPage({ cols = 42, shop = "MiRestaurante", openDrawer = false } = {}) {
  const p = new EscPos({ cols });
  p.init();
  if (openDrawer) p.drawer();
  p.align("center").bold().size(2).wrapped("PRUEBA", { cols: Math.floor(cols / 2) }).size(1).bold(false);
  p.wrapped(shop).rule();
  p.align("left").lr("Papel", `${cols >= 42 ? 80 : 58} mm (${cols} col.)`);
  p.lr("Acentos", "áéíóú ñÑ ¿¡");
  p.lr("Relleno", money(1234.5), ".");
  p.rule().align("center").line("Si lees esto, la impresora quedó lista.");
  p.feed(3).cut();
  return p.build();
}
