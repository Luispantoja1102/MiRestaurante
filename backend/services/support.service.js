/**
 * Soporte: tickets entre los negocios y el equipo de la plataforma.
 *
 * Un ticket es una conversación (asunto + mensajes). Estados:
 *  - open      espera respuesta del equipo (el negocio escribió)
 *  - answered  espera al negocio (el equipo respondió)
 *  - closed    cerrado por el equipo; si el negocio vuelve a escribir, se reabre
 * Todo vive en la plataforma. El correo (si hay SMTP) es solo un aviso para el otro lado.
 */
const { ObjectId } = require('mongodb');
const db = require('../database/mongodb');
const { safeSupportEmail, supportInbox } = require('../utils/mail.utils');

class SupportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STATUSES = ['open', 'answered', 'closed'];
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const fullName = (u) => `${u?.name || ''} ${u?.lastName || ''}`.trim() || u?.username || '';
const preview = (text, max = 160) => (String(text).length > max ? `${String(text).slice(0, max)}…` : String(text));

function checkSubject(subject) {
  const text = clean(subject, 120);
  if (text.length < 3) throw new SupportError(400, 'Escribe un asunto.');
  return text;
}
function checkMessage(message, min = 2) {
  const text = clean(message, 4000);
  if (text.length < min) throw new SupportError(400, 'Escribe el mensaje.');
  return text;
}

const newMessage = ({ direction, user, text }) => ({
  id: String(new ObjectId()),
  direction, // in: del negocio · out: del equipo
  author: fullName(user),
  username: user?.username || '',
  text,
  at: new Date(),
});

async function requireTicket(id) {
  const ticket = await db.GetSupportTicket(id);
  if (!ticket) throw new SupportError(404, 'No encontré ese ticket.');
  return ticket;
}

/** Un ticket del negocio, nunca de otro. */
async function requireTenantTicket(tenantId, id) {
  const ticket = await requireTicket(id);
  if (ticket.tenantId !== String(tenantId)) throw new SupportError(404, 'No encontré ese ticket.');
  return ticket;
}

async function businessNameOf(tenantId) {
  const [tenant, settings] = await Promise.all([db.GetTenantById(tenantId), db.GetSettings(tenantId)]);
  return settings?.businessName || tenant?.name || 'Negocio';
}

/** Lo que ve el negocio y la plataforma de un ticket. */
const view = (t) => ({
  id: t.id,
  tenantId: t.tenantId,
  subject: t.subject,
  status: t.status,
  requester: t.requester || null,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  messages: (t.messages || []).map((m) => ({ id: m.id, direction: m.direction, author: m.author, text: m.text, at: m.at })),
});

// ───────── Lado del negocio ─────────
async function listForTenant(tenantId) {
  return (await db.ListSupportTickets({ tenantId })).map(view);
}

async function getForTenant(tenantId, id) {
  return view(await requireTenantTicket(tenantId, id));
}

/** El negocio abre un ticket. `user` es quien escribe (el admin del negocio). */
async function openByClient({ tenantId, user, subject, message }) {
  const title = checkSubject(subject);
  const body = checkMessage(message, 8);
  const first = newMessage({ direction: 'in', user, text: body });
  const now = first.at;
  const ticket = await db.CreateSupportTicket({
    tenantId: String(tenantId),
    subject: title,
    status: 'open',
    requester: { username: user?.username || '', name: fullName(user), email: String(user?.email || '').toLowerCase() },
    messages: [first],
    createdAt: now,
    updatedAt: now,
  });
  const businessName = await businessNameOf(tenantId);
  // Avisos: al equipo (nuevo ticket) y al negocio (acuse de recibo)
  await safeSupportEmail({ to: supportInbox(), subject: `Ticket nuevo: ${title}`, heading: 'Ticket nuevo de un cliente', businessName, message: body });
  await safeSupportEmail({ to: user?.email, subject: `Recibimos tu mensaje: ${title}`, heading: 'Recibimos tu mensaje', message: body });
  return view(ticket);
}

async function replyByClient({ tenantId, user, id, message }) {
  const ticket = await requireTenantTicket(tenantId, id);
  const body = checkMessage(message);
  // Cualquier mensaje del negocio vuelve a poner el ticket en espera del equipo, aunque estuviera cerrado
  const updated = await db.AppendSupportMessage(ticket.id, newMessage({ direction: 'in', user, text: body }), { status: 'open' });
  await safeSupportEmail({
    to: supportInbox(),
    subject: `Respuesta del cliente: ${ticket.subject}`,
    heading: 'El cliente respondió',
    businessName: await businessNameOf(tenantId),
    message: body,
  });
  return view(updated);
}

