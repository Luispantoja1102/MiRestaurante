# MiRestaurante

Plataforma web de gestión de salón para restaurantes, cafés y hostelería. Cada cliente configura su negocio (nombre, logo e información operativa) mediante un asistente inicial.

Stack: Vue.js (frontend), Express.js (backend) y MongoDB. Monorepositorio: todo se ejecuta desde la raíz (`npm install`, `npm run dev`).

## Notas
- Decisiones: carpeta `Decisiones/`. Última: [[MiRestaurante/Decisiones/2026-11-13 Enfoque de servicio]].
- Sesiones de trabajo: carpeta `Sesiones/`. Última: [[MiRestaurante/Sesiones/2026-11-16 Uber Eats menú y agotados]] (antes [[MiRestaurante/Sesiones/2026-11-16 Uber Eats métricas y recuperación]], [[MiRestaurante/Sesiones/2026-11-16 Uber Eats estado de la tienda]], [[MiRestaurante/Sesiones/2026-11-16 Uber Eats ciclo del pedido]], [[MiRestaurante/Sesiones/2026-11-16 Uber Eats camino a producción]], [[MiRestaurante/Sesiones/2026-11-16 Terminal Mercado Pago]], [[MiRestaurante/Sesiones/2026-11-16 Integración Uber Eats]], [[MiRestaurante/Sesiones/2026-11-13 Pedidos a domicilio]], [[MiRestaurante/Sesiones/2026-11-13 Asistente, enfoques y ajustes]], [[MiRestaurante/Sesiones/2026-11-13 Platform admin soporte]], [[MiRestaurante/Sesiones/2026-11-13 Platform admin referidos y socios]], [[MiRestaurante/Sesiones/2026-11-13 Platform admin finanzas]] y [[MiRestaurante/Sesiones/2026-11-13 Platform admin como MiTiendita]]).

## Estado
- Vault creado el 2026-11-13.
- Platform admin: las 4 fases hechas (clientes y equipo, finanzas, referidos y socios, soporte).
- Negocios: asistente de 5 pasos con enfoque de servicio (para llevar, con meseros, completo), varias personas por rol y Ajustes con menú agrupado. Pedidos a domicilio: nombre, teléfono y dirección, envío de $50 y «Marcar entregado» (sin repartidor asignado todavía).
- Pendiente: registrar como cobros (y comisiones) los pagos automáticos de Mercado Pago.
- Pendiente opcional: leer por IMAP las respuestas por correo a los tickets de soporte.
- Terminal Mercado Pago Point: cada negocio conecta su cuenta (OAuth) y su terminal; cobro en terminal antes de registrar la venta, probado con un Mercado Pago simulado. Falta probarlo con terminal real y crear la app en Mercado Pago.
- Uber Eats: webhook firmado, vínculo de tienda por negocio y aceptar/rechazar en Caja, probado con un Uber simulado. Falta probarlo con el sandbox real, y Rappi y DiDi Food. Guía de salida a producción: [[MiRestaurante/Uber Eats salida a producción]]. Plan para producción en fases: [[MiRestaurante/Decisiones/2026-11-16 Plan Uber Eats a producción]] (fases 1, 2, 3, 5 y 6 hechas: avisos de pedido nuevo, ciclo completo del pedido, estado de la tienda, métricas con recuperación de pedidos perdidos, y menú con agotados; la fase 4 está pospuesta, falta el tiempo de preparación de la tienda y la fase 7 es la salida a producción).
