// IVA: la tasa del negocio y la marca «IVA incluido» de cada platillo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, startServer } = require('./helpers');
const tax = require('../utils/tax');

const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const admin = () => tokenFor('ana', 'admin');
const cashier = () => tokenFor('caro', 'cashier');

test('IVA incluido: el cliente paga el precio y el IVA va dentro; sin incluir: se suma', () => {
  const dentro = tax.lineBreakdown(70, 1, true, 0.08);
  assert.deepEqual([dentro.gross, tax.round2(dentro.tax), tax.round2(dentro.net)], [70, 5.19, 64.81]);
  const aparte = tax.lineBreakdown(70, 1, false, 0.08);
  assert.deepEqual([aparte.gross, tax.round2(aparte.tax)], [75.6, 5.6]);
  // sin dato (platillos de antes) = ya incluye
  assert.equal(tax.lineBreakdown(70, 1, undefined, 0.08).gross, 70);
  // 0 % es una tasa real, no «sin dato»
  assert.equal(tax.rateOf(0), 0);
  assert.equal(tax.lineBreakdown(70, 2, true, 0).tax, 0);
  assert.equal(tax.rateOf(undefined), 0.08);
  assert.equal(tax.rateOf(5), 0.08, 'una tasa fuera de rango se ignora');
});

test('cuenta mezclada: lo incluido y lo que se suma, más el envío', () => {
  const t = tax.cartTotals(
    [{ price: 70, quantity: 2, priceIncludesTax: true }, { price: 40, quantity: 1, priceIncludesTax: false }],
    { taxRate: 0.16, deliveryFee: 50 }
  );
  // 140 ya incluye IVA; 40 × 1.16 = 46.40; envío 50
  assert.deepEqual([t.subtotal, t.deliveryFee, t.total], [186.4, 50, 236.4]);
  assert.equal(tax.round2(t.subtotalNet + t.tax), t.subtotal);
});

test('el cálculo de la pantalla es idéntico al del servidor', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/tax.js'), 'utf8');
  const fe = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  for (const price of [0, 1.005, 35, 70, 129.5, 999.99]) {
    for (const qty of [1, 2, 3, 7]) {
      for (const inc of [true, false, undefined]) {
        for (const rate of [0, 0.08, 0.16, 0.045]) {
          assert.deepEqual(fe.lineBreakdown(price, qty, inc, rate), tax.lineBreakdown(price, qty, inc, rate), `${price}×${qty} ${inc} ${rate}`);
        }
      }
    }
  }
  const items = [{ price: 70, quantity: 2, priceIncludesTax: true }, { price: 40.5, quantity: 3, priceIncludesTax: false }];
  assert.deepEqual(fe.cartTotals(items, { taxRate: 0.08, deliveryFee: 50 }), tax.cartTotals(items, { taxRate: 0.08, deliveryFee: 50 }));
});

test('un platillo nuevo sale con el IVA incluido; se puede cambiar al editarlo', async () => {
  state.menus.push({ id: 'mx', tenantId: 't1', name: 'Desayunos' });
  const c = await api.call('POST', '/foods', { token: admin(), body: { name: 'Chilaquiles', price: 70, menuId: 'mx' } });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.json.priceIncludesTax, true);
  const u = await api.call('PUT', `/foods/${c.json.id}`, { token: admin(), body: { priceIncludesTax: false } });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.priceIncludesTax, false);
  const sinTocar = await api.call('PUT', `/foods/${c.json.id}`, { token: admin(), body: { price: 75 } });
  assert.equal(sinTocar.json.priceIncludesTax, false, 'editar otra cosa no cambia la marca');
});

