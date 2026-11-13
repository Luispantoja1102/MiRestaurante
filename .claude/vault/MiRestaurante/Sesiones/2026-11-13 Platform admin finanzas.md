# Sesión 2026-11-13 (fase 2: finanzas)

- **Qué se pidió:** seguir con el Platform admin igual que MiTiendita; fase 2, finanzas.
- **Qué se hizo:**
  - Registro de cobros en `billing_events` (tipo `payment`) y gastos en `platform_expenses`.
  - `backend/services/platform-finance.service.js`: lo cobrado, lo esperado (planes activos × precio), gastos, utilidad, tendencia de 6 meses y CSV. Los meses se cuentan en hora de Ciudad de México (UTC-6 fijo).
  - Rutas solo admin: `GET /platform/finance` (`?month=AAAA-MM`, `?format=csv`), `POST/DELETE /platform/expenses`, `POST /platform/tenants/:id/manual-payment`.
  - Un pago manual activa el negocio y extiende su periodo desde el fin del vigente (o desde hoy si ya venció). Los cobros salen también en la actividad del cliente.
  - Front: pestaña Finanzas (Ingresos, Cobros, Gastos) y pestaña Cobro en la ficha del cliente.
  - `PLATFORM_PARTNERS` (opcional) reparte la utilidad en partes iguales.
- **Cómo se probó:** 159 pruebas del backend (`platform-finance.test.js`); cobro, gasto y gráfica verificados en el navegador contra una base temporal.
- **Pendiente / dudas:** los cobros automáticos de Mercado Pago aún no se registran como pago (el webhook solo cambia el estado de la suscripción); hoy solo cuentan los pagos manuales. Faltan fases 3 (referidos y socios) y 4 (soporte).
