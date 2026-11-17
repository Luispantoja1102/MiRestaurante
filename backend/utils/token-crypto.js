/** Cifrado de tokens de cuentas externas guardados en la base (AES-256-GCM). TOKEN_ENC_KEY = 32 bytes en hex. */
const crypto = require('crypto');

const key = () => {
  const k = Buffer.from(String(process.env.TOKEN_ENC_KEY || ''), 'hex');
  if (k.length !== 32) {
    const e = new Error('TOKEN_ENC_KEY inválida (32 bytes en hex).');
    e.status = 500;
    throw e;
  }
  return k;
};

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('hex')).join('.');
}

function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split('.').map((h) => Buffer.from(h, 'hex'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
