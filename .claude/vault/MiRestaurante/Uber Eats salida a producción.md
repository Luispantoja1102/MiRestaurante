# Uber Eats: guía de salida a producción

Fase 7 de [[MiRestaurante/Decisiones/2026-11-16 Plan Uber Eats a producción]]. No es código: es el orden de pasos con Uber, qué probar antes y qué cerrar antes. Sale de la documentación de Uber leída el 2026-11-16 (*Going Live*, *Quality and Performance*, *Order Integration*, *Integration Configuration Flows*, *Webhooks* y las referencias de la API). Lo que no está confirmado por Uber se marca como **(confirmar con Uber)**.

## 0. Dónde estamos

Hecho y probado **solo con un Uber simulado**: activar la tienda del comercio por OAuth, recibir pedidos por webhook firmado, aceptar / rechazar / cancelar con motivos, hora de listo, alergias y notas, entrega propia, estado de la tienda (pausa con la caja), tasa de aceptación, bitácora, recuperación de pedidos perdidos, menú y agotados. Detalle en las notas de sesión enlazadas en [[MiRestaurante/MiRestaurante]].

**Nada se ha probado contra Uber real todavía.** Falta el Store ID de la tienda de prueba (solicitud de «Set up test stores» ya enviada a Uber).

## 1. Cerrar antes de pedir la verificación a Uber

### 1.1 Huecos de código que la página de calidad de Uber marca como **requeridos**

| Requisito de Uber | Estado |
|---|---|
| Webhooks de pedido (nuevo, cancelado, fallido) | Hecho |
| Aceptar, rechazar y **cancelar** con motivos permitidos | Hecho |
| Rechazar pedidos con alergias o indicaciones que no se puedan mostrar | Hecho (se muestran todas y se declara `fields_relayed`; el rechazo `SPECIAL_INSTRUCTIONS` está en el modal) |
| Leer y cambiar el estado de la tienda | Hecho |
| **Gestión de la integración**: activar, consultar, actualizar y quitar (`/pos_data`) | Hecho (fase 4): activar (`POST`), consultar (`GET`) y apagar (`PATCH`). **Quitar del todo (`DELETE`) no**: exige el token del comercio, que no conservamos. **(confirmar con Uber)** si apagar basta |
| **Update Store Prep Time** (tiempo de preparación de la tienda) | Hecho **sin respaldo oficial**: se lee `avg_prep_time` (documentado) y se cambia con `POST /v1/delivery/store/{id}/update-store-prep-time` (fuentes de terceros; la página de Uber no carga). **(confirmar con Uber)** ruta y cuerpo |
| Menú V2 completo (si se actualiza el menú desde el sistema) | Hecho, con huecos «donde aplique»: etiquetas fiscales y *Tax Area ID* de México |

**Lo que más puede frenar la aprobación ya no es un hueco sino dos confirmaciones**: la ruta real del tiempo de preparación y si Uber acepta «apagar» donde pide «quitar» (ya existe también «Quitar la tienda por completo», que pide autorizar de nuevo). Preguntarlas a Uber antes de solicitar la verificación.

### 1.1 bis Acciones de pedido (guía oficial, leída por un subagente el 2026-11-18)

> 2026-11-19 (punto 3 del plan, según el openapi): `external.sync` guarda lo que Uber dice del pedido (`preparation_status`, `action_eligibility` de cancelar / cambiar hora / producto agotado, `can_respond_to_fulfillment_issues`, estado del repartidor) — `PUT /orders/:id/external/sync`, y se consulta solo al marcar «Listo» y al abrir «Cancelar». `delivery.state_changed` (meta `order_id`/`store_id`/`status`) guarda `external.courier`; al recogerlo (`EN_ROUTE_TO_DROPOFF`…) el pedido pasa a «servido» solo, salvo entrega propia. `PUT …/external/ready-time` (+N min, `update-ready-time`). `PUT …/external/out-of-item` (`resolve-fulfillment-issues`, `ASK_CUSTOMER`, restaurantes); `orders.fulfillment_issues.resolved` rehace el pedido. Rechazar por agotado manda `item_metadata.invalid_item` (los productos guardan `cartItemId` y `uberItemId`).
> **Error corregido:** `external.readyAt` es la hora estimada de recogida que manda Uber al crear el pedido; antes también servía para saber si ya le avisamos «Listo», así que con esa hora presente **nunca se llamaba a Uber**. Ahora el aviso se marca en `external.readyNotifiedAt`. Probable causa de que «Listo» no se reflejara.

