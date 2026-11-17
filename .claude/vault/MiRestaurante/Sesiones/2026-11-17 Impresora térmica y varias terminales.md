# 2026-11-17 Impresora térmica y varias terminales

## Qué se hizo
- **Impresora térmica directa** (como MiTiendita): cada dispositivo imprime por USB, COM o Bluetooth en ESC/POS (PC850). Cuenta, comanda de cocina y corte de caja. Menú en Ajustes → Impresora (sección de `SettingsView.vue` con tarjetas de modo y papel e interruptores, como MiTiendita); `/printer` solo redirige ahí y `PrinterView.vue` se eliminó.
  - `frontend/src/escpos.js` (codificador y tickets), `ticketData.js` (datos del pedido), `thermalPrinter.js` (conexión, clave `mirestaurante_printer`), `printing.js` (`printOrder`, `printCashClose`, con respaldo al navegador).
  - Enganchado en Mostrador, Pedidos/Caja y Cocina. Pruebas: `backend/tests/escpos.test.js`.
- **Varias terminales Mercado Pago** con nombre interno.
  - `point.service.js`: `terminals[]` en la conexión (las conexiones viejas con `terminalId` se leen como lista de una). Máximo 10, nombres únicos (sin distinguir mayúsculas), `renameTerminal`, `removeTerminal`.
  - Rutas: `POST /point/terminal` (con `name`), `PUT/DELETE /point/terminals/:id`; `POST /point/charges` acepta `terminalId`.
  - Con una sola terminal el cobro no necesita elegir; con varias, sin `terminalId` responde `terminal_required`.
  - La venta guarda `pointTerminal` (nombre de la terminal donde se cobró).
  - Frontend: Ajustes → Terminal de cobro (lista, renombrar, quitar, agregar); Caja y Mostrador muestran selector si hay más de una lista (recuerda la última por dispositivo).

- **Cuenta con diseño de restaurante** (imagen): `ticketImage.js` dibuja la cuenta en canvas (logo tramado, mesa en recuadro, consumo con cantidades, total enmarcado, propina sugerida, sello PAGADO o «Pendiente de pago», borde recortado) y `rasterBytes` (`escpos.js`) la manda como GS v 0 en bandas de 200 filas. Ajuste `ticketStyle` (image por defecto | text) en Ajustes → Impresora; si el dibujo falla, sale en texto. Solo la cuenta: la comanda y el corte siguen en texto.
- **Botón «Imprimir cuenta»** en la hoja de la mesa (`MainComponent.vue`): imprime la cuenta abierta sin cobrar.

- **Ventana de impresión como MiTiendita** (modo Navegador): `PrintOrderView.vue` (cuenta y comanda) y `PrintCashCloseView.vue` (corte) rehechos con barra de herramientas (Cerrar, papel 80/58, Imprimir), papel con toldo, barra negra, talón, total invertido, sello y despedida manuscrita. Salen de `ticket.css`, `ticketShell.js`, `components/TicketHeader.vue` y `storeTime.js` (copiados y adaptados de MiTiendita). El ancho de papel es el mismo de Ajustes → Impresora. Fuente Caveat añadida en `index.html`. No se portaron el código de barras, el QR de factura ni los cortes X por segmentos.
- Nota: el modo «puerto COM» no ve el puerto virtual «EPSON COM Emulation» (Epson TM-T88V); para esa impresora sirve el modo Navegador con `--kiosk-printing`.

- **Diseño propio de restaurante** (ya no el de tienda de MiTiendita): servicio de mesa (tenedor, plato, cuchillo) en el encabezado, círculo con mesa o turno, «Su orden» como carta, total con doble línea, propina con renglones, «¡Buen provecho!». Igual en la vista del navegador (`TicketHeader.vue`, bloque `rt-*` de `ticket.css`, `PrintOrderView.vue`) y en la imagen de la térmica (`ticketImage.js`).
- **Prueba real en Epson TM-T88V:** la imagen a 576 puntos salía cortada del lado derecho; esa impresora imprime 512 puntos útiles. Ahora el ancho de 80 mm es configurable (`dots80`, 512 por defecto) y la imagen quedó compacta (≈930 filas, ≈60 KB frente a ≈1300 filas y ≈93 KB). La impresión por imagen sigue siendo más lenta que la de texto: subir la velocidad del puerto (115200) y/o usar «Texto sencillo».
- **Navegador:** Opera no lista el puerto virtual «EPSON COM Emulation»; Edge sí. Un `Uint8Array` es obligatorio para Web Serial (error corregido en `rasterBytes`).

- **Ajustes → Impresora con botón «Guardar cambios»:** los cambios se editan en un borrador (`pd` en `SettingsView.vue`); la barra inferior muestra «Tienes cambios sin guardar», luego «✓ Cambios guardados en este dispositivo». Conectar, probar y abrir cajón se bloquean mientras haya cambios sin guardar. También hay «Probar ancho» (regla de 384–576 puntos) y ancho 480/512/576. La intensidad se quitó como ajuste: el ticket en imagen usa siempre el corte «normal» (190) con letras más gruesas.
- **Aviso:** el servidor de desarrollo de Vite puede servir un módulo viejo si dos ediciones seguidas del mismo archivo se pisan (pasó con `printing.js`: `paperDots is not defined`); si algo falla solo en `npm run dev`, tocar el archivo o reiniciar el servidor. Si el diseño en imagen no se puede dibujar, la cuenta sale en texto y la app avisa con el motivo.

- **Ticket por rubro** (Ajustes → Datos y logo → «Tipo de establecimiento»): `TICKET_PROFILES` e iconos en `ticketData.js`, compartidos por la vista del navegador, la imagen de la térmica y el texto. Restaurante: tenedor/plato/cuchillo, «Su orden», «¡Buen provecho!», con propina. Café: cuchara/taza/grano, «Su pedido», «¡Que lo disfrutes!», sin propina. Bar: rombo/copa/rombo, «Su consumo», «¡Salud!», con propina. Hotel: estrella/campana/estrella, «Su orden», con propina. Otro: estrella/etiqueta/estrella, «Su pedido», «¡Gracias!», sin propina. La comanda de cocina es igual para todos. Quitados `closingLine`, `closingNote` y `BUSINESS_TYPE_LABEL` de `ticketShell.js`.

## Límites
- La estación de impresión remota (cola) no se portó. La vista de impresión del navegador conserva el diseño de texto anterior.
- La impresión directa no se probó con hardware real.
- `pointTerminal` se guarda pero aún no se muestra en el detalle del pedido.
- Ver [[MiRestaurante/Sesiones/2026-11-16 Terminal Mercado Pago]] para el modelo de cobro.
