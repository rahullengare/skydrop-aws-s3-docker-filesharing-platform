const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendPasswordResetEmail(to, name, link) {
  const mailer = getTransporter();

  if (!mailer) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] SMTP not configured. Password reset link for ${to}:\n${link}`);
    } else {
      console.warn('SMTP is not configured: password reset email was not sent.');
    }
    return;
  }

  const safeName = escapeHtml(name);
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your SkyDrop password',
    text:
      `Hi ${name},\n\n` +
      `Use this link to choose a new password. It works once and expires in 30 minutes:\n${link}\n\n` +
      `If you did not ask for this, ignore this email. Your password stays the same.`,
    html:
      `<div style="font-family:Calibri,Arial,sans-serif;font-size:16px;color:#0f172a;max-width:480px">` +
      `<p>Hi ${safeName},</p>` +
      `<p>Use the button below to choose a new password. The link works once and expires in 30 minutes.</p>` +
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;` +
      `padding:12px 20px;border-radius:8px;font-weight:bold">Reset password</a></p>` +
      `<p style="color:#475569">If you did not ask for this, ignore this email. Your password stays the same.</p>` +
      `</div>`,
  });
}

module.exports = { sendPasswordResetEmail };
