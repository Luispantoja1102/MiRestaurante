const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { loadApp, startServer } = require('./helpers');
const mail = require('../utils/mail.utils');

// ——— Correo ———
test('el texto del usuario se escapa antes de ir en un correo', () => {
  assert.equal(mail.escapeHtml('<script>alert("x")</script> & más'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; más');
  assert.equal(mail.escapeHtml(null), '');
});

test('sin SMTP el correo de soporte no se envía ni rompe nada', async () => {
  const saved = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  try {
    const r = await mail.safeSupportEmail({ to: 'a@b.com', subject: 's', heading: 'h', message: 'm' });
    assert.equal(r.sent, false);
    assert.equal((await mail.safeSupportEmail({ to: '', subject: 's', heading: 'h', message: 'm' })).sent, false);
  } finally {
    Object.assign(process.env, Object.fromEntries(Object.entries({ SMTP_HOST: saved.host, SMTP_USER: saved.user, SMTP_PASS: saved.pass }).filter(([, v]) => v !== undefined)));
  }
});

// ——— Rutas ———
const { app, state, tokenFor } = loadApp();
let api;
test.before(async () => { api = await startServer(app); });
test.after(async () => { await api.close(); });

const user = (over) => ({ _id: new ObjectId(), name: 'N', lastName: 'L', password: 'x', cellphone: '5555555555', ...over });
state.users.push(
  user({ name: 'Ana', lastName: 'Dueña', username: 'ana', email: 'ana@t1.com', role: 'admin', tenantId: 't1' }),
  user({ name: 'Cajero', lastName: 'Uno', username: 'caja', email: 'caja@t1.com', role: 'cashier', tenantId: 't1' }),
  user({ name: 'Beto', lastName: 'Dueño', username: 'beto', email: 'beto@t2.com', role: 'admin', tenantId: 't2' }),
  user({ name: 'Raúl', lastName: 'Admin', username: 'root', email: 'root@p.com', role: 'platform_admin', tenantId: null }),
  user({ name: 'Sofía', lastName: 'Soporte', username: 'ayuda', email: 'ayuda@p.com', role: 'platform_support', tenantId: null }),
);
state.settings.t1 = { tenantId: 't1', businessName: 'Cafe Uno' };
const ana = () => tokenFor('ana', 'admin', 't1');
const beto = () => tokenFor('beto', 'admin', 't2');
const root = () => tokenFor('root', 'platform_admin', null);
const ayuda = () => tokenFor('ayuda', 'platform_support', null);
const call = (method, url, token, body) => api.call(method, url, { token, body });

let t1ticket;

test('solo el administrador del negocio abre tickets, y valida lo que escribe', async () => {
  const body = { subject: 'No imprime la cuenta', message: 'Desde ayer la impresora no responde.' };
  assert.equal((await call('POST', '/support/tickets', undefined, body)).status, 401);
  assert.equal((await call('POST', '/support/tickets', tokenFor('caja', 'cashier', 't1'), body)).status, 403);
  assert.equal((await call('POST', '/support/tickets', root(), body)).status, 403, 'la plataforma no abre tickets como cliente');
  assert.equal((await call('POST', '/support/tickets', ana(), { ...body, subject: 'ab' })).status, 400);
  assert.equal((await call('POST', '/support/tickets', ana(), { ...body, message: 'corto' })).status, 400);

  const r = await call('POST', '/support/tickets', ana(), body);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'open');
  assert.equal(r.json.messages.length, 1);
  assert.equal(r.json.messages[0].direction, 'in');
  assert.equal(r.json.messages[0].author, 'Ana Dueña');
  assert.equal(r.json.tenantId, 't1');
  t1ticket = r.json;
});

test('un negocio suspendido también puede pedir ayuda', async () => {
  state.tenants.find((t) => t.id === 't2').billingStatus = 'suspended';
  const r = await call('POST', '/support/tickets', beto(), { subject: 'Me suspendieron', message: 'No sé por qué está suspendida mi cuenta.' });
  assert.equal(r.status, 201, r.text);
  state.tenants.find((t) => t.id === 't2').billingStatus = 'active';
});

test('cada negocio ve y escribe solo en sus propios tickets', async () => {
  const mine = await call('GET', '/support/tickets', ana());
  assert.deepEqual(mine.json.map((t) => t.tenantId), ['t1']);
  assert.equal((await call('GET', `/support/tickets/${t1ticket.id}`, ana())).status, 200);
  assert.equal((await call('GET', `/support/tickets/${t1ticket.id}`, beto())).status, 404);
  assert.equal((await call('POST', `/support/tickets/${t1ticket.id}/messages`, beto(), { message: 'intento ajeno' })).status, 404);
  assert.equal((await call('GET', '/support/tickets/no-existe', ana())).status, 404);
});

test('el equipo (admin y soporte) ve la bandeja; un negocio no', async () => {
  assert.equal((await call('GET', '/platform/support', ana())).status, 403);
  assert.equal((await call('GET', '/platform/support')).status, 401);
  for (const token of [root(), ayuda()]) {
    const r = await call('GET', '/platform/support', token);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.counts.open, 2);
    assert.equal(r.json.items.length, 2);
  }
  const board = (await call('GET', '/platform/support', ayuda())).json;
  const row = board.items.find((i) => i.tenantId === 't1');
  assert.equal(row.businessName, 'Cafe Uno');
  assert.equal(row.subject, 'No imprime la cuenta');
  assert.match(row.preview, /impresora/);
  assert.equal(row.from, 'Ana Dueña');
});

