/**
 * Terminal de cobro Mercado Pago Point.
 * Cada negocio conecta SU cuenta de Mercado Pago (OAuth) y elige su terminal. El cobro en la terminal va primero;
 * la venta (pay / venta de mostrador) lo «consume» una sola vez.
 *
 * ⚠️ Endpoints de Point/Orders armados con la documentación de Mercado Pago (igual que en MiTiendita): confirma con
 *    una terminal real /terminals/v1/list, /terminals/v1/setup y /v1/orders.
 */
const crypto = require('crypto');
const db = require('../database/mongodb');

const MP_API = process.env.MP_API_URL || 'https://api.mercadopago.com'; // MP_API_URL solo para pruebas con un Mercado Pago simulado

function httpError(msg, status = 400, code) {
  const e = new Error(msg);
  e.status = status;
  e.code = code;
  return e;
}

/* ───────────── Cifrado de tokens (AES-256-GCM). TOKEN_ENC_KEY = 32 bytes en hex ───────────── */
const KEY = () => {
  const k = Buffer.from(String(process.env.TOKEN_ENC_KEY || ''), 'hex');
  if (k.length !== 32) throw httpError('TOKEN_ENC_KEY inválida (32 bytes en hex).', 500);
  return k;
};
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('hex')).join('.');
}
function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split('.').map((h) => Buffer.from(h, 'hex'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/* ───────────── OAuth: conectar la cuenta de Mercado Pago del negocio ───────────── */
const STATE_TTL_MS = 15 * 60 * 1000;
const stateSecret = () => {
  const s = process.env.OAUTH_STATE_SECRET;
  if (!s) throw httpError('Falta OAUTH_STATE_SECRET en el servidor.', 500, 'not_configured');
  return s;
};

const REQUIRED_ENV = ['MP_CLIENT_ID', 'MP_CLIENT_SECRET', 'MP_OAUTH_REDIRECT', 'OAUTH_STATE_SECRET', 'TOKEN_ENC_KEY'];
const isConfigured = () => REQUIRED_ENV.every((k) => process.env[k]);
function requireOAuthConfig() {
  if (!isConfigured()) throw httpError('La conexión con Mercado Pago no está configurada en el servidor.', 503, 'not_configured');
}

function buildAuthUrl(tenantId) {
  requireOAuthConfig();
  // El nonce lleva la hora de emisión: el enlace de autorización caduca
  const nonce = `${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
  const sig = crypto.createHmac('sha256', stateSecret()).update(`${tenantId}.${nonce}`).digest('hex');
  const q = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID,
    response_type: 'code',
    platform_id: 'mp',
    state: `${tenantId}.${nonce}.${sig}`,
    redirect_uri: process.env.MP_OAUTH_REDIRECT,
  });
  return `https://auth.mercadopago.com.mx/authorization?${q}`;
}

function parseState(state) {
  const [tenantId, nonce, sig] = String(state || '').split('.');
  const expected = crypto.createHmac('sha256', stateSecret()).update(`${tenantId}.${nonce}`).digest('hex');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw httpError('state inválido', 400);
  }
  const issuedAt = parseInt(String(nonce).slice(0, -12), 36);
  if (!issuedAt || Date.now() - issuedAt > STATE_TTL_MS) throw httpError('El enlace de conexión caducó', 400);
  return tenantId;
}

async function oauthToken(params) {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(data.message || 'OAuth Mercado Pago falló', res.status, 'oauth_failed');
  return data;
}

const tokenPatch = (data) => ({
  accessToken: encrypt(data.access_token),
  refreshToken: encrypt(data.refresh_token),
  mpUserId: String(data.user_id),
  tokenExpiresAt: new Date(Date.now() + (data.expires_in || 15552000) * 1000),
  status: 'connected',
  lastError: null,
});

async function handleOAuthCallback({ code, state }) {
  const tenantId = parseState(state);
  const data = await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: process.env.MP_OAUTH_REDIRECT });
  await db.SavePointConnection(tenantId, tokenPatch(data));
  return tenantId;
}

/** Token válido del negocio (se renueva solo si le queda menos de 1 día). */
async function getTenantToken(tenantId) {
  const p = await db.GetPointConnection(tenantId);
  if (!p?.accessToken) throw httpError('Cuenta de Mercado Pago no conectada', 409, 'not_connected');

  const expiresSoon = !p.tokenExpiresAt || new Date(p.tokenExpiresAt).getTime() - Date.now() < 24 * 3600 * 1000;
  if (!expiresSoon) return decrypt(p.accessToken);

  try {
    const data = await oauthToken({ grant_type: 'refresh_token', refresh_token: decrypt(p.refreshToken) });
    await db.SavePointConnection(tenantId, tokenPatch(data));
    return data.access_token;
  } catch {
    await db.SavePointConnection(tenantId, { status: 'disconnected', lastError: 'token_revoked' });
    throw httpError('La conexión con Mercado Pago expiró. Reconecta tu cuenta.', 409, 'token_revoked');
  }
}

