# 2026-11-17 Impresora térmica y varias terminales

## Qué se hizo
- **Impresora térmica directa** (como MiTiendita): cada dispositivo imprime por USB, COM o Bluetooth en ESC/POS (PC850). Cuenta, comanda de cocina y corte de caja. Pantalla `/printer` (Ajustes → Impresora).
  - `frontend/src/escpos.js` (codificador y tickets), `ticketData.js` (datos del pedido), `thermalPrinter.js` (conexión, clave `mirestaurante_printer`), `printing.js` (`printOrder`, `printCashClose`, con respaldo al navegador).
  - Enganchado en Mostrador, Pedidos/Caja y Cocina. Pruebas: `backend/tests/escpos.test.js`.
- **Varias terminales Mercado Pago** con nombre interno.
  - `point.service.js`: `terminals[]` en la conexión (las conexiones viejas con `terminalId` se leen como lista de una). Máximo 10, nombres únicos (sin distinguir mayúsculas), `renameTerminal`, `removeTerminal`.
  - Rutas: `POST /point/terminal` (con `name`), `PUT/DELETE /point/terminals/:id`; `POST /point/charges` acepta `terminalId`.
  - Con una sola terminal el cobro no necesita elegir; con varias, sin `terminalId` responde `terminal_required`.
  - La venta guarda `pointTerminal` (nombre de la terminal donde se cobró).
  - Frontend: Ajustes → Terminal de cobro (lista, renombrar, quitar, agregar); Caja y Mostrador muestran selector si hay más de una lista (recuerda la última por dispositivo).

## Límites
- No se portó el ticket en imagen ni la estación de impresión remota (cola).
- La impresión directa no se probó con hardware real.
- `pointTerminal` se guarda pero aún no se muestra en el detalle del pedido.
- Ver [[MiRestaurante/Sesiones/2026-11-16 Terminal Mercado Pago]] para el modelo de cobro.
