const nodemailer = require('nodemailer');

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendInviteEmail({ to, inviteUrl, role, businessName }) {
  const subject = `Invitación a MiRestaurante${businessName ? ` — ${businessName}` : ''}`;
  const html = `
    <div style="font-family:sans-serif;line-height:1.5;color:#1c1f1d">
      <h2>Te invitaron a MiRestaurante</h2>
      <p>Te invitaron a unirte${businessName ? ` a <strong>${businessName}</strong>` : ''} con el rol <strong>${role}</strong>.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 16px;background:#1F4D3A;color:#fff;text-decoration:none;border-radius:8px">Aceptar invitación</a></p>
      <p style="font-size:12px;color:#66706a">O copia este enlace:<br>${inviteUrl}</p>
    </div>
  `;

  if (!hasSmtpConfig()) {
    console.log('[mail:dev-fallback] Invite email not sent (SMTP missing). Link:', inviteUrl);
    return { sent: false, fallback: true, inviteUrl };
  }

  const transport = createTransport();
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
  return { sent: true, fallback: false, inviteUrl };
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const subject = 'Restablecer contraseña — MiRestaurante';
  const html = `
    <div style="font-family:sans-serif;line-height:1.5;color:#1c1f1d">
      <h2>Restablecer contraseña</h2>
      <p>Recibimos una solicitud para cambiar tu contraseña.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#1F4D3A;color:#fff;text-decoration:none;border-radius:8px">Elegir nueva contraseña</a></p>
      <p style="font-size:12px;color:#66706a">El enlace expira en 1 hora.<br>${resetUrl}</p>
    </div>
  `;

  if (!hasSmtpConfig()) {
    console.log('[mail:dev-fallback] Reset email not sent (SMTP missing). Link:', resetUrl);
    return { sent: false, fallback: true, resetUrl };
  }

  const transport = createTransport();
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
  return { sent: true, fallback: false, resetUrl };
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Texto del usuario dentro de un correo: escapado y con sus saltos de línea. */
const asHtmlText = (value) => escapeHtml(value).replace(/\n/g, '<br>');

/** Dónde le llegan al equipo los avisos de tickets nuevos (SUPPORT_EMAIL o, si no hay, el remitente). */
function supportInbox() {
  return String(process.env.SUPPORT_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
}

/**
 * Correo de soporte. Sin SMTP configurado no se envía y se deja en la consola (igual que las invitaciones):
 * el ticket vive en la plataforma de todos modos, el correo es solo un aviso.
 */
async function sendSupportEmail({ to, subject, heading, message, businessName }) {
  if (!to) return { sent: false, fallback: true };
  const html = `
    <div style="font-family:sans-serif;line-height:1.5;color:#1c1f1d">
      <h2>${escapeHtml(heading)}</h2>
      ${businessName ? `<p style="color:#66706a;margin:0 0 .5rem">${escapeHtml(businessName)}</p>` : ''}
      <div style="padding:12px 14px;background:#f4f5f3;border-radius:8px">${asHtmlText(message)}</div>
      <p style="font-size:12px;color:#66706a">Puedes ver y contestar este ticket desde MiRestaurante, en Soporte.</p>
    </div>
  `;
  if (!hasSmtpConfig()) {
    console.log(`[mail:dev-fallback] Correo de soporte no enviado (falta SMTP). Para ${to}: ${subject}`);
    return { sent: false, fallback: true };
  }
  await createTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
  return { sent: true, fallback: false };
}

/** Un fallo de correo nunca debe romper el ticket que lo originó. */
async function safeSupportEmail(args) {
  try {
    return await sendSupportEmail(args);
  } catch (err) {
    console.warn('[mail] no se pudo enviar el correo de soporte:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendInviteEmail, sendPasswordResetEmail, hasSmtpConfig, safeSupportEmail, supportInbox, escapeHtml };