/** Llamada autenticada a Mercado Pago con el token del negocio. */
async function mp(tenantId, path, { method = 'GET', body, headers = {} } = {}) {
  const token = await getTenantToken(tenantId);
  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await db.SavePointConnection(tenantId, { status: 'disconnected', lastError: 'unauthorized' });
    throw httpError('Mercado Pago rechazó la conexión. Reconecta tu cuenta.', 409, 'token_revoked');
  }
  if (!res.ok) {
    const cause = Array.isArray(data?.errors) ? data.errors.map((e) => e.message || e.code).join('; ') : '';
    throw httpError(cause || data.message || `Mercado Pago error ${res.status}`, res.status, 'mp_error');
  }
  return data;
}

/* ───────────── Terminal ───────────── */
async function listTerminals(tenantId) {
  const data = await mp(tenantId, '/terminals/v1/list?limit=50');
  return data?.data?.terminals || data?.terminals || [];
}

const setPdvMode = (tenantId, terminalId) =>
  mp(tenantId, '/terminals/v1/setup', { method: 'PATCH', body: { terminals: [{ id: terminalId, operating_mode: 'PDV' }] } });

async function registerTerminal(tenantId, terminalId) {
  const t = (await listTerminals(tenantId)).find((x) => x.id === terminalId);
  if (!t) throw httpError('Esa terminal no pertenece a tu cuenta de Mercado Pago', 404, 'terminal_not_found');
  await setPdvMode(tenantId, terminalId); // la terminal recibe cobros desde el sistema
  await db.SavePointConnection(tenantId, {
    terminalId,
    terminalLabel: t.external_pos_id || t.id,
    registeredAt: new Date(),
    status: 'ready',
    lastError: null,
  });
  return { terminalId };
}

/** ¿Se puede cobrar AHORA? Devuelve { ok, code, message }. */
async function preflight(tenantId) {
  const p = await db.GetPointConnection(tenantId);
  if (!p?.accessToken) return { ok: false, code: 'not_connected', message: 'Conecta tu cuenta de Mercado Pago para cobrar con terminal.' };
  if (!p.terminalId) return { ok: false, code: 'no_terminal', message: 'Elige tu terminal de Mercado Pago para cobrar con tarjeta.' };
  try {
    const t = (await listTerminals(tenantId)).find((x) => x.id === p.terminalId);
    if (!t) {
      await db.SavePointConnection(tenantId, { status: 'disconnected', lastError: 'terminal_missing' });
      return { ok: false, code: 'terminal_missing', message: 'Tu terminal ya no aparece vinculada a tu cuenta. Vuelve a elegirla.' };
    }
    if (t.operating_mode && t.operating_mode !== 'PDV') await setPdvMode(tenantId, p.terminalId);
    await db.SavePointConnection(tenantId, { status: 'ready', lastCheckAt: new Date(), lastError: null });
    return { ok: true, code: 'ready', message: 'Terminal lista' };
  } catch (err) {
    return { ok: false, code: err.code || 'check_failed', message: err.message };
  }
}

/** Estado para Ajustes y para el cobro. Nunca devuelve tokens. */
async function status(tenantId) {
  const p = await db.GetPointConnection(tenantId);
  const base = { available: isConfigured(), connected: Boolean(p?.accessToken), terminalLabel: p?.terminalLabel || '' };
  if (!base.available) return { ...base, ok: false, code: 'not_configured', message: 'La conexión con Mercado Pago no está configurada en el servidor.' };
  if (!p?.terminalId) {
    return { ...base, ok: false, code: p?.accessToken ? 'no_terminal' : 'not_connected', message: p?.accessToken ? 'Elige tu terminal para cobrar con tarjeta.' : 'Conecta tu cuenta de Mercado Pago.' };
  }
  return { ...base, ...(await preflight(tenantId)) };
}

const disconnect = (tenantId) => db.DeletePointConnection(tenantId);

/** Valida la firma x-signature del webhook (clave secreta de Webhooks de tu app de Mercado Pago). */
function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const sig = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const ts = /ts=([^,]+)/.exec(sig)?.[1];
  const v1 = /v1=([^,]+)/.exec(sig)?.[1];
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  if (!ts || !v1) return false;
  const mine = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return mine.length === v1.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(v1));
}

