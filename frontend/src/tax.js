// Mantener idéntico a backend/utils/tax.js (lo comprueba backend/tests/tax.test.js). Sin imports.
// Cada platillo dice si su precio YA incluye el IVA (lo que paga el cliente) o si el IVA se suma al cobrar.
// Cada renglón es «precio c/u con IVA (a centavos) × cantidad»; el subtotal es la suma de renglones,
// el total es subtotal + envío, y el IVA que va dentro se desglosa para tickets y corte.

export const DEFAULT_TAX_RATE = 0.08;

/** Redondea a centavos sin el error de flotantes (1.005 → 1.01). */
export function round2(value) {
  const n = Number(value) || 0;
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

/** Tasa de IVA válida (0 a 1). 0 % es una tasa real; solo sin dato se usa la de siempre (8 %). */
export function rateOf(value, fallback = DEFAULT_TAX_RATE) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** ¿El precio de este renglón ya trae el IVA? Sin dato (platillos de antes) sí lo trae. */
export const includesTax = (value) => value !== false && value !== 'false' && value !== 0;

/**
 * Desglosa un renglón de venta.
 * - con IVA incluido: price es lo que paga el cliente; el IVA se desglosa de ahí
 * - sin IVA incluido: price es la base; el IVA se suma al cobrar
 * unitGross es el precio c/u que ve el cliente; gross = unitGross × cantidad (a centavos).
 */
export function lineBreakdown(price, quantity, priceIncludesTax, taxRate = DEFAULT_TAX_RATE) {
  const qty = Number(quantity) || 0;
  const unit = Number(price) || 0;
  const rate = Number(taxRate) || 0;
  const included = includesTax(priceIncludesTax);

  const unitGross = included ? round2(unit) : round2(unit * (1 + rate));
  const gross = round2(unitGross * qty);
  const net = included ? (rate > 0 ? gross / (1 + rate) : gross) : unit * qty;
  return { net, tax: gross - net, gross, unitGross };
}

/**
 * Totales de una cuenta. subtotal = lo que cuestan los platillos con IVA; total = subtotal + envío.
 * Siempre se cumple: subtotalNet + tax = subtotal, y subtotal + deliveryFee = total.
 */
export function cartTotals(items = [], { taxRate = DEFAULT_TAX_RATE, deliveryFee = 0 } = {}) {
  let subtotal = 0;
  let net = 0;
  for (const item of items) {
    const b = lineBreakdown(item.price, item.quantity, item.priceIncludesTax, taxRate);
    subtotal += b.gross;
    net += b.net;
  }
  subtotal = round2(subtotal);
  net = round2(net);
  const fee = round2(deliveryFee);
  return { taxRate, subtotalNet: net, tax: round2(subtotal - net), subtotal, deliveryFee: fee, total: round2(subtotal + fee) };
}

