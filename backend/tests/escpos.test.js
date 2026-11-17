// Tickets para la térmica (ESC/POS): codificación, formato y los datos que salen de un pedido.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// escpos.js y ticketData.js no tienen imports: se cargan como módulo, igual que brandColors.js
const load = (file) => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../frontend/src', file), 'utf8'))}`);
let esc;
let data;
test.before(async () => {
  esc = await load('escpos.js');
  data = await load('ticketData.js');
});

const has = (bytes, seq) => Buffer.from(bytes).toString('latin1').includes(Buffer.from(seq).toString('latin1'));
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const labels = { modality: { 'dine-in': 'En mesa', takeaway: 'Para llevar', delivery: 'A domicilio' }, channel: { uber: 'Uber Eats', phone: 'Teléfono' } };
const venue = { shop: 'Café Prueba', businessType: 'cafe', address: 'Calle 5 de Mayo 12', phone: '664 123 4567', cashier: 'caro', now: new Date(2026, 10, 17, 9, 5) };

const ORDER = {
  id: '6afba06b5a4fd99c0ca993db',
  tableName: 'Mesa 4',
  modality: 'dine-in',
  channel: 'local',
  turno: 7,
  createdAt: new Date(2026, 10, 17, 8, 30),
  paidAt: new Date(2026, 10, 17, 9, 0),
  items: [
    { name: 'Latte', quantity: 2, price: 40, notes: 'sin azúcar', options: [{ label: 'Sirope', quantity: 2, unitPrice: 8 }] },
    { name: 'Pan dulce', quantity: 1, price: 35 },
  ],
  subtotal: 131, tax: 10.48, deliveryFee: 0, total: 141.48,
  paymentStatus: 'paid', paymentMethod: 'cash', amountReceived: 200, change: 58.52,
  notes: 'Sin hielo',
};

test('acentos y ñ en PC850; lo que no existe se aproxima', () => {
  assert.deepEqual(esc.encodeText('ñÑáé¿¡'), [0xa4, 0xa5, 0xa0, 0x82, 0xa8, 0xad]);
  assert.equal(text(esc.encodeText('2 × $5 — ★')), '2 x $5 - *');
  assert.deepEqual(esc.encodeText('ç'), [0x63]);
});

test('wrap no parte palabras y leftRight alinea a las dos orillas', () => {
  assert.deepEqual(esc.wrap('Café con leche de avena', 12), ['Café con', 'leche de', 'avena']);
  assert.deepEqual(esc.wrap('Supercalifragilistico', 8), ['Supercal', 'ifragili', 'stico']);
  const [line] = esc.leftRight('Total', '$10.00', 20);
  assert.equal(line.length, 20);
  assert.ok(line.startsWith('Total') && line.endsWith('$10.00'));
  assert.ok(esc.leftRight('Un nombre larguísimo de producto', '$5.00', 20).every((l) => l.length <= 20));
});

test('cuenta de 80 mm: inicia, imprime lo cobrado, abre el cajón y corta', () => {
  const t = data.orderTicketData(ORDER, venue, labels);
  const bytes = esc.buildReceipt(t, { cols: 42, openDrawer: true });
  assert.ok(has(bytes, [0x1b, 0x40]), 'ESC @');
  assert.ok(has(bytes, [0x1b, 0x74, 0x02]), 'página PC850');
  assert.ok(has(bytes, [0x1b, 0x70, 0x00]), 'pulso al cajón');
  assert.ok(has(bytes, [0x1d, 0x56, 0x42]), 'corte');
  const s = text(bytes);
  for (const fragment of ['PRUEBA', 'CUENTA / RECIBO', 'Latte', 'Sirope', 'sin az', 'TOTAL', '141.48', 'Efectivo', '58.52', 'PAGADO', 'Sin hielo', 'GRACIAS POR SU VISITA']) {
    assert.ok(s.includes(fragment), `trae «${fragment}»`);
  }
});

test('la propina sugerida solo sale en cuentas de mesa, no en el mostrador', () => {
  const mesa = text(esc.buildReceipt(data.orderTicketData(ORDER, venue, labels), { cols: 42 }));
  assert.ok(mesa.includes('PROPINA SUGERIDA') && mesa.includes('14.15'), '10% de 141.48');
  const mostrador = text(esc.buildReceipt(data.orderTicketData({ ...ORDER, source: 'counter' }, venue, labels), { cols: 42 }));
  assert.ok(!mostrador.includes('PROPINA'));
  assert.ok(mostrador.includes('MOSTRADOR'));
});

test('cuenta sin cobrar: pendiente de pago, sin cajón y sin recibido', () => {
  const t = data.orderTicketData({ ...ORDER, paymentStatus: 'unpaid', paymentMethod: null, paidAt: null, amountReceived: null }, venue, labels);
  const bytes = esc.buildReceipt(t, { cols: 42, openDrawer: false });
  const s = text(bytes);
  assert.ok(s.includes('PENDIENTE DE PAGO') && !s.includes('PAGADO') && !s.includes('Recibido'));
  assert.ok(!has(bytes, [0x1b, 0x70, 0x00]), 'sin pulso al cajón');
});

