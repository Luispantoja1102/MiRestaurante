# Sesión 2026-11-13 (fase 4: soporte)

- **Qué se pidió:** terminar el Platform admin igual que MiTiendita; fase 4, soporte (bandeja y tickets).
- **Qué se hizo:**
  - Tickets guardados en la base (`support_tickets`, con sus mensajes dentro). Estados: `open` (espera al equipo), `answered` (espera al negocio) y `closed`; un mensaje del negocio reabre un ticket cerrado. Lógica en `services/support.service.js`.
  - Negocio: pantalla Soporte (`/support`, solo el admin del negocio) para abrir tickets y contestar. Sin `requireActiveSubscription` a propósito: un negocio suspendido o sin configurar debe poder pedir ayuda.
  - Plataforma (admin y soporte): pestaña Soporte con bandeja (filtro por estado y búsqueda) y panel del ticket para responder, cerrar y reabrir; pestaña Soporte en la ficha del cliente (ver tickets y escribirle al dueño); aviso de tickets esperando en «Hoy» y en la lista de clientes.
  - Correo (`utils/mail.utils.js`): si hay SMTP, aviso al equipo cuando entra o contesta un cliente, acuse al cliente y aviso al contestar el equipo. `SUPPORT_EMAIL` define dónde le llegan al equipo (si no, `MAIL_FROM`). El texto del usuario va escapado. Sin SMTP solo se deja en consola; el ticket existe igual.
- **Cómo se probó:** 189 pruebas del backend (`support.test.js`); ticket del cliente, respuesta del equipo, avisos en «Hoy» y pestaña de la ficha verificados en el navegador contra una base temporal.
- **Pendiente / dudas:** no se portó la lectura del buzón por IMAP de MiTiendita (los correos que el cliente responda por email no entran al ticket; contesta desde su cuenta) ni la asignación de tickets por persona (todo el equipo ve todos los tickets). Con esto el Platform admin queda completo salvo lo listado en las sesiones anteriores.
