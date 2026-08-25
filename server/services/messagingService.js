import { withRetry } from '../utils.js';

function isWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_WEBHOOK_URL);
}

function isSmsConfigured() {
  const hasWebhook = Boolean(process.env.SMS_WEBHOOK_URL);
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_PHONE_NUMBER
  );
  return hasWebhook || hasTwilio;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return res;
}

/**
 * Envia WhatsApp para um número E.164 (sem +), via webhook configurável
 * (Evolution API, Twilio adapter, Meta Cloud API proxy, etc.).
 */
export async function sendWhatsApp(toE164, message) {
  const url = process.env.WHATSAPP_WEBHOOK_URL;
  if (!url) return { sent: false, reason: 'whatsapp_not_configured', channel: 'whatsapp' };
  if (!toE164 || !message) return { sent: false, reason: 'missing_recipient', channel: 'whatsapp' };

  try {
    await withRetry(
      () => postJson(url, { number: toE164, message }),
      { retries: 2, delayMs: 500, label: 'whatsapp' }
    );
    return { sent: true, channel: 'whatsapp' };
  } catch (err) {
    console.error('WhatsApp error:', err.message);
    return { sent: false, reason: err.message, channel: 'whatsapp' };
  }
}

async function sendSmsViaTwilio(toE164, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: `+${toE164}`,
    From: from,
    Body: message,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Twilio HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}

async function sendSmsViaWebhook(toE164, message) {
  await postJson(process.env.SMS_WEBHOOK_URL, { number: toE164, message });
}

export async function sendSms(toE164, message) {
  if (!toE164 || !message) return { sent: false, reason: 'missing_recipient', channel: 'sms' };

  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_PHONE_NUMBER
  );
  const hasWebhook = Boolean(process.env.SMS_WEBHOOK_URL);

  if (!hasTwilio && !hasWebhook) {
    return { sent: false, reason: 'sms_not_configured', channel: 'sms' };
  }

  try {
    await withRetry(
      async () => {
        if (hasTwilio) await sendSmsViaTwilio(toE164, message);
        else await sendSmsViaWebhook(toE164, message);
      },
      { retries: 2, delayMs: 500, label: 'sms' }
    );
    return { sent: true, channel: 'sms' };
  } catch (err) {
    console.error('SMS error:', err.message);
    return { sent: false, reason: err.message, channel: 'sms' };
  }
}

/**
 * Preferência: WhatsApp → SMS.
 * Retorna o resultado do canal que enviou (ou do último tentativa).
 */
export async function sendMobileMessage(toE164, message) {
  if (isWhatsAppConfigured()) {
    const wa = await sendWhatsApp(toE164, message);
    if (wa.sent) return wa;
    console.error('WhatsApp unavailable, trying SMS fallback:', wa.reason);
  }

  if (isSmsConfigured()) {
    return sendSms(toE164, message);
  }

  return {
    sent: false,
    reason: isWhatsAppConfigured() ? 'whatsapp_failed_no_sms' : 'mobile_not_configured',
    channel: 'none',
  };
}

export { isWhatsAppConfigured, isSmsConfigured };