> 2026-11-19: **migrado al openapi de Uber (Order Fulfillment API)**. Aceptar/rechazar/cancelar/listo/consultar usan `/v1/delivery/order/{id}/...`: `accept` (`ready_for_pickup_time`, `external_reference_id`, `accepted_by`), `deny` (`deny_reason: {type, info}`), `cancel` (`cancellation_reason: {type, info}`; 204), `ready`. Nuestros motivos se traducen (`ITEM_AVAILABILITY`/`OUT_OF_ITEMS` → `ITEM_ISSUE`, `CANNOT_COMPLETE_CUSTOMER_NOTE` → `SPECIAL_INSTRUCTIONS`). El pedido se pide con `?expand=carts,deliveries,payment` y se lee en `mapFulfillmentOrder` (precios desde `payment.payment_detail.item_charges.price_breakdown`, en e5; `DELIVERY_BY_MERCHANT` se guarda como `DELIVERY_BY_RESTAURANT`). La lista de pendientes usa `/v1/delivery/store/{id}/orders?state=OFFERED`. ⚠️ **Sin confirmar en el sandbox**: la forma real de la respuesta (el openapi no trae ejemplos) y si «Listo» ya se refleja. Por seguridad quedan dos caídas a las rutas viejas (`fetchOrder` → `/v2/eats/order`; `offeredOrderIds` → `created-orders`): quitarlas cuando el sandbox confirme. Se quitó `fields_relayed` (no existe en la ruta nueva).

> 2026-11-19 (según el diagrama de Uber y `openapi.json` de Order Fulfillment): **pedido programado = dos aceptaciones**. La primera lo deja en `external.state: 'scheduled'` (sin cobrar, sin cocina; cancelable); a su hora llega otro `orders.notification` y `reopenScheduled` lo vuelve a `awaiting` con `secondRound`. `orders.customer_order_edit` → `editFromUber` (rehace platillos/importes y el inventario). `orders.cancelled` se acepta igual que `orders.cancel`. «Mark Order Ready» **sí** está en el openapi (`POST /v1/delivery/order/{id}/ready`, scope `eats.order`, cuerpo vacío): la ruta es correcta; falta saber por qué Uber no lo refleja (sospecha sin confirmar: aceptamos con la ruta vieja `accept_pos_order`, la nueva es `/v1/delivery/order/{id}/accept`).

> 2026-11-19: «Servido» no avisa a Uber. Un pedido de Uber aceptado y servido (que no reparte el restaurante) se puede seguir cancelando 2 horas desde `updatedAt` (`servedCancellable` en `integrations.controller.js` y `OrdersView.vue`). «Cobrar» ya no sale en pedidos cancelados/devueltos (solo oculta el botón; la ruta de cobro no lo bloquea). `tables.test.js` se cuelga 100 s con o sin estos cambios.

