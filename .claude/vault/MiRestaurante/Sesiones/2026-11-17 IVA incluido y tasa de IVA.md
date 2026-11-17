# 2026-11-17 IVA incluido por platillo y tasa de IVA (como MiTiendita)

## Qué se pidió
Que el IVA se configure como en MiTiendita y que al registrar un platillo se elija si su precio ya incluye el IVA, porque los chilaquiles ($70) se cobraban en $75.60. Decisión del usuario: **todos los platillos que ya existen pasan a «IVA incluido»**.

## Qué se hizo
- **Un solo cálculo** (`backend/utils/tax.js`, gemelo `frontend/src/tax.js`; `backend/tests/tax.test.js` comprueba que son idénticos): `lineBreakdown` y `cartTotals`. El subtotal es lo que paga el cliente por los platillos (con IVA), el total es subtotal + envío, y `tax` es el IVA que va dentro.
- **Tasa de IVA del negocio:** `settings.taxRate` (0 a 1, por defecto 8 %), Ajustes → «Ventas e IVA» (8 %, 16 %, 0 % u otra, con ejemplo). Si se guarda la configuración sin mandar la tasa, se conserva la que tenía.
- **Marca por platillo:** `priceIncludesTax` en el platillo (`menus.controller.js`, `ProductWizard.vue`: «¿Este precio ya incluye IVA?» con vista previa). **Sin marca = incluido**, así que los platillos de antes quedaron «incluido» sin migrar datos. Los extras llevan la marca de su platillo.
- **Pedidos:** `normalizeOrder(body, { taxRate })` guarda `taxRate`, `pricesWithTax: true` y, por renglón, `unitGross` y `lineGross`. En mostrador y en pedidos de mesa el precio y la marca salen del menú, no de lo que mande la pantalla. Los pedidos de Uber conservan los importes de Uber (`pricesWithTax: false`).
- **Pantalla:** `frontend/src/pricing.js` (mostrador, barra de pedido y menú muestran el precio con IVA y «Incluye IVA (x%)»).
- **Tickets** (navegador, imagen y texto): en los pedidos nuevos no se suma el IVA otra vez; se muestra «Incluye I.V.A. (x%): $» bajo el total. Los pedidos anteriores (sin `pricesWithTax`) se ven como antes.
- **Menú de Uber:** cada platillo se publica con `vat_rate_percentage` (incluido) o `tax_rate` (se suma), con la tasa del negocio. **⚠️ Confirmar en el sandbox** cuál clave acepta Uber.

## Límites
- Los pedidos ya guardados no se recalculan.
- Los pedidos de Uber siguen con los importes que manda Uber.
- Los reportes y el corte suman `tax` de cada pedido: en pedidos nuevos es el IVA incluido; en los viejos, el que se sumó aparte.