test('venta de mostrador: $70 con IVA incluido se cobra $70; sin incluir, $75.60', async () => {
  state.settings.t1 = { businessType: 'restaurant', timezone: 'America/Tijuana' }; // sin tasa guardada = 8 %
  state.cash.push({ id: 'c-tax', tenantId: 't1', status: 'open' });
  state.foods.push(
    { id: 'f-chila', name: 'Chilaquiles', price: 70, priceIncludesTax: true, tenantId: 't1' },
    { id: 'f-viejo', name: 'Platillo de antes', price: 70, tenantId: 't1' },
    { id: 'f-aparte', name: 'Con IVA aparte', price: 70, priceIncludesTax: false, tenantId: 't1' },
  );
  const sale = (foodId) => api.call('POST', '/orders/counter', { token: cashier(), body: { items: [{ foodId, quantity: 1 }], paymentMethod: 'card' } });
  const incluido = (await sale('f-chila')).json;
  assert.deepEqual([incluido.subtotal, incluido.tax, incluido.total, incluido.pricesWithTax, incluido.taxRate], [70, 5.19, 70, true, 0.08]);
  assert.equal((await sale('f-viejo')).json.total, 70, 'un platillo sin marca ya incluye el IVA');
  const aparte = (await sale('f-aparte')).json;
  assert.deepEqual([aparte.subtotal, aparte.tax, aparte.total], [75.6, 5.6, 75.6]);
});

test('la tasa de IVA del negocio se guarda, se usa y no se pierde al guardar otra cosa', async () => {
  const base = { businessName: 'Café ZZ', businessType: 'restaurant', timezone: 'America/Tijuana' };
  const bad = await api.call('PUT', '/settings', { token: admin(), body: { ...base, taxRate: 2 } });
  assert.equal(bad.status, 400);
  const ok = await api.call('PUT', '/settings', { token: admin(), body: { ...base, taxRate: 0.16 } });
  assert.ok([200, 201].includes(ok.status), ok.text);
  assert.equal(state.settings.t1.taxRate, 0.16);

  const sale = await api.call('POST', '/orders/counter', { token: cashier(), body: { items: [{ foodId: 'f-aparte', quantity: 1 }], paymentMethod: 'card' } });
  assert.deepEqual([sale.json.total, sale.json.taxRate], [81.2, 0.16], '70 × 1.16');
  const dentro = await api.call('POST', '/orders/counter', { token: cashier(), body: { items: [{ foodId: 'f-chila', quantity: 1 }], paymentMethod: 'card' } });
  assert.deepEqual([dentro.json.total, dentro.json.tax], [70, 9.66], '70 con 16 % incluido');

  // guardar solo el logo (sin mandar la tasa) conserva el 16 %
  await api.call('PUT', '/settings', { token: admin(), body: { ...base, address: 'Calle 1' } });
  assert.equal(state.settings.t1.taxRate, 0.16);
});

test('el menú de Uber manda el IVA según la marca de cada platillo y la tasa del negocio', () => {
  const svc = require('../services/uber.menu.service');
  const { body } = svc.buildMenu({
    foods: [{ id: 'a', name: 'A', price: 10, menuId: 'm', priceIncludesTax: true }, { id: 'b', name: 'B', price: 10, menuId: 'm', priceIncludesTax: false }],
    menus: [{ id: 'm', name: 'M' }], ingredients: [], title: 'T', open: '08:00', close: '22:00', taxRate: 0.16,
  });
  assert.deepEqual(body.items.map((i) => i.tax_info), [{ vat_rate_percentage: 16 }, { tax_rate: 16 }]);
});

test('precio en Uber: sube lo que se queda Uber (plan Plus: $70 → $101.92, al peso $102)', () => {
  const up = require('../utils/uberPricing');
  const plus = { enabled: true, commissionPct: 27, marketingPct: 0, rounding: 0 };
  assert.equal(up.uberCut(plus), 0.3132, '27 % × 1.16');
  const exacto = up.uberPrice(70, { includesTax: true }, plus);
  assert.deepEqual([exacto.gross, exacto.net], [101.92, 70]);
  const alPeso = up.uberPrice(70, { includesTax: true }, { ...plus, rounding: 1 });
  assert.deepEqual([alPeso.gross, alPeso.price, alPeso.net], [102, 102, 70.05]);
  // sin IVA incluido: Uber suma el IVA, así que se publica la base y el cliente paga lo mismo
  const aparte = up.uberPrice(70, { includesTax: false, taxRate: 0.08 }, { ...plus, rounding: 0 });
  assert.equal(tax.round2(aparte.price * 1.08), aparte.gross);
  // apagado: el precio del menú tal cual; un precio en cero se queda en cero
  assert.equal(up.uberPrice(70, { includesTax: true }, { ...plus, enabled: false }).price, 70);
  assert.equal(up.uberPrice(0, { includesTax: true }, plus).price, 0);
});