/* ───────────── Cobros ───────────── */
const PAID = new Set(['processed']);
// El pago puede figurar aprobado en la transacción antes de que la orden cambie a «processed»: solo se acepta con el
// monto exacto y si SIGUE aprobado en una segunda revisión unos segundos después.
const PAYMENT_PAID = new Set(['processed', 'approved', 'accredited']);
const CONFIRM_MS = 5000;
const FAILED = new Set(['failed', 'canceled', 'cancelled', 'expired']);
const NEEDS_REVIEW = new Set(['action_required']); // hay que confirmar en la terminal si el pago se hizo
const STALE_MS = 30 * 60 * 1000;

/** Si la terminal sigue con un cobro anterior: se resuelve o se avisa (una terminal atiende un cobro a la vez). */
async function assertTerminalFree(tenantId, clientSaleId, terminalId) {
  const recent = await db.ListPointChargesSince(tenantId, new Date(Date.now() - STALE_MS));
  for (const c of recent) {
    if (c.status !== 'pending' || c.clientSaleId === clientSaleId || c.terminalId !== terminalId) continue;
    let now = await syncCharge(tenantId, c.id).catch(() => c);
    if (now.status === 'pending') now = await cancelCharge(tenantId, c.id).catch(() => now);
    if (now.status === 'pending') {
      const mins = Math.max(1, Math.round((Date.now() - new Date(c.createdAt).getTime()) / 60000));
      throw httpError(
        `La terminal sigue mostrando un cobro anterior de $${Number(c.amount).toFixed(2)} (de hace ${mins} min). Termínalo o cancélalo en la terminal y vuelve a intentar.`,
        409,
        'terminal_busy'
      );
    }
  }
}