| Acción de Uber | Estado en MiRestaurante |
|---|---|
| Accept (`accept_pos_order`; `pickup_time`, `external_reference_id`, `fields_relayed`, `order_pickup_instructions`) | Hecho. Se manda `pickup_time` y 3 de 4 `fields_relayed`; **no** se manda `promotions` ni `order_pickup_instructions`. |
| Deny (`deny_pos_order`, motivos + `out_of_stock_items`/`invalid_items`) | Hecho con motivos; no se mandan los ids de productos agotados. |
| Cancel (`/cancel`, **6 motivos**) | Hecho; el 2026-11-18 se añadió `CUSTOMER_CALLED_TO_CANCEL` (faltaba). |
| Estado de entrega (`restaurantdelivery/status`) | Hecho, solo para pedidos que reparte el restaurante. **No sirve** para entrega de Uber ni recogida (Caja ahora lo dice en el botón). |
| Ajustar pedido (`PATCH /v2/eats/orders/{id}/cart`) | **No aplica a restaurantes**: solo tiendas configuradas como «Grocery Store» (en otras da 400). Para algo agotado, la vía es rechazar o cancelar con motivo. |
| Marcar el pedido LISTO («Mark Order Ready») | **Hecho el 2026-11-18, con la ruta sin confirmar.** La referencia de Uber lista la acción («informa a Uber que el pedido está listo para modelar el despacho de repartidores»), pero la ruta `POST /v1/delivery/order/{id}/ready` (cuerpo `{}`) sale de una fuente de terceros y de la lista de endpoints de la aplicación en el panel; el permiso no está confirmado (se usa el predeterminado `eats.order`). Al marcar «Listo» en MiRestaurante (Cocina o «Listo para recoger» en Caja) se llama a Uber una sola vez y se anota `external.readyAt`; si falla, queda en la bitácora (`api.ready`), el pedido queda listo aquí y Caja muestra «Reintentar aviso a Uber». Aceptar ya no pasa el pedido directo a «Listo»: queda «En preparación» hasta que alguien lo marque. Hallazgo en pruebas: sin este aviso la tablet de Uber seguía mostrando el botón «Listo» y no empezaba a asignar repartidor. |
| Cancelar solo en MiRestaurante (sin llamar a Uber) | **Bloqueado**: un pedido de Uber aceptado ya no se puede cancelar desde el cambio de estado genérico; hay que usar «Cancelar pedido» (llama a Uber). Cancelarlo solo aquí dejaba el pedido en la tablet de Uber con «Error de sincronización con el PDV». |
| Horarios especiales (`holiday-hours`, GET/POST, scope `eats.store`) | **Hecho el 2026-11-18** (Ajustes → Uber Eats → «Horarios especiales»): `GET/PUT /integrations/uber/holidays` (solo administrador). El POST de Uber **reemplaza todos** los horarios especiales, por eso la pantalla carga primero los que ya tiene la tienda y manda la lista completa; si no se pudo leer lo de Uber no deja guardar. Día cerrado = `00:00`–`00:00`; hasta 3 horarios por día y 60 días (tope propio, Uber no documenta límite); no acepta fechas pasadas ni horarios traslapados. Sin probar contra el sandbox real; la documentación no trae códigos de error ni zona horaria (dice «hora local»). |
| `orders.release` (repartidor llegó al geofence, con Fast Order Release) | **Ignorado**; podría avisar «el repartidor llegó» en Caja si Uber lo habilita. |
| `order.fulfillment_issues.resolved`, `store.status.changed` | Ignorados (el segundo exige el scope `eats.store.status.notification` en lista blanca). |
| Reportes (`POST /v1/eats/report`, Payment Details Report, scope `eats.report`) | **No implementado**; el scope sí está concedido en el sandbox. Serviría para conciliar y ver la comisión real. |

### 1.2 Avisos que hoy ignoramos (revisar si aplican a tus tiendas)

- `orders.scheduled.notification` (pedidos programados): **ya se guardan**, marcados y con la hora de recogida estimada que da Uber; Uber no documenta la hora de entrega ni la ventana de aceptación de un programado (se usan los 11.5 min de siempre). Probarlo con una tienda que los tenga habilitada.
- `store.provisioned` / `store.deprovisioned`: ya se atienden (confirman la activación y marcan la tienda sin acceso), pero su contenido no está documentado; se busca la tienda donde pueda venir.
- `order.fulfillment_issues.resolved` y `orders.release` (solo si se usan ajustes de pedido o liberación rápida).

### 1.3 Supuestos que hay que confirmar en el sandbox (la documentación se contradice o es ambigua)