test('la bandeja filtra por estado y busca', async () => {
  const get = async (qs) => (await call('GET', `/platform/support${qs}`, root())).json;
  assert.equal((await get('?status=open')).items.length, 2);
  assert.equal((await get('?status=answered')).items.length, 0);
  assert.equal((await get('?q=impresora')).items.length, 1);
  assert.equal((await get('?q=cafe uno')).items.length, 1);
  assert.equal((await get('?q=nada-coincide')).items.length, 0);
});

test('el equipo responde: el ticket pasa a respondido, queda en la bitácora y el negocio lo ve', async () => {
  assert.equal((await call('POST', `/platform/tickets/${t1ticket.id}/reply`, ana(), { message: 'hola' })).status, 403);
  assert.equal((await call('POST', `/platform/tickets/${t1ticket.id}/reply`, ayuda(), { message: 'x' })).status, 400);
  assert.equal((await call('POST', '/platform/tickets/no-existe/reply', ayuda(), { message: 'Hola, revisamos' })).status, 404);

  const r = await call('POST', `/platform/tickets/${t1ticket.id}/reply`, ayuda(), { message: 'Hola Ana, ¿puedes decirnos el modelo de la impresora?' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'answered');
  assert.equal(r.json.messages.length, 2);
  assert.equal(r.json.messages[1].direction, 'out');
  assert.equal(r.json.messages[1].author, 'Sofía Soporte');

  const seen = await call('GET', `/support/tickets/${t1ticket.id}`, ana());
  assert.equal(seen.json.messages[1].text, 'Hola Ana, ¿puedes decirnos el modelo de la impresora?');
  assert.ok(state.audit.some((a) => a.type === 'ticket_replied' && a.tenantId === 't1' && a.actor === 'ayuda'));

  const board = (await call('GET', '/platform/support?status=answered', root())).json;
  assert.equal(board.items.length, 1);
  assert.equal(board.counts.answered, 1);
});

test('cuando el negocio contesta, el ticket vuelve a esperar al equipo', async () => {
  const r = await call('POST', `/support/tickets/${t1ticket.id}/messages`, ana(), { message: 'Es una Epson TM-T20.' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'open');
  assert.equal(r.json.messages.length, 3);
  assert.equal((await call('POST', `/support/tickets/${t1ticket.id}/messages`, ana(), { message: 'x' })).status, 400);
});

test('cerrar, reabrir y que un mensaje del negocio reabra un ticket cerrado', async () => {
  const closed = await call('POST', `/platform/tickets/${t1ticket.id}/close`, ayuda());
  assert.equal(closed.status, 200);
  assert.equal(closed.json.status, 'closed');
  assert.equal((await call('POST', `/platform/tickets/${t1ticket.id}/close`, ayuda())).json.status, 'closed', 'cerrar dos veces no rompe');
  assert.equal((await call('GET', '/platform/support', root())).json.counts.closed, 1);

  // lo último fue del negocio: al reabrir espera al equipo
  assert.equal((await call('POST', `/platform/tickets/${t1ticket.id}/reopen`, ayuda())).json.status, 'open');
  // lo último fue del equipo: al reabrir queda respondido
  await call('POST', `/platform/tickets/${t1ticket.id}/reply`, ayuda(), { message: 'Listo, ya está resuelto.' });
  await call('POST', `/platform/tickets/${t1ticket.id}/close`, ayuda());
  assert.equal((await call('POST', `/platform/tickets/${t1ticket.id}/reopen`, ayuda())).json.status, 'answered');

  await call('POST', `/platform/tickets/${t1ticket.id}/close`, ayuda());
  const again = await call('POST', `/support/tickets/${t1ticket.id}/messages`, ana(), { message: 'Volvió a fallar.' });
  assert.equal(again.json.status, 'open', 'un mensaje del negocio reabre el ticket cerrado');
});

test('el equipo abre un ticket hacia el dueño del negocio', async () => {
  assert.equal((await call('POST', '/platform/tenants/t1/tickets', ana(), { subject: 'x', message: 'y' })).status, 403);
  assert.equal((await call('POST', '/platform/tenants/nope/tickets', ayuda(), { subject: 'Bienvenida', message: 'Hola' })).status, 404);
  assert.equal((await call('POST', '/platform/tenants/t1/tickets', ayuda(), { subject: 'ab', message: 'Hola' })).status, 400);

  const r = await call('POST', '/platform/tenants/t1/tickets', ayuda(), { subject: 'Tu prueba termina pronto', message: 'Hola, ¿te ayudamos a configurar todo?' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'answered');
  assert.equal(r.json.messages[0].direction, 'out');
  assert.equal(r.json.requester.email, 'ana@t1.com', 'va dirigido al dueño del negocio');
  const mine = (await call('GET', '/support/tickets', ana())).json;
  assert.ok(mine.some((t) => t.subject === 'Tu prueba termina pronto'));
  const staffView = (await call('GET', '/platform/tenants/t1/tickets', ayuda())).json;
  assert.equal(staffView.length, 2);
  assert.equal((await call('GET', '/platform/tenants/t1/tickets', ana())).status, 403);
});

test('el resumen y la lista de clientes avisan de los tickets que esperan', async () => {
  // t2 tiene su ticket abierto de "me suspendieron"
  const clients = (await call('GET', '/platform/tenants', ayuda())).json;
  assert.equal(clients.find((c) => c.id === 't2').waiting, 1);
  assert.equal(clients.find((c) => c.id === 't1').waiting, 1, 'el que reabrió el negocio');

  const overview = (await call('GET', '/platform/overview', root())).json;
  assert.equal(overview.tickets.open, 2);
  assert.ok(overview.waiting.some((w) => w.subject === 'Me suspendieron' && w.tenantId === 't2'));
  assert.equal((await call('GET', '/platform/overview', ayuda())).status, 403, 'el resumen sigue siendo del admin');
});

test('un ticket traído por id lo puede abrir el equipo, no un negocio', async () => {
  assert.equal((await call('GET', `/platform/tickets/${t1ticket.id}`, ayuda())).status, 200);
  assert.equal((await call('GET', `/platform/tickets/${t1ticket.id}`, beto())).status, 403);
});
