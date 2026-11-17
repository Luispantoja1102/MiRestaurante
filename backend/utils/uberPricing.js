// Precios del menú en Uber Eats: Uber se queda una parte de cada venta, así que el precio publicado sube
// lo necesario para que al negocio le quede lo mismo que vendiendo en su local.
//
//   te quedan = precio en Uber × (1 − lo que se queda Uber)
//   lo que se queda Uber = comisión × (1 + IVA sobre la comisión) + marketing
//   precio en Uber = precio en el local ÷ (1 − lo que se queda Uber), redondeado hacia arriba
//
// Ejemplo (plan Plus, 27 %): 27 % × 1.16 = 31.32 %; un platillo de $70 se publica en $101.92 → $102.

const { round2, rateOf } = require('./tax');

// Planes de Uber Eats en México (comisión base, sin IVA). El negocio puede escribir otra.
const PLANS = {
  lite: { label: 'Lite', commissionPct: 25 },
  plus: { label: 'Plus', commissionPct: 27 },
  premium: { label: 'Premium', commissionPct: 29 },
  custom: { label: 'Otra', commissionPct: null },
};
const IVA_ON_COMMISSION = 0.16; // Uber factura IVA sobre su comisión
const ROUNDINGS = [0, 1, 5, 10]; // hacia arriba al peso, a 5 o a 10 pesos; 0 = centavos

const DEFAULT_PRICING = { enabled: false, plan: 'plus', commissionPct: 27, marketingPct: 0, rounding: 1 };

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Valida lo que manda la pantalla. @returns { value } o { error } */
function normalizePricing(input = {}) {
  const plan = PLANS[input.plan] ? input.plan : null;
  if (!plan) return { error: 'Elige un plan de Uber Eats' };
  const commissionPct = plan === 'custom' ? num(input.commissionPct, NaN) : PLANS[plan].commissionPct;
  if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 50) return { error: 'La comisión va de 0 a 50 %' };
  const marketingPct = num(input.marketingPct, 0);
  if (marketingPct < 0 || marketingPct > 30) return { error: 'El marketing va de 0 a 30 %' };
  const rounding = Number(input.rounding);
  if (!ROUNDINGS.includes(rounding)) return { error: 'El redondeo debe ser a centavos, a 1, a 5 o a 10 pesos' };
  return { value: { enabled: Boolean(input.enabled), plan, commissionPct: round2(commissionPct), marketingPct: round2(marketingPct), rounding } };
}

/** Qué parte de cada venta se queda Uber (0 a 1), con el IVA de su comisión y el marketing. */
const uberCut = (p) => (num(p.commissionPct, 0) * (1 + IVA_ON_COMMISSION) + num(p.marketingPct, 0)) / 100;

/** Precio al cliente en Uber (con IVA) que deja al negocio lo mismo que `base` en su local. */
function uberGross(base, pricing) {
  const cut = uberCut(pricing);
  const raw = Number(base) / (1 - cut);
  if (!(Number(base) > 0)) return 0;
  const step = Number(pricing.rounding) || 0;
  // Se redondea hacia arriba: nunca se queda por debajo de lo que se quiere recibir
  return step > 0 ? Math.ceil(round2(raw) / step) * step : round2(Math.ceil(round2(raw) * 100 - 1e-6) / 100);
}

/**
 * Lo que se publica en Uber para un precio de menú.
 * - con IVA incluido: se publica el precio al cliente tal cual
 * - sin IVA incluido: Uber suma el IVA, así que se publica la base (precio al cliente ÷ (1 + tasa))
 * @returns { base, gross, price, net } base: precio en el local con IVA; gross: lo que pagará el cliente en Uber;
 *          price: lo que va en el menú de Uber; net: lo que le queda al negocio
 */
function uberPrice(menuPrice, { includesTax = true, taxRate = 0.08 } = {}, pricing) {
  const rate = rateOf(taxRate);
  const base = includesTax ? round2(menuPrice) : round2(Number(menuPrice) * (1 + rate));
  if (!pricing?.enabled) return { base, gross: base, price: round2(menuPrice), net: base };
  const gross = uberGross(base, pricing);
  return { base, gross, price: includesTax ? gross : round2(gross / (1 + rate)), net: round2(gross * (1 - uberCut(pricing))) };
}

module.exports = { PLANS, IVA_ON_COMMISSION, ROUNDINGS, DEFAULT_PRICING, normalizePricing, uberCut, uberGross, uberPrice };