- [x] Nombre del evento de pedido nuevo: `orders.notification` (webhooks y calidad) contra `order.notification` (guía de pedidos). El código atiende el primero. **Confirmado el 2026-11-18** en la guía oficial de webhooks (leída por un subagente): el nombre correcto es `orders.notification`. La misma guía lista `orders.failure`, `orders.release`, `orders.scheduled.notification`, `orders.cancel`, `store.provisioned`, `store.deprovisioned`, `order.fulfillment_issues.resolved` y `store.status.changed`.
- Webhook (guía oficial): una sola «Primary Webhook URL»; firma en `X-Uber-Signature` = HMAC-SHA256 en hexadecimal minúsculas del cuerpo, con el **Client Secret** como clave (el código ya lo hace); responder 200 con cuerpo vacío; reintentos ante 500/502/503/504 o error de red a los 10 s y luego con espera creciente, hasta 7 envíos. El panel de Uber ofrece «Basic HMAC» y «oAuth» para el webhook; la guía menciona «Basic Auth» y «OAuth» y no explica «Basic HMAC». No hay aviso de prueba al guardar: se prueba haciendo un pedido con una cuenta de prueba (la tienda debe estar disponible, con menú publicado, y en «Accept Orders» del panel Uber Eats Orders).
- **Llamada automática a la tienda a los 90 segundos** si un pedido no se acepta ni se rechaza (la guía lo dice); el pedido vence a los 11.5 minutos. Por eso conviene atender rápido y valorar aceptación automática.
- [ ] Que `Get Order Details` traiga `current_state` (`CANCELED`, `DENIED`): se usa para cerrar pedidos perdidos.
- [ ] Que el formato de importes sea el esperado (centavos en `payment.charges.*`).
- [ ] Los motivos de cancelación y el permiso de entrega propia (`eats.store.orders.restaurantdelivery.status`).
- [ ] Los permisos de estado de tienda (`eats.store`, `eats.store.status.write`) y del aviso `eats.store.status.notification`.
- [ ] Menú: claves de idioma (mandamos `es_mx` y `en_us`), `tax_rate: 8` (IVA que se suma; la alternativa es `vat_rate_percentage`), máximo de cantidad de cada extra, largos de título.
- [ ] **Activación por OAuth:** que Uber devuelva el `state` en la redirección, la dirección de autorización de cada entorno (sandbox: `sandbox-login.uber.com`; producción: `auth.uber.com`), que acepte el cambio de código en formulario normal (sus ejemplos usan `multipart`), el cuerpo de `POST pos_data` (mandamos `is_order_manager` e `integrator_store_id`), y qué responde `PATCH pos_data` (su página no existe).
- [ ] Si la cuenta de las tiendas de prueba puede autorizar a MiRestaurante (hasta que Uber entregue la tienda y la cuenta no se sabe).
- [ ] **Tiempo de preparación:** la ruta `.../update-store-prep-time` y su cuerpo (`default_prep_time` en segundos) vienen de terceros y de rutas antiguas; Uber debe confirmarlos.
- [ ] **Extras:** que `selected_modifier_groups[].selected_items[].id` traiga el id que publicamos (`producto_ingrediente`) y que su `quantity` sea por unidad del producto.
- [ ] Umbral del piloto: *Going Live* dice 98 % y *Quality* dice 99.9 % de meta y 99 % de límite.
- [ ] Cómo se enciende la integración el día de lanzamiento: *Going Live* dice «PATCH Update POS Status» con `pos_integration_enabled`; la referencia de activación marca ese indicador como obsoleto.

### 1.4 Errores reales de Uber al conectar (vistos en el sandbox el 2026-11-16)

La pantalla de Uber «Error en la autorización» aparece **antes** de volver a MiRestaurante:

- **«Solicitud no válida. Hubo un error inesperado.»** → la dirección de redirección que mandamos no era una URL. Causa que se dio: el `.env` con el nombre de la variable repetido (`UBER_EATS_REDIRECT_URI=UBER_EATS_REDIRECT_URI=https://...`). Revisar que la línea tenga el nombre una sola vez y reiniciar el backend.
- **«Solicitud no válida. No hay un URI de redireccionamiento para este usuario.»** → la URL es válida pero **no está registrada** en la aplicación de Uber. Registrar en el panel (sección de autenticación de la app, *Redirect URIs*) exactamente la misma de `UBER_EATS_REDIRECT_URI` y guardar. Debe coincidir carácter por carácter (`https`, dominio, `/api/`, sin diagonal final).
- **Error 401 «User not allowed to access the store»** (al publicar el menú o cambiar el tiempo de preparación, 2026-11-18): la tienda solo estaba «vinculada» escribiendo un Store ID, sin estar activada para la aplicación. Se resuelve con **«Conectar con Uber Eats»** (cuenta dueña de la tienda). **Vincular con el Store ID ahora se verifica con Uber** (`GET /v1/eats/stores/{id}`): si Uber no reconoce la tienda para la aplicación no se vincula (antes aceptaba cualquier cosa con forma de ID); si Uber no responde, tampoco se vincula (502); si la reconoce, guarda su nombre. Una vinculación vieja no se revisa de nuevo: hay que desvincular y volver a vincular.
- Con un túnel de prueba, si cambia su dirección hay que actualizar el `.env` (y reiniciar) **y** el panel de Uber.
- Después de registrarla, **funcionó** el flujo de autorización de punta a punta contra el sandbox real.

