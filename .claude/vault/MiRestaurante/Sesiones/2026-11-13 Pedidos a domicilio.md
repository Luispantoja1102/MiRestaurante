# Sesión 2026-11-13 (pedidos a domicilio)

- **Qué se pidió:** seguir con el flujo de delivery que quedó pendiente tras los enfoques de servicio ([[MiRestaurante/Decisiones/2026-11-13 Enfoque de servicio]]).
- **Qué se hizo:**
  - Nueva modalidad `delivery` («A domicilio») además de `dine-in` y `takeaway`. Guarda `delivery: { name, phone, address, reference }`; nombre, teléfono (7+ dígitos) y dirección son obligatorios (`normalizeDelivery` en `backend/models/order.model.js`).
  - El envío ($50, `DELIVERY_FEE`) solo se cobra a domicilio y lo fija el servidor. Antes «Para llevar» cobraba $50 de «Reparto»: ahora «Para llevar» no cobra envío.
  - Mostrador (`POST /orders/counter`): acepta `delivery`, cobra al despachar y deja el pedido en «Listo» hasta marcarlo entregado. Salón/Pedido (`POST /orders`): igual, sin mesa.
  - Frontend: `components/DeliveryFields.vue` (reutilizado en mostrador y en el carrito `LSidebar`), tercer botón «A domicilio», filtro «A domicilio» y botón «Marcar entregado» en Caja, datos de entrega en el ticket impreso.
- **Cómo se probó:** 203 pruebas del backend (3 nuevas); compila; en el navegador con base temporal: venta a domicilio en mostrador ($93.20 con envío), «Marcar entregado», y pedido a domicilio desde el carrito con validación de datos.
- **Pendiente / dudas:**
  - Sin repartidor asignado ni estado «en camino»: «Listo» pasa a «Servido» al entregar.
  - Arreglado después: el campo «Recibido» del cobro de mostrador tenía `step="0.5"` y el navegador rechazaba totales con centavos (p. ej. $93.20) al pagar en efectivo; ahora es `step="0.01"`.
  - Cobrar un pedido de salón a domicilio desde Caja lo marca «Servido» (así funciona `pay` para todos los pedidos).

## Ampliación: origen del pedido (2026-11-16)
- Cada pedido guarda `channel`: `local` (por defecto), `phone`, `uber`, `rappi` o `didi` (`channelLabels` en `backend/models/order.model.js`). Un valor desconocido cae en `local`.
- Pedidos de una app de reparto (`isPlatform`): sin envío ($0, lo cobra la plataforma), basta el nombre del cliente, siempre «para llevar» o «a domicilio», y se cobran con el método nuevo `platform` («Plataforma»), que el servidor impone tanto en mostrador como en Caja. `platform` se rechaza en pedidos de otro origen.
- Cierre de caja: `platform` suma aparte (no entra al efectivo esperado); se guarda `expectedPlatform` y el ticket de cierre muestra «PLATAFORMAS».
- Frontend: `components/ChannelSelect.vue` (mostrador y carrito), origen visible en Caja, Cocina y ticket.
- Pruebas: 208 en el backend (5 nuevas); el `helpers.js` de pruebas ahora simula `GetOrdersByCashSession`.
- Sigue pendiente la integración real con Uber Eats, Rappi y DiDi (hoy el origen se elige a mano).
