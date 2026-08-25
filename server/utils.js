export function normalizeAttendance(value, fallback = 'presencial') {
  if (value === 'online') return 'online';
  if (value === 'presencial') return 'presencial';
  return fallback;
}

/** Retorna 'online' | 'presencial' | null (quando obrigatório e ausente/inválido). */
export function parseAttendanceType(value) {
  if (value === 'online' || value === 'presencial') return value;
  return null;
}

export function parseServiceId(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const id = Number(value);
  return Number.isFinite(id) ? id : fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

/** Extrai dígitos e normaliza para E.164 BR (55…). */
export function normalizePhoneE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('55') && digits.length >= 12) {
    // already has country code
  } else if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  } else {
    return null;
  }

  // 55 + DDD(2) + number(8 or 9)
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

export function isValidPhone(phone) {
  return Boolean(normalizePhoneE164(phone));
}

export function formatPhoneDisplay(phone) {
  const e164 = normalizePhoneE164(phone);
  if (!e164) return phone || '';
  const local = e164.slice(2);
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

export function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function withRetry(fn, { retries = 2, delayMs = 400, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      console.error(`[retry] ${label} attempt ${attempt + 1} failed:`, err.message);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