## 2. Pruebas en el sandbox (antes de la verificación)

Con la tienda de prueba vinculada en **Ajustes > Uber Eats** y un túnel (o dominio) para el webhook:

- [ ] **Conectar con Uber Eats** desde Ajustes: con una tienda se activa sola; con varias aparece el selector; la tienda queda «Conectada»; desvincular la apaga en Uber.
- [ ] Pedido de recoger y pedido con reparto de Uber: llegan con alerta y sonido; aceptar con «Listo en»; cobra como Plataforma; llega a cocina o queda «Listo» según el enfoque.
- [ ] Rechazar con cada motivo; dejar que se venza (11.5 min) y revisar que queda como perdido.
- [ ] Cancelar un pedido ya aceptado con cada motivo; que Uber cancele uno aceptado → sale del cierre de caja.
- [ ] Pedido con **alergia**, con notas de producto y de pedido, con extras, con cubiertos / sin cubiertos.
- [ ] Pedido que reparte el restaurante: «Salió a entregar», «Va llegando», «Entregado».
- [ ] Respuesta 500 del servidor: Uber reintenta y no se duplica el pedido. Firma inválida: 401.
- [ ] Estado de la tienda: pausar, reanudar, cerrar / abrir caja (pausa y reanuda solo lo propio).
- [ ] Publicar el menú: aceptado por Uber; agotar un ingrediente → producto agotado; reponer → disponible.
- [ ] «Buscar pedidos perdidos» y la revisión al abrir la caja.
- [ ] Dos negocios con tiendas distintas: cada uno ve solo lo suyo.
- [ ] Revisar la **bitácora** y la **tasa de aceptación** (panel de plataforma) después de las pruebas.

## 3. Servidor de producción

- [ ] **Dominio estable con https** para el webhook (un túnel gratuito cambia de dirección y no sirve). URL del webhook: `https://<tu-dominio>/api/integrations/uber/webhook` (tanto Vercel como nginx usan el prefijo `/api`).
- [ ] Variables de entorno de producción: `UBER_EATS_ENV=production`, `UBER_EATS_CLIENT_ID` y `UBER_EATS_CLIENT_SECRET` de la **aplicación de producción**, y `UBER_EATS_REDIRECT_URI=https://<tu-dominio>/api/integrations/uber/oauth/callback` (junto con `OAUTH_STATE_SECRET` y `TOKEN_ENC_KEY`, que ya usa Mercado Pago); **quitar** `UBER_EATS_AUTH_URL` y `UBER_EATS_API_URL` (son solo para pruebas).
- [ ] Nunca pegar el Client Secret en un chat, captura o repositorio. El de pruebas ya apareció en una captura: regenerarlo.
- [ ] En el panel de Uber: autenticación del webhook **Basic HMAC** con la *Signing Key* igual al Client Secret (así lo valida el código).
- [ ] Responder rápido al webhook: Uber espera 200 con cuerpo vacío y reintenta con 500/502/503/504 hasta 7 envíos. Vigilar el arranque en frío si el backend corre como función sin servidor.
- [ ] **Revisión periódica de pedidos perdidos:** en un servidor continuo (Docker) corre sola cada `UBER_SWEEP_MINUTES` (2 por defecto). En **Vercel** no hay proceso continuo: crear un cron que llame a `GET /api/integrations/uber/sweep` con `Authorization: Bearer <CRON_SECRET>` (definir `CRON_SECRET`; Vercel lo manda solo). Los crons frecuentes pueden requerir un plan de pago.
- [ ] Copias de seguridad de Mongo activas; la bitácora (`uber_events`) se limpia sola a los 30 días.

## 4. Cuenta y aplicación de producción en Uber

- [ ] Crear una cuenta de Uber **de producción**, distinta de la de pruebas (no una cuenta de prueba generada por Uber).
- [ ] Crear la aplicación de producción. **Una aplicación por cada URL de webhook distinta**: con una sola URL, una sola aplicación.
- [ ] Mandar al soporte técnico de Uber (t.uber.com/integration-support) una solicitud con el `client_id` de producción para que **habiliten los permisos**. Pedir: `eats.order`, `eats.store.orders.read`, `eats.store`, `eats.store.status.write`, `eats.store.status.notification`, `eats.store.orders.restaurantdelivery.status` y, para la fase 4, `eats.pos_provisioning`.
- [ ] Cuando confirmen: entrar al panel, **marcar y guardar** los permisos, poner la URL del webhook (primaria) y **registrar la URL de redirección** `https://<tu-dominio>/api/integrations/uber/oauth/callback` (debe ser exactamente la de `UBER_EATS_REDIRECT_URI`).
- [ ] **(confirmar con Uber)** Las páginas dicen que estas APIs «pueden requerir aprobación por escrito» y la guía no explica los acuerdos o licencias del socio integrador. Preguntar qué contrato necesita firmar MiRestaurante como integrador de varios comercios.

