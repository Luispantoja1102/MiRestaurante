# Sesión 2026-11-16 (Uber Eats: camino a producción, fase 1)

- **Qué se pidió:** recomendar qué más construir para que Uber apruebe la integración en producción, hacer el plan y empezar. Contexto: [[MiRestaurante/Sesiones/2026-11-16 Integración Uber Eats]].
- **Qué se hizo:**
  - Se leyó la documentación de Uber sobre salida a producción, calidad, pedidos, activación de tiendas y webhooks, y se escribió el plan en fases: [[MiRestaurante/Decisiones/2026-11-16 Plan Uber Eats a producción]].
  - **Fase 1 (hecha): avisos de pedido nuevo.** `GET /orders/awaiting` (admin y caja; solo los pedidos de plataforma sin responder, sin bajar todo el historial), `frontend/src/orderAlerts.js` (sondeo en vivo compartido, sonido de `sound.js` que se repite cada 15 s mientras haya pedidos sin responder, notificación del navegador si la pestaña está oculta y hay permiso) y un banner en `AppShell` con los estilos de los avisos de mesero, visible desde cualquier pantalla menos Caja (que ya muestra la tarjeta).
- **Cómo se probó:** 233 pruebas del backend (1 nueva); compila; en el navegador con base temporal y Uber simulado: un pedido llegó mientras estaba en el Mostrador → banner y sonido, se repite, en Caja no sale el banner pero sí la tarjeta, y al aceptar el sonido se detiene.
- **Pendiente / dudas:**
  - Fases 2 a 7 del plan (ciclo completo del pedido, estado de la tienda, activación por OAuth, métricas, menú, salida a producción).
  - El sonido solo suena tras el primer toque del usuario en la página (regla del navegador); con la pestaña en segundo plano depende de que se haya dado permiso a las notificaciones.
  - Las cuentas de varios usuarios en un negocio avisan todas a la vez; no hay «quién lo atiende».
