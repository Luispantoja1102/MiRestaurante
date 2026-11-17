# 2026-11-17 Precios en Uber Eats para conservar la ganancia

## Qué se pidió
Que el menú que se publica en Uber Eats salga con precios suficientes para que, tras la comisión de Uber, el negocio reciba lo mismo que vendiendo en su local (si un platillo vale $70, seguir ganando esos $70). Referencia del usuario: planes de Uber Eats en México, comisión base **Lite 25 %, Plus 27 %, Premium 29 %**, más **16 % de IVA sobre la comisión**, y un marketing recomendado opcional (5 % o 4 %).

## Qué se hizo
- `backend/utils/uberPricing.js`: lo que se queda Uber = comisión × 1.16 + marketing (Plus: 27 % → 31.32 %). Precio en Uber = precio del local ÷ (1 − lo que se queda Uber), **redondeado hacia arriba** (al peso, a 5, a 10 o centavos). Ejemplo: $70 → $101.92 → **$102** (te quedan $70.05).
- Si el platillo **no incluye IVA**, Uber suma el IVA: se publica la base (precio al cliente ÷ (1 + tasa)) para que el cliente pague lo mismo. Los **extras** se ajustan igual, con la marca de su platillo.
- Configuración en la integración de Uber (`pricing`: activado, plan, comisión, marketing, redondeo). `GET/PUT /integrations/uber/pricing` (solo administrador); `GET` con `plan=…` en la dirección da una vista previa sin guardar. Guardar vuelve a publicar el menú si ya estaba publicado.
- Pantalla `UberPricing.vue` en Ajustes → Uber Eats: casilla, plan, comisión propia, marketing, redondeo, y tabla «En tu local / En Uber / Te quedan» que se recalcula mientras se escribe.
- Pruebas: `uber.test.js` (precios, permisos, validaciones, republicar, apagar) y `tax.test.js` (el ejemplo del plan Plus).

## Límites y dudas
- **Supuesto:** Uber calcula su comisión sobre el precio publicado (lo que paga el cliente por los platillos). Confirmar con una liquidación real de Uber; si la base fuera otra, solo cambia la fórmula en `uberCut`/`uberGross`.
- **El 16 % de IVA sobre la comisión** está fijo en el código (`IVA_ON_COMMISSION`).
- Los pedidos de Uber se guardan con los importes de Uber (ya con el precio subido); el sistema **no descuenta la comisión** de las ventas ni muestra la ganancia neta por plataforma. Pendiente: ventas netas y conciliación con el depósito de Uber.
- Solo cambia el menú de Uber: el precio del local no se toca.
