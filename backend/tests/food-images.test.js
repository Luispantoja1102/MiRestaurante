// Foto del platillo: se guarda aparte y el platillo apunta a una dirección pública (la que Uber Eats descarga).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, startServer } = require('./helpers');

const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const admin = () => tokenFor('ana', 'admin');
const JPEG = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
const reset = () => { state.menus = [{ id: 'm1', tenantId: 't1', name: 'Bebidas' }]; state.foods = []; state.images = {}; };
const create = (imgUrl) => api.call('POST', '/foods', { token: admin(), body: { name: 'Latte', price: 50, menuId: 'm1', imgUrl } });

test('una foto subida se vuelve una dirección pública y se descarga sin sesión', async () => {
  reset();
  const r = await create(JPEG);
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.imgUrl, new RegExp(`/foods/${r.json.id}/image\\?v=\\d+$`));
  assert.ok(!r.json.imgUrl.startsWith('data:'));
  const img = await fetch(`${api.base}/foods/${r.json.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'fake-jpeg-bytes');
});

test('editar con otra foto la reemplaza y quitarla la borra', async () => {
  reset();
  const { json: f } = await create(JPEG);
  const other = `data:image/jpeg;base64,${Buffer.from('otra').toString('base64')}`;
  const u = await api.call('PUT', `/foods/${f.id}`, { token: admin(), body: { imgUrl: other } });
  assert.equal(u.status, 200, u.text);
  assert.equal(Buffer.from(await (await fetch(`${api.base}/foods/${f.id}/image`)).arrayBuffer()).toString(), 'otra');
  const d = await api.call('PUT', `/foods/${f.id}`, { token: admin(), body: { imgUrl: '' } });
  assert.equal(d.json.imgUrl, '');
  assert.equal((await fetch(`${api.base}/foods/${f.id}/image`)).status, 404);
});

test('una dirección https normal se conserva y una foto enorme o falsa se rechaza', async () => {
  reset();
  assert.equal((await create('https://x.test/a.jpg')).json.imgUrl, 'https://x.test/a.jpg');
  const big = `data:image/jpeg;base64,${Buffer.alloc(400 * 1024).toString('base64')}`;
  assert.equal((await create(big)).status, 400);
  const t = await create('data:text/html;base64,AAAA'); // no es una imagen: se guarda tal cual como texto, nunca se sirve
  assert.equal(t.json.imgUrl, 'data:text/html;base64,AAAA');
});

test('una foto WebP se guarda y se sirve como image/webp', async () => {
  reset();
  const r = await create(`data:image/webp;base64,${Buffer.from('fake-webp').toString('base64')}`);
  assert.equal(r.status, 201, r.text);
  assert.equal((await fetch(`${api.base}/foods/${r.json.id}/image`)).headers.get('content-type'), 'image/webp');
});