/** Crea el cobro en la terminal. Idempotente por clientSaleId + monto mientras siga pendiente. */
async function startCharge({ tenantId, clientSaleId, amount }) {
  if (!clientSaleId) throw httpError('Falta clientSaleId', 400);
  const value = Number(amount).toFixed(2);
  if (!(Number(value) > 0)) throw httpError('Monto inválido', 400);

  const check = await preflight(tenantId);
  if (!check.ok) throw httpError(check.message, 409, check.code);
  const { terminalId } = await db.GetPointConnection(tenantId);
  await assertTerminalFree(tenantId, String(clientSaleId), terminalId);

  const prev = await db.GetPointChargeBySale(clientSaleId, tenantId);
  if (prev && prev.status === 'pending' && prev.amount === Number(value)) return { id: prev.id, status: 'pending' };
  if (prev && prev.status === 'paid' && !prev.consumedBy && prev.amount === Number(value)) return { id: prev.id, status: 'paid' };
  const attempt = (prev?.attempt || 0) + 1;
  const idem = crypto.createHash('sha256').update(`${tenantId}:${clientSaleId}:${value}:${attempt}`).digest('hex');

  let mpOrder;
  try {
    mpOrder = await mp(tenantId, '/v1/orders', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idem },
      body: {
        type: 'point',
        external_reference: String(clientSaleId),
        description: `Venta ${String(clientSaleId).slice(-6).toUpperCase()}`,
        transactions: { payments: [{ amount: value }] },
        config: { point: { terminal_id: terminalId }, payment_method: { default_type: 'debit_card' } },
      },
    });
  } catch (err) {
    if (/already has an order|already_queued|queued|en espera|ocupad|busy/i.test(err.message)) {
      throw httpError('La terminal tiene un cobro pendiente. Termínalo o cancélalo en la terminal.', 409, 'terminal_busy');
    }
    throw err;
  }

  const charge = await db.CreatePointCharge({
    tenantId,
    clientSaleId: String(clientSaleId),
    amount: Number(value),
    mpOrderId: String(mpOrder.id),
    mpStatus: mpOrder.status,
    terminalId,
    status: 'pending',
    attempt,
    consumedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { id: charge.id, status: 'pending' };
}

/** Consulta a Mercado Pago (fuente de verdad) y actualiza el cobro. Idempotente. */
async function syncCharge(tenantId, chargeId) {
  const charge = await db.GetPointCharge(chargeId, tenantId);
  if (!charge) throw httpError('Cobro no encontrado', 404);
  if (charge.status !== 'pending') return charge;

  const mpOrder = await mp(tenantId, `/v1/orders/${charge.mpOrderId}`);
  const s = String(mpOrder.status || '').toLowerCase();
  const payment = mpOrder.transactions?.payments?.[0];

  const orderPaid = PAID.has(s);
  const paymentApproved = !orderPaid && !FAILED.has(s) && PAYMENT_PAID.has(String(payment?.status || '').toLowerCase());
  if (paymentApproved) {
    const approvedAmount = Number(payment?.paid_amount ?? 0);
    const firstSeen = charge.approvedSeenAt ? new Date(charge.approvedSeenAt).getTime() : 0;
    const exact = Math.abs(approvedAmount - charge.amount) <= 0.01;
    if (exact && !firstSeen) {
      await db.UpdatePointCharge(chargeId, { approvedSeenAt: new Date(), mpStatus: s, updatedAt: new Date() }, tenantId);
      return { ...charge, mpStatus: s };
    }
    if (!exact || Date.now() - firstSeen < CONFIRM_MS) return { ...charge, mpStatus: s };
  }
  if (orderPaid || paymentApproved) {
    const paid = Number(payment?.paid_amount ?? payment?.amount ?? 0);
    const mismatch = Math.abs(paid - charge.amount) > 0.01;
    return db.UpdatePointCharge(chargeId, {
      status: mismatch ? 'review' : 'paid',
      reviewReason: mismatch ? 'amount' : null,
      mpStatus: s,
      mpPaymentId: payment?.id || null,
      paidAmount: paid,
      paidAt: new Date(),
      updatedAt: new Date(),
    }, tenantId);
  }
  if (NEEDS_REVIEW.has(s)) {
    return db.UpdatePointCharge(chargeId, { status: 'review', reviewReason: 'action_required', mpStatus: s, updatedAt: new Date() }, tenantId);
  }
  if (FAILED.has(s)) return db.UpdatePointCharge(chargeId, { status: 'failed', mpStatus: s, updatedAt: new Date() }, tenantId);
  if (s !== charge.mpStatus || charge.approvedSeenAt) {
    await db.UpdatePointCharge(chargeId, { mpStatus: s, approvedSeenAt: null, updatedAt: new Date() }, tenantId);
  }
  return { ...charge, mpStatus: s };
}

/** Cancela en la terminal. Si ya se pagó justo en ese momento, devuelve 'paid'. */
async function cancelCharge(tenantId, chargeId) {
  const charge = await db.GetPointCharge(chargeId, tenantId);
  if (!charge) throw httpError('Cobro no encontrado', 404);
  if (charge.status === 'pending') {
    try {
      await mp(tenantId, `/v1/orders/${charge.mpOrderId}/cancel`, { method: 'POST' });
    } catch {
      /* si ya no se puede cancelar, el sync de abajo dice qué pasó */
    }
  }
  return syncCharge(tenantId, chargeId);
}

/**
 * Se llama ANTES de guardar la venta. Garantiza: cobro del negocio, aprobado, con el mismo monto y usado UNA sola vez.
 * Reintentos con el mismo `saleId` son válidos.
 */
async function consumeCharge(tenantId, chargeId, { saleId, total }) {
  let charge = await db.GetPointCharge(chargeId, tenantId);
  if (!charge) throw httpError('Cobro con terminal no encontrado', 400, 'charge_not_found');
  if (charge.status === 'pending') charge = await syncCharge(tenantId, chargeId);
  if (charge.status !== 'paid') throw httpError('El cobro con terminal no está aprobado', 409, 'charge_not_paid');
  if (Math.abs(Number(total) - charge.amount) > 0.01) {
    throw httpError('El total no coincide con lo cobrado en la terminal', 409, 'amount_mismatch');
  }
  if (charge.consumedBy === String(saleId)) return charge;
  const claimed = await db.ClaimPointCharge(chargeId, tenantId, String(saleId));
  if (!claimed) throw httpError('Este cobro ya se usó en otra venta', 409, 'charge_used');
  return claimed;
}

const releaseCharge = (tenantId, chargeId, saleId) => db.ReleasePointCharge(chargeId, tenantId, String(saleId));

/** Webhook: solo refresca el cobro (la pantalla ya espera por consultas periódicas). */
async function onWebhook(mpOrderId) {
  const charge = await db.GetPointChargeByMpOrderId(String(mpOrderId));
  if (charge) await syncCharge(charge.tenantId, charge.id);
}

module.exports = {
  httpError,
  isConfigured,
  buildAuthUrl,
  handleOAuthCallback,
  listTerminals,
  registerTerminal,
  status,
  disconnect,
  verifyWebhookSignature,
  startCharge,
  syncCharge,
  cancelCharge,
  consumeCharge,
  releaseCharge,
  onWebhook,
};
