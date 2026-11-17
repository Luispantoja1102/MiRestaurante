// Lo que paga el cliente, con la tasa de IVA del negocio y la marca «IVA incluido» de cada platillo.
// El servidor recalcula todo al cobrar; esto solo muestra lo mismo mientras se arma la cuenta.
import { venueStore } from "./venueStore";
import { cartTotals, lineBreakdown, rateOf } from "./tax";

export const currentTaxRate = () => rateOf(venueStore.taxRate);
export const taxPercentText = () => `${Number((currentTaxRate() * 100).toFixed(2))}%`;

/** Precio de UNA pieza con IVA (lo que ve y paga el cliente). */
export const unitGross = (price, priceIncludesTax) => lineBreakdown(price, 1, priceIncludesTax, currentTaxRate()).unitGross;

/** Importe de un renglón con IVA. */
export const lineGross = (price, quantity, priceIncludesTax) => lineBreakdown(price, quantity, priceIncludesTax, currentTaxRate()).gross;

/** Totales de la cuenta: { subtotal (con IVA), tax (el que va dentro), deliveryFee, total }. */
export const totalsOf = (items, deliveryFee = 0) =>
  cartTotals(
    items.map((i) => ({ price: i.price, quantity: i.quantity, priceIncludesTax: i.priceIncludesTax ?? i.food?.priceIncludesTax })),
    { taxRate: currentTaxRate(), deliveryFee }
  );
