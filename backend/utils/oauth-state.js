/**
 * `state` firmado de un flujo OAuth con una cuenta externa (Mercado Pago, Uber Eats): dice de qué negocio es la
 * conexión sin depender de una sesión (el navegador vuelve sin credenciales) y caduca a los 15 minutos.
 */
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;

function fail(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

const sign = (tenantId, nonce, secret) => crypto.createHmac('sha256', secret).update(`${tenantId}.${nonce}`).digest('hex');

/** state = negocio.nonce.firma; el nonce lleva la hora de emisión. */
function signState(tenantId, secret) {
  const nonce = `${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
  return `${tenantId}.${nonce}.${sign(tenantId, nonce, secret)}`;
}

/** @returns el id del negocio, o lanza un error 400 si la firma no coincide o el enlace caducó. */
function readState(state, secret, ttlMs = TTL_MS) {
  const [tenantId, nonce, sig] = String(state || '').split('.');
  const expected = sign(tenantId, nonce, secret);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw fail('state inválido');
  }
  const issuedAt = parseInt(String(nonce).slice(0, -12), 36);
  if (!issuedAt || Date.now() - issuedAt > ttlMs) throw fail('El enlace de conexión caducó');
  return tenantId;
}

module.exports = { signState, readState, TTL_MS };
