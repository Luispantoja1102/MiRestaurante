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
const { signState, readState } = require('../utils/oauth-state');
const { encrypt, decrypt } = require('../utils/token-crypto');

const MP_API = process.env.MP_API_URL || 'https://api.mercadopago.com'; // MP_API_URL solo para pruebas con un Mercado Pago simulado

function httpError(msg, status = 400, code) {
  const e = new Error(msg);
  e.status = status;
  e.code = code;
  return e;
}

/* ───────────── OAuth: conectar la cuenta de Mercado Pago del negocio ───────────── */
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
  const q = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID,
    response_type: 'code',
    platform_id: 'mp',
    state: signState(tenantId, stateSecret()),
    redirect_uri: process.env.MP_OAUTH_REDIRECT,
  });
  return `https://auth.mercadopago.com.mx/authorization?${q}`;
}

const parseState = (state) => readState(state, stateSecret());

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

const MAX_TERMINALS = 10;
// Nombre interno que el negocio le pone a cada terminal para distinguirlas (p. ej. «Barra», «Terraza»)
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
const sameName = (list, name, exceptId) => list.some((t) => t.id !== exceptId && String(t.name).toLowerCase() === name.toLowerCase());
const publicTerminal = (t) => ({ id: t.id, name: t.name, label: t.label, ok: t.ok, code: t.code, message: t.message });

/** Terminales registradas del negocio. Las conexiones de antes (una sola terminal) se leen como una lista de una. */
function terminalsOf(p) {
  if (Array.isArray(p?.terminals)) return p.terminals;
  return p?.terminalId ? [{ id: p.terminalId, label: p.terminalLabel || p.terminalId, name: p.terminalLabel || p.terminalId }] : [];
}

const saveTerminals = (tenantId, list, extra = {}) => db.SavePointConnection(tenantId, { terminals: list, terminalId: null, terminalLabel: null, ...extra });

/** Registra una terminal de la cuenta (o actualiza su nombre si ya estaba). Se pueden tener varias a la vez. */
async function registerTerminal(tenantId, terminalId, name) {
  const t = (await listTerminals(tenantId)).find((x) => x.id === terminalId);
  if (!t) throw httpError('Esa terminal no pertenece a tu cuenta de Mercado Pago', 404, 'terminal_not_found');
  const list = terminalsOf(await db.GetPointConnection(tenantId)).map((x) => ({ ...x }));
  const label = t.external_pos_id || t.id;
  const existing = list.find((x) => x.id === terminalId);
  if (!existing && list.length >= MAX_TERMINALS) throw httpError(`Puedes registrar hasta ${MAX_TERMINALS} terminales`, 400);
  const chosen = cleanName(name) || existing?.name || label;
  if (sameName(list, chosen, terminalId)) throw httpError('Ya tienes una terminal con ese nombre', 409, 'name_taken');
  await setPdvMode(tenantId, terminalId); // la terminal recibe cobros desde el sistema
  if (existing) Object.assign(existing, { label, name: chosen });
  else list.push({ id: terminalId, label, name: chosen, addedAt: new Date() });
  await saveTerminals(tenantId, list, { status: 'ready', lastError: null });
  return { terminalId, name: chosen };
}

async function renameTerminal(tenantId, terminalId, name) {
  const list = terminalsOf(await db.GetPointConnection(tenantId)).map((x) => ({ ...x }));
  const t = list.find((x) => x.id === terminalId);
  if (!t) throw httpError('Esa terminal no está registrada', 404, 'terminal_not_found');
  const chosen = cleanName(name);
  if (!chosen) throw httpError('Escribe un nombre para la terminal', 400);
  if (sameName(list, chosen, terminalId)) throw httpError('Ya tienes una terminal con ese nombre', 409, 'name_taken');
  t.name = chosen;
  await saveTerminals(tenantId, list);
  return { terminalId, name: chosen };
}

async function removeTerminal(tenantId, terminalId) {
  const list = terminalsOf(await db.GetPointConnection(tenantId));
  if (!list.some((x) => x.id === terminalId)) throw httpError('Esa terminal no está registrada', 404, 'terminal_not_found');
  await saveTerminals(tenantId, list.filter((x) => x.id !== terminalId));
}

