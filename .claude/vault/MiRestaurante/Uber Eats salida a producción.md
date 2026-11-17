# Uber Eats: guía de salida a producción

Fase 7 de [[MiRestaurante/Decisiones/2026-11-16 Plan Uber Eats a producción]]. No es código: es el orden de pasos con Uber, qué probar antes y qué cerrar antes. Sale de la documentación de Uber leída el 2026-11-16 (*Going Live*, *Quality and Performance*, *Order Integration*, *Integration Configuration Flows*, *Webhooks* y las referencias de la API). Lo que no está confirmado por Uber se marca como **(confirmar con Uber)**.

## 0. Dónde estamos

Hecho y probado **solo con un Uber simulado**: recibir pedidos por webhook firmado, aceptar / rechazar / cancelar con motivos, hora de listo, alergias y notas, entrega propia, estado de la tienda (pausa con la caja), tasa de aceptación, bitácora, recuperación de pedidos perdidos, menú y agotados. Detalle en las notas de sesión enlazadas en [[MiRestaurante/MiRestaurante]].

**Nada se ha probado contra Uber real todavía.** Falta el Store ID de la tienda de prueba (solicitud de «Set up test stores» ya enviada a Uber).

## 1. Cerrar antes de pedir la verificación a Uber

### 1.1 Huecos de código que la página de calidad de Uber marca como **requeridos**

| Requisito de Uber | Estado |
|---|---|
| Webhooks de pedido (nuevo, cancelado, fallido) | Hecho |
| Aceptar, rechazar y **cancelar** con motivos permitidos | Hecho |
| Rechazar pedidos con alergias o indicaciones que no se puedan mostrar | Hecho (se muestran todas y se declara `fields_relayed`; el rechazo `SPECIAL_INSTRUCTIONS` está en el modal) |
| Leer y cambiar el estado de la tienda | Hecho |
| **Gestión de la integración**: activar, consultar, actualizar y quitar (`/pos_data`) | **Falta** (es la fase 4, pospuesta) |
| **Update Store Prep Time** (tiempo de preparación de la tienda) | **Falta**: el endpoint está en la página *Store API Suite*, que no pude leer |
| Menú V2 completo (si se actualiza el menú desde el sistema) | Hecho, con huecos «donde aplique»: etiquetas fiscales y *Tax Area ID* de México |

**Las dos primeras filas con «Falta» pueden hacer que Uber no apruebe.** Recomiendo cerrarlas antes de solicitar la verificación (fase 4 y leer el tiempo de preparación).

### 1.2 Avisos que hoy ignoramos (revisar si aplican a tus tiendas)

- `orders.scheduled.notification` (pedidos programados, solo tiendas con ese modo habilitado).
- `store.provisioned` / `store.deprovisioned` (llegan con la activación; los atiende la fase 4).
- `order.fulfillment_issues.resolved` y `orders.release` (solo si se usan ajustes de pedido o liberación rápida).

### 1.3 Supuestos que hay que confirmar en el sandbox (la documentación se contradice o es ambigua)

- [ ] Nombre del evento de pedido nuevo: `orders.notification` (webhooks y calidad) contra `order.notification` (guía de pedidos). El código atiende el primero.
- [ ] Que `Get Order Details` traiga `current_state` (`CANCELED`, `DENIED`): se usa para cerrar pedidos perdidos.
- [ ] Que el formato de importes sea el esperado (centavos en `payment.charges.*`).
- [ ] Los motivos de cancelación y el permiso de entrega propia (`eats.store.orders.restaurantdelivery.status`).
- [ ] Los permisos de estado de tienda (`eats.store`, `eats.store.status.write`) y del aviso `eats.store.status.notification`.
- [ ] Menú: claves de idioma (mandamos `es_mx` y `en_us`), `tax_rate: 8` (IVA que se suma; la alternativa es `vat_rate_percentage`), máximo de cantidad de cada extra, largos de título.
- [ ] Umbral del piloto: *Going Live* dice 98 % y *Quality* dice 99.9 % de meta y 99 % de límite.
- [ ] Cómo se enciende la integración el día de lanzamiento: *Going Live* dice «PATCH Update POS Status» con `pos_integration_enabled`; la referencia de activación marca ese indicador como obsoleto.

## 2. Pruebas en el sandbox (antes de la verificación)