// ───────── Lado del equipo ─────────
/** Bandeja: todos los tickets, los que esperan respuesta primero (los más viejos arriba: llevan más esperando). */
async function board({ status = 'all', q = '', limit = 200 } = {}) {
  const all = await db.ListSupportTickets({});
  const tenantIds = [...new Set(all.map((t) => t.tenantId))];
  const [tenants, settings] = await Promise.all([db.ListTenants(), db.GetSettingsMany(tenantIds)]);
  const byId = new Map(tenants.map((t) => [String(t.id), t]));
  const nameOf = (id) => settings.get(id)?.businessName || byId.get(id)?.name || 'Cliente';

  const items = all.map((t) => {
    const last = t.messages[t.messages.length - 1];
    const lastIn = [...t.messages].reverse().find((m) => m.direction === 'in') || last;
    return {
      id: t.id,
      tenantId: t.tenantId,
      businessName: nameOf(t.tenantId),
      subject: t.subject,
      status: t.status,
      from: t.requester?.name || t.requester?.username || '',
      preview: preview(lastIn?.text || ''),
      lastFrom: last?.direction === 'out' ? 'Equipo' : t.requester?.name || 'Cliente',
      messageCount: t.messages.length,
      updatedAt: t.updatedAt,
    };
  });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]));

  const needle = clean(q, 100).toLowerCase();
  let list = items;
  if (STATUSES.includes(status)) list = list.filter((i) => i.status === status);
  if (needle) list = list.filter((i) => [i.businessName, i.subject, i.from, i.preview].some((v) => String(v || '').toLowerCase().includes(needle)));
  list.sort((a, b) => {
    if (a.status !== b.status) return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
    const [da, dbb] = [new Date(a.updatedAt || 0), new Date(b.updatedAt || 0)];
    return a.status === 'open' ? da - dbb : dbb - da;
  });
  return { items: list.slice(0, Math.min(500, Math.max(1, Number(limit) || 200))), counts };
}

/** Cuántos tickets esperan al equipo, por negocio (para avisarlo en la lista de clientes). */
async function waitingByTenant() {
  const open = await db.ListSupportTickets({ status: 'open' });
  const map = new Map();
  for (const t of open) map.set(t.tenantId, (map.get(t.tenantId) || 0) + 1);
  return { map, open };
}

async function listForStaff(tenantId) {
  return (await db.ListSupportTickets({ tenantId })).map(view);
}

async function getForStaff(id) {
  return view(await requireTicket(id));
}

/** El equipo abre un ticket hacia el dueño del negocio (primer mensaje del equipo). */
async function openByStaff({ tenant, user, subject, message }) {
  const title = checkSubject(subject);
  const body = checkMessage(message);
  const users = (await db.ListUsersByTenants([tenant.id])).get(String(tenant.id)) || [];
  const owner = users.find((u) => u.role === 'admin') || users[0] || null;
  const first = newMessage({ direction: 'out', user, text: body });
  const ticket = await db.CreateSupportTicket({
    tenantId: String(tenant.id),
    subject: title,
    status: 'answered',
    requester: owner ? { username: owner.username || '', name: fullName(owner), email: String(owner.email || '').toLowerCase() } : null,
    messages: [first],
    createdAt: first.at,
    updatedAt: first.at,
  });
  await safeSupportEmail({ to: owner?.email, subject: title, heading: 'Mensaje de MiRestaurante', businessName: await businessNameOf(tenant.id), message: body });
  return view(ticket);
}

async function replyByStaff({ id, user, message }) {
  const ticket = await requireTicket(id);
  const body = checkMessage(message);
  const updated = await db.AppendSupportMessage(ticket.id, newMessage({ direction: 'out', user, text: body }), { status: 'answered' });
  await safeSupportEmail({
    to: ticket.requester?.email,
    subject: `Re: ${ticket.subject}`,
    heading: 'Respuesta de MiRestaurante',
    businessName: await businessNameOf(ticket.tenantId),
    message: body,
  });
  return { ticket: view(updated), tenantId: ticket.tenantId, subject: ticket.subject };
}

async function setClosed(id, closed) {
  const ticket = await requireTicket(id);
  if (closed && ticket.status === 'closed') return { ticket: view(ticket), tenantId: ticket.tenantId, subject: ticket.subject };
  // Reabrir: vuelve a donde estaba la conversación (si lo último fue del negocio espera al equipo)
  const last = ticket.messages[ticket.messages.length - 1];
  const status = closed ? 'closed' : last?.direction === 'in' ? 'open' : 'answered';
  const updated = await db.UpdateSupportTicket(ticket.id, { status });
  return { ticket: view(updated), tenantId: ticket.tenantId, subject: ticket.subject };
}

module.exports = {
  SupportError,
  listForTenant, getForTenant, openByClient, replyByClient,
  board, waitingByTenant, listForStaff, getForStaff, openByStaff, replyByStaff, setClosed,
};