/** ¿Cuáles de estas terminales pueden cobrar AHORA? Una sola consulta a Mercado Pago para todas. */
async function checkTerminals(tenantId, terminals) {
  let found;
  try {
    found = new Map((await listTerminals(tenantId)).map((t) => [t.id, t]));
  } catch (err) {
    return terminals.map((t) => ({ ...t, ok: false, code: err.code || 'check_failed', message: err.message }));
  }
  const out = [];
  for (const t of terminals) {
    const mine = found.get(t.id);
    if (!mine) {
      out.push({ ...t, ok: false, code: 'terminal_missing', message: `La terminal «${t.name}» ya no aparece vinculada a tu cuenta. Vuelve a elegirla.` });
      continue;
    }
    try {
      if (mine.operating_mode && mine.operating_mode !== 'PDV') await setPdvMode(tenantId, t.id);
      out.push({ ...t, ok: true, code: 'ready', message: 'Terminal lista' });
    } catch (err) {
      out.push({ ...t, ok: false, code: err.code || 'check_failed', message: err.message });
    }
  }
  return out;
}

/** ¿Se puede cobrar AHORA en esa terminal (o en la primera, si no se indica)? Devuelve { ok, code, message }. */
async function preflight(tenantId, terminalId) {
  const p = await db.GetPointConnection(tenantId);
  if (!p?.accessToken) return { ok: false, code: 'not_connected', message: 'Conecta tu cuenta de Mercado Pago para cobrar con terminal.' };
  const list = terminalsOf(p);
  if (!list.length) return { ok: false, code: 'no_terminal', message: 'Elige tu terminal de Mercado Pago para cobrar con tarjeta.' };
  const t = terminalId ? list.find((x) => x.id === terminalId) : list[0];
  if (!t) return { ok: false, code: 'terminal_not_registered', message: 'Esa terminal no está registrada.' };
  const [r] = await checkTerminals(tenantId, [t]);
  if (r.ok) await db.SavePointConnection(tenantId, { status: 'ready', lastCheckAt: new Date(), lastError: null });
  else if (r.code === 'terminal_missing') await db.SavePointConnection(tenantId, { status: 'disconnected', lastError: 'terminal_missing' });
  return { ok: r.ok, code: r.code, message: r.message };
}

/** Estado para Ajustes y para el cobro: cada terminal con su nombre y si está lista. Nunca devuelve tokens. */
async function status(tenantId) {
  const p = await db.GetPointConnection(tenantId);
  const list = terminalsOf(p);
  const base = { available: isConfigured(), connected: Boolean(p?.accessToken), terminalLabel: list[0]?.name || '', terminals: list.map(publicTerminal) };
  if (!base.available) return { ...base, ok: false, code: 'not_configured', message: 'La conexión con Mercado Pago no está configurada en el servidor.' };
  if (!list.length) {
    return { ...base, ok: false, code: p?.accessToken ? 'no_terminal' : 'not_connected', message: p?.accessToken ? 'Elige tu terminal para cobrar con tarjeta.' : 'Conecta tu cuenta de Mercado Pago.' };
  }
  const checked = await checkTerminals(tenantId, list);
  const first = checked.find((t) => t.ok) || checked[0];
  return { ...base, terminalLabel: first.name, terminals: checked.map(publicTerminal), ok: checked.some((t) => t.ok), code: first.ok ? 'ready' : first.code, message: first.ok ? 'Terminal lista' : first.message };
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
async function startCharge({ tenantId, clientSaleId, amount, terminalId: wanted }) {
  if (!clientSaleId) throw httpError('Falta clientSaleId', 400);
  const value = Number(amount).toFixed(2);
  if (!(Number(value) > 0)) throw httpError('Monto inválido', 400);

  // Con varias terminales hay que decir en cuál se cobra; con una sola no hace falta
  const list = terminalsOf(await db.GetPointConnection(tenantId));
  const chosen = wanted ? list.find((t) => t.id === String(wanted)) : list.length === 1 ? list[0] : null;
  if (list.length && !chosen) {
    throw httpError(wanted ? 'Esa terminal no está registrada.' : 'Elige en qué terminal se cobra.', 400, 'terminal_required');
  }
  const check = await preflight(tenantId, chosen?.id);
  if (!check.ok) throw httpError(check.message, 409, check.code);
  const terminalId = chosen.id;
  await assertTerminalFree(tenantId, String(clientSaleId), terminalId);

  const prev = await db.GetPointChargeBySale(clientSaleId, tenantId);
  // Si ya había un cobro pendiente de esta venta en OTRA terminal, se cancela: la venta se cobra en una sola
  if (prev && prev.status === 'pending' && prev.terminalId !== terminalId) await cancelCharge(tenantId, prev.id).catch(() => {});
  if (prev && prev.status === 'pending' && prev.terminalId === terminalId && prev.amount === Number(value)) return { id: prev.id, status: 'pending' };
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
    terminalName: chosen.name, // para saber en cuál terminal se cobró cada venta
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
  renameTerminal,
  removeTerminal,
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