test('pedido a domicilio de una plataforma: origen, datos de entrega y envío', () => {
  const t = data.orderTicketData({
    ...ORDER, channel: 'uber', modality: 'delivery', source: 'uber', deliveryFee: 0,
    delivery: { name: 'Marta Ríos', phone: '+52 5512345678', address: 'Calle Madero 10', reference: 'Uber Eats #AB12' },
    paymentMethod: 'platform', amountReceived: null,
  }, venue, labels);
  const s = text(esc.buildReceipt(t, { cols: 42 }));
  for (const fragment of ['UBER EATS', 'A DOMICILIO', 'MARTA R', 'CALLE MADERO 10', 'Plataforma']) assert.ok(s.includes(fragment), `trae «${fragment}»`);
  assert.ok(!s.includes('Recibido'));
});

test('comanda de cocina: grande, sin precios y con extras y notas', () => {
  const t = data.orderTicketData(ORDER, venue, labels, 'kitchen');
  const bytes = esc.buildKitchen(t, { cols: 42 });
  const s = text(bytes);
  assert.ok(has(bytes, [0x1d, 0x21, 0x11]), 'letra doble para los platillos');
  assert.ok(has(bytes, [0x1d, 0x56, 0x42]), 'corte');
  for (const fragment of ['COMANDA', 'PLATILLOS', '2 LATTE', '+ SIROPE x2', 'NOTA: sin az', 'ORDEN: Sin hielo', 'A COCINA']) assert.ok(s.includes(fragment), `trae «${fragment}»`);
  assert.ok(!s.includes('141.48') && !s.includes('TOTAL') && !s.includes('Cobro'), 'ni precios ni cobro');
});

test('corte de caja: resumen, diferencia y detalle de tickets', () => {
  const session = {
    id: 'abcdef1234567890', openedBy: 'caro', openedAt: new Date(2026, 10, 17, 8, 0), closedBy: 'caro', closedAt: new Date(2026, 10, 17, 20, 0),
    openingFloat: 100, expectedCash: 600, expectedCard: 300, expectedTransfer: 50, expectedPlatform: 125, expectedOther: 0, expectedTotal: 1075,
    countedCash: 590, difference: -10, notes: 'faltó cambio',
  };
  const t = data.cashTicketData(session, [{ tableName: 'Mesa 4', paymentMethod: 'cash', total: 141.48 }, { tableName: 'Uber Eats · Marta', paymentMethod: 'platform', total: 86.4 }], venue);
  const s = text(esc.buildCashClose(t, { cols: 42 }));
  for (const fragment of ['CORTE DE CAJA', 'Fondo inicial', '$100.00', 'Ventas efectivo', '$500.00', 'Plataformas', '$125.00', 'DIFERENCIA', '-$10.00', 'Mesa 4', 'EFEC', 'PLAT', 'OBS: falt']) {
    assert.ok(s.includes(fragment), `trae «${fragment}»`);
  }
  assert.ok(s.includes('Tickets') && /Tickets\s+2/.test(s));
});

test('58 mm: ningún renglón pasa de 32 columnas', () => {
  const t = data.orderTicketData({ ...ORDER, items: [{ name: 'Hamburguesa doble con queso y tocino extra grande', quantity: 3, price: 129.5 }] }, venue, labels);
  const s = text(esc.buildReceipt(t, { cols: 32 }));
  for (const line of s.split('\n')) assert.ok(line.replace(/[\x00-\x1f]/g, '').length <= 32 + 8, `renglón corto: «${line.slice(0, 60)}»`);
});

test('ticket en imagen: bandas GS v 0, píxeles oscuros en negro, papel en blanco, y corte', () => {
  // 10 × 3 px: la primera columna negra, el resto blanco; el último píxel transparente (= papel)
  const w = 10, h = 3;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) { const i = y * w * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; }
  rgba[(w * 1 + 9) * 4 + 3] = 0;
  const b = esc.rasterBytes(w, h, rgba, { openDrawer: true });
  assert.deepEqual(b.slice(0, 2), [0x1b, 0x40]);
  assert.deepEqual(b.slice(2, 10), [0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0], '2 bytes por fila, 3 filas');
  assert.deepEqual(b.slice(10, 16), [0x80, 0x00, 0x80, 0x00, 0x80, 0x00], 'solo la primera columna negra');
  assert.ok(has(b, [0x1b, 0x70, 0x00]) && has(b, [0x1d, 0x56, 0x42]), 'cajón y corte');
  assert.ok(!has(esc.rasterBytes(w, h, rgba), [0x1b, 0x70, 0x00]), 'sin cajón si no se pide');
  // una imagen alta se parte en bandas de 200 filas
  const tall = esc.rasterBytes(8, 450, new Uint8ClampedArray(8 * 450 * 4).fill(255));
  assert.equal(Buffer.from(tall).toString('latin1').split('\x1dv0').length - 1, 3);
});

test('página de prueba con acentos y relleno', () => {
  const s = text(esc.buildTestPage({ cols: 42, shop: 'Café Prueba', openDrawer: true }));
  assert.ok(s.includes('PRUEBA') && s.includes('80 mm') && s.includes('$1,234.50'));
  assert.ok(s.includes('Papel') && s.includes('Acentos'));
});

test('los datos del ticket tolerantes: pedido casi vacío no rompe', () => {
  const t = data.orderTicketData({ id: 'x', items: [] }, {}, {});
  assert.equal(t.total, 0);
  assert.equal(t.shop, 'MiRestaurante');
  assert.doesNotThrow(() => esc.buildReceipt(t, { cols: 42 }));
  assert.doesNotThrow(() => esc.buildKitchen(t, { cols: 42 }));
  assert.doesNotThrow(() => esc.buildCashClose(data.cashTicketData(null, [], {}), { cols: 42 }));
});
