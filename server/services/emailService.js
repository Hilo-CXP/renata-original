import nodemailer from 'nodemailer';
import { withRetry } from '../utils.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export function isEmailConfigured() {
  return Boolean(getTransporter());
}

/**
 * Envia e-mail com retry em falhas temporárias.
 * Nunca lança — retorna { sent, reason?, channel }.
 */
export async function sendEmail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) {
    console.error(
      'Email error: email_not_configured — defina SMTP_HOST, SMTP_USER e SMTP_PASS no .env'
    );
    return { sent: false, reason: 'email_not_configured', channel: 'email' };
  }
  if (!to) return { sent: false, reason: 'missing_recipient', channel: 'email' };

  try {
    await withRetry(
      () => transport.sendMail({
        from: `"Renata Batista" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
        html: html || text.replace(/\n/g, '<br>'),
      }),
      { retries: 2, delayMs: 500, label: 'email' }
    );
    console.log(`Email sent to ${to}: ${subject}`);
    return { sent: true, channel: 'email' };
  } catch (err) {
    console.error('Email error:', err.message, {
      code: err.code || null,
      responseCode: err.responseCode || null,
      command: err.command || null,
    });
    return { sent: false, reason: err.message, channel: 'email' };
  }
}
