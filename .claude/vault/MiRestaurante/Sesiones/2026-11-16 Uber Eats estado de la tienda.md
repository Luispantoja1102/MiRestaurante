# Sesión 2026-11-16 (Uber Eats: estado de la tienda, fase 3)

- **Qué se pidió:** fase 3 del plan [[MiRestaurante/Decisiones/2026-11-16 Plan Uber Eats a producción]]. Contexto: [[MiRestaurante/Sesiones/2026-11-16 Uber Eats ciclo del pedido]].
- **De la referencia de la API de Uber** (leída esta sesión): leer el estado es `GET /v1/eats/store/{id}/status` (scope `eats.store`; responde `status` y `offlineReason`: `OUT_OF_MENU_HOURS`, `INVISIBLE`, `PAUSED_BY_UBER`, `PAUSED_BY_RESTAURANT`); cambiarlo es `POST` a la misma ruta (scope **distinto**, `eats.store.status.write`) y solo acepta `ONLINE` y `PAUSED` (no existe «cerrado»), con `paused_until` opcional en formato `AAAA-MM-DDThh:mm:ssZ` y `reason`; responde 204. El aviso `store.status.changed` pide el scope `eats.store.status.notification` y la documentación no da su contenido.
- **Qué se hizo:**
  - **Leer y pausar a mano.** `GET/PUT /integrations/uber/store` (admin y caja): estado en vivo y «Pausar tienda» (30 min, 1 h, 2 h o hasta reanudar) / «Reanudar». Cada llamada pide su permiso por separado (mismo mecanismo que el de entrega propia).
  - **Con la caja.** Al **cerrar** la caja se pausa la tienda de Uber (motivo «Caja cerrada») y al **abrirla** se reanuda, pero solo si la pausa la pusimos nosotros (`pausedByCash`): una pausa manual, la de Uber o el horario del restaurante no se tocan. Va sin esperar a Uber y un fallo de Uber nunca estorba a la caja. Se puede desactivar (`PUT /integrations/uber/autopause`, administrador; por defecto **activada**).
  - **Pantalla.** Componente `UberStoreStatus.vue`: en **Caja** (estado + pausar/reanudar, se vuelve a leer poco después de abrir o cerrar) y en **Ajustes > Uber Eats** (con la casilla de pausa automática).
  - Sin pantalla de cocina/mostrador cambió nada más.
- **Decisiones:**
  - **Pausa automática activada por defecto:** con la caja cerrada nadie puede aceptar y un pedido sin respuesta baja la tasa de aceptación que Uber mide.
  - **No se guarda el estado de Uber:** se lee en vivo, por eso `store.status.changed` no se atiende (su contenido no está documentado y no hace falta para mostrar el estado).
  - **Tiempo de preparación de la tienda: no se construyó.** La referencia legible no trae el endpoint (`Update Store Prep Time` está en la página nueva *Store API Suite*, que solo mostró navegación). Uber lo marca como requerido en la página de calidad, así que queda pendiente leerlo en esa página antes de producción.
- **Cómo se probó:** 242 pruebas del backend (4 nuevas en `tests/uber.test.js`, y fakes de abrir/cerrar caja en `helpers.js`); compila; en el navegador con base temporal y Uber simulado con estado de tienda: pausar con hora, reanudar, cerrar caja → «Pausada», abrir caja → «En línea», y la casilla de Ajustes.
- **Pendiente / dudas:**
  - Nada probado contra el sandbox real; en especial los dos permisos de estado de tienda (`eats.store`, `eats.store.status.write`), que Uber puede exigir que habilite.
  - Tiempo de preparación de la tienda (ver arriba).
  - Si Uber deja la tienda en `OFFLINE` por horario, el botón «Reanudar» no aparece (solo se reanuda lo que pausó el restaurante).
  - Fases 4 a 7 del plan.
