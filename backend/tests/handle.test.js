// Envoltorio de controladores (utils/handle.js): lo inesperado se registra y se responde, y lo esperado conserva su código.
const test = require('node:test');
const assert = require('node:assert/strict');
const { handle, handleWith } = require('../utils/handle');

const fakeRes = (over = {}) => {
  const res = { sent: null, code: null, headersSent: false, ...over };
  res.status = (c) => { res.code = c; return res; };
  res.send = (b) => { res.sent = b; return res; };
  return res;
};
// Los errores de estas pruebas son a propósito: no se llenan los resultados con su registro
const quiet = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

test('si todo sale bien, devuelve lo que devuelve el controlador y no toca la respuesta', async () => {
  const res = fakeRes();
  const out = await handle('x', async (req, r) => r.status(201).send('ok'))({}, res);
  assert.equal(out, res);
  assert.deepEqual([res.code, res.sent], [201, 'ok']);
});

test('un fallo responde 500 con el mensaje del error, o con el texto de respaldo si no trae mensaje', async () => {
  const a = fakeRes();
  await quiet(() => handle('Error al crear', async () => { throw new Error('se cayó la base'); })({}, a));
  assert.deepEqual([a.code, a.sent], [500, 'se cayó la base']);
  const b = fakeRes();
  await quiet(() => handle('Error al crear', async () => { throw new Error(''); })({}, b));
  assert.deepEqual([b.code, b.sent], [500, 'Error al crear']);
});

test('statusOf: un error esperado se responde con su código y sin registrarlo como fallo', async () => {
  const res = fakeRes();
  let logged = 0;
  const original = console.error;
  console.error = () => { logged++; };
  try {
    const err = Object.assign(new Error('Tienda no encontrada'), { status: 404 });
    await handle('x', async () => { throw err; }, { statusOf: (e) => e.status })({}, res);
  } finally {
    console.error = original;
  }
  assert.deepEqual([res.code, res.sent, logged], [404, 'Tienda no encontrada', 0]);

  // Si statusOf no reconoce el error, sigue siendo un 500
  const other = fakeRes();
  await quiet(() => handle('x', async () => { throw new Error('raro'); }, { statusOf: (e) => e.status })({}, other));
  assert.deepEqual([other.code, other.sent], [500, 'raro']);
});

test('handleWith: usa su propia respuesta de error', async () => {
  class MiError extends Error { constructor(m, status) { super(m); this.status = status; } }
  const wrap = handleWith((res, err) => (err instanceof MiError ? res.status(err.status).send(err.message) : res.status(500).send('No pude')));
  const a = fakeRes();
  await wrap(async () => { throw new MiError('Sin permiso', 403); })({}, a);
  assert.deepEqual([a.code, a.sent], [403, 'Sin permiso']);
  const b = fakeRes();
  await wrap(async () => { throw new Error('otro'); })({}, b);
  assert.deepEqual([b.code, b.sent], [500, 'No pude']);
});

test('si la respuesta ya salió, no intenta responder otra vez', async () => {
  const res = fakeRes({ headersSent: true });
  await quiet(() => handle('x', async () => { throw new Error('tarde'); })({}, res));
  assert.deepEqual([res.code, res.sent], [null, null]);
});
