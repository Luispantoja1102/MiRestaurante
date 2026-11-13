# Sesión 2026-11-13 (fase 3: referidos y socios)

- **Qué se pidió:** seguir con el Platform admin igual que MiTiendita; fase 3, referidos y socios comerciales.
- **Qué se hizo:**
  - Vendedores con código `MR-XXXXXX`, escalera de comisiones (15% a 25% según ventas cerradas: `services/referral.tiers.js`), comisión por cada cobro de un negocio referido, anulación, liquidación y datos de pago. Datos en `database/referral.db.js`.
  - Portal de socios (`/partner`, roles `partner_admin` y `partner_staff`): inicio con enlace de registro, clientes con notas y responsable, comisiones y equipo. El asesor no ve dinero ni equipo. `middleware/partner.middleware.js` confirma en la base que la cuenta siga activa y con su rol.
  - Plataforma: pestaña Referidos (alta con acceso al portal en un paso, ficha con resumen, negocios, comisiones y accesos), bloque «Vendedor» en la ficha del cliente, y las comisiones del mes se restan de la utilidad en Finanzas.
  - Registro: campo opcional de código de vendedor (`/register?ref=CODE`). Un código inválido se rechaza antes de crear el negocio.
  - Cuentas desactivadas no pueden iniciar sesión.
  - «Mi código de vendedor» para el admin de la plataforma: `GET/POST /platform/my-seller`. Liga la cuenta con su vendedor por el correo de la cuenta (`ownerEmail` en el vendedor): si ya había uno con ese correo se liga ese, si no se crea. Tarjeta en la pestaña Referidos.
- **Cómo se probó:** 176 pruebas del backend (`referrals.test.js`, con módulos de datos falsos en `tests/helpers.js`); portal, cobro con comisión, nota y registro con código verificados en el navegador contra una base temporal.
- **Pendiente / dudas:** no se portó eliminar vendedores, la página pública para postularse ni 2FA. Las comisiones solo se generan con pagos manuales (los de Mercado Pago aún no se registran como cobro). La tendencia de 6 meses en Finanzas es antes de comisiones. Falta la fase 4 (soporte).