## 5. Pedir la verificación

- [ ] Con las secciones 1 a 3 cerradas, enviar la solicitud de **verificación de la integración** al soporte técnico de Uber. Uber hace pruebas completas de punta a punta junto contigo.
- [ ] Tener a la mano: la lista de la sección 2 con resultados, la tasa de aceptación del sandbox y qué hace cada pantalla.
- [ ] Después de la verificación, Uber habilita la cuenta de producción (paso 4).

## 6. Piloto

- [ ] Elegir **un** restaurante piloto, con la caja abierta durante su horario, un equipo avisado y un dispositivo con Caja siempre a la vista.
- [ ] Avisar al **gerente de socio** de Uber la tienda y la fecha **al menos una semana antes**. Confirmar con él: aplicación de producción, URL del webhook y permisos.
- [ ] Vincular la tienda piloto: el comercio entra a **Ajustes > Uber Eats > Conectar con Uber Eats** con la cuenta de Uber de su tienda (queda «Conectada, falta que Uber la encienda» hasta el lanzamiento). Avisarle antes que **MiRestaurante pasa a aceptar los pedidos en lugar de la tableta de Uber Eats**.
- [ ] Día de lanzamiento: publicar el menú desde **Ajustes > Uber Eats**, encender la integración de pedidos (confirmar el método con Uber, ver 1.3) y dejar la tienda en línea.
- [ ] Capacitar al equipo: **abrir la caja antes de abrir la tienda** (con la caja cerrada la tienda se pausa sola); aceptar o rechazar antes de 11 minutos (el sonido se repite cada 15 s); dar un toque en la página al empezar el turno y aceptar las notificaciones del navegador.
- [ ] **Rechazar no siempre cancela al instante.** Según la documentación de Uber (`deny_pos_order`), si la tienda tiene la tablet **Uber Eats Orders**, el pedido rechazado puede quedarse ahí unos minutos con «Error de sincronización con el PDV» para que el personal lo acepte a mano; si nadie lo acepta, se cancela solo a los 11.5 minutos. Para quitarlo ya, rechazarlo también en la tablet. Riesgo: si alguien lo **acepta** en la tablet, el pedido es válido en Uber pero MiRestaurante lo tiene como rechazado y no lo muestra. Visto en el sandbox el 2026-11-18; Caja lo avisa en el cuadro de «Rechazar pedido».
- [ ] Revisar **cada día** la tasa de aceptación (Ajustes del negocio y pestaña Uber Eats de la plataforma) y los errores de la bitácora.
- [ ] **Al menos 3 días** con la tasa que Uber exija (98 % según la guía de salida; la página de calidad pide 99.9 % y marca 99 % como límite).

## 7. Después del piloto

- [ ] Acordar con el gerente de socio un calendario para sumar más tiendas; antes de cada una, avisar de cambios operativos, vincularla, publicar su menú y encenderla el día de lanzamiento.
- [ ] Si la tasa baja, causas probables: caja cerrada o sin nadie atendiendo (pedidos que vencen), avisos perdidos (usar «Buscar pedidos perdidos»), productos agotados sin aviso, o pedidos con alergias que no se pueden cumplir (rechazarlos con el motivo correcto en vez de dejarlos vencer).

## 8. Quién hace qué

- **Tú / el negocio:** crear la cuenta y la aplicación de producción, hablar con soporte técnico y el gerente de socio de Uber, dominio y servidor de producción, elegir el piloto y capacitar al equipo, firmar lo que Uber pida.
- **Código pendiente antes de solicitar:** ninguno conocido; quedan las confirmaciones con Uber de la sección 1.3.
- **Lo que no puedo saber:** tiempos y exigencias de aprobación de Uber (acuerdos, cargos, plazos). Tampoco la tienda de prueba hasta que Uber la entregue.