Con la tienda de prueba vinculada en **Ajustes > Uber Eats** y un túnel (o dominio) para el webhook:

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
- [ ] Variables de entorno de producción: `UBER_EATS_ENV=production`, `UBER_EATS_CLIENT_ID` y `UBER_EATS_CLIENT_SECRET` de la **aplicación de producción**; **quitar** `UBER_EATS_AUTH_URL` y `UBER_EATS_API_URL` (son solo para pruebas).
- [ ] Nunca pegar el Client Secret en un chat, captura o repositorio. El de pruebas ya apareció en una captura: regenerarlo.
- [ ] En el panel de Uber: autenticación del webhook **Basic HMAC** con la *Signing Key* igual al Client Secret (así lo valida el código).
- [ ] Responder rápido al webhook: Uber espera 200 con cuerpo vacío y reintenta con 500/502/503/504 hasta 7 envíos. Vigilar el arranque en frío si el backend corre como función sin servidor.
- [ ] Copias de seguridad de Mongo activas; la bitácora (`uber_events`) se limpia sola a los 30 días.

## 4. Cuenta y aplicación de producción en Uber

- [ ] Crear una cuenta de Uber **de producción**, distinta de la de pruebas (no una cuenta de prueba generada por Uber).
- [ ] Crear la aplicación de producción. **Una aplicación por cada URL de webhook distinta**: con una sola URL, una sola aplicación.
- [ ] Mandar al soporte técnico de Uber (t.uber.com/integration-support) una solicitud con el `client_id` de producción para que **habiliten los permisos**. Pedir: `eats.order`, `eats.store.orders.read`, `eats.store`, `eats.store.status.write`, `eats.store.status.notification`, `eats.store.orders.restaurantdelivery.status` y, para la fase 4, `eats.pos_provisioning`.
- [ ] Cuando confirmen: entrar al panel, **marcar y guardar** los permisos, y poner la URL del webhook (primaria).
- [ ] **(confirmar con Uber)** Las páginas dicen que estas APIs «pueden requerir aprobación por escrito» y la guía no explica los acuerdos o licencias del socio integrador. Preguntar qué contrato necesita firmar MiRestaurante como integrador de varios comercios.

## 5. Pedir la verificación

- [ ] Con las secciones 1 a 3 cerradas, enviar la solicitud de **verificación de la integración** al soporte técnico de Uber. Uber hace pruebas completas de punta a punta junto contigo.
- [ ] Tener a la mano: la lista de la sección 2 con resultados, la tasa de aceptación del sandbox y qué hace cada pantalla.
- [ ] Después de la verificación, Uber habilita la cuenta de producción (paso 4).

## 6. Piloto

- [ ] Elegir **un** restaurante piloto, con la caja abierta durante su horario, un equipo avisado y un dispositivo con Caja siempre a la vista.
- [ ] Avisar al **gerente de socio** de Uber la tienda y la fecha **al menos una semana antes**. Confirmar con él: aplicación de producción, URL del webhook y permisos.
- [ ] Vincular la tienda piloto: hoy el comercio pega su Store ID en Ajustes; con la fase 4 será autorizando desde Uber.
- [ ] Día de lanzamiento: publicar el menú desde **Ajustes > Uber Eats**, encender la integración de pedidos (confirmar el método con Uber, ver 1.3) y dejar la tienda en línea.
- [ ] Capacitar al equipo: **abrir la caja antes de abrir la tienda** (con la caja cerrada la tienda se pausa sola); aceptar o rechazar antes de 11 minutos (el sonido se repite cada 15 s); dar un toque en la página al empezar el turno y aceptar las notificaciones del navegador.
- [ ] Revisar **cada día** la tasa de aceptación (Ajustes del negocio y pestaña Uber Eats de la plataforma) y los errores de la bitácora.
- [ ] **Al menos 3 días** con la tasa que Uber exija (98 % según la guía de salida; la página de calidad pide 99.9 % y marca 99 % como límite).

## 7. Después del piloto

- [ ] Acordar con el gerente de socio un calendario para sumar más tiendas; antes de cada una, avisar de cambios operativos, vincularla, publicar su menú y encenderla el día de lanzamiento.
- [ ] Si la tasa baja, causas probables: caja cerrada o sin nadie atendiendo (pedidos que vencen), avisos perdidos (usar «Buscar pedidos perdidos»), productos agotados sin aviso, o pedidos con alergias que no se pueden cumplir (rechazarlos con el motivo correcto en vez de dejarlos vencer).

## 8. Quién hace qué

- **Tú / el negocio:** crear la cuenta y la aplicación de producción, hablar con soporte técnico y el gerente de socio de Uber, dominio y servidor de producción, elegir el piloto y capacitar al equipo, firmar lo que Uber pida.
- **Código pendiente antes de solicitar:** fase 4 (activación de tiendas por OAuth y gestión de la integración) y el tiempo de preparación de la tienda.
- **Lo que no puedo saber:** tiempos y exigencias de aprobación de Uber (acuerdos, cargos, plazos). Tampoco la tienda de prueba hasta que Uber la entregue.
