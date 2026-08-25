import {
  getDb,
  transaction,
  lastInsertId,
  nowIso,
  buildReferenceCode,
  logAppointmentAudit,
  ensureAppointmentReference,
} from './db.js';
import { getOnlineMeetingLink } from './config/practice.js';
import {
  isValidEmail,
  isValidPhone,
  normalizePhoneE164,
  parseAttendanceType,
  parseServiceId,
} from './utils.js';

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getSettings() {
  return getDb().prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function getDayOfWeek(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).getDay();
}

export function isPastSlot(dateStr, startTime) {
  const now = new Date();
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = startTime.split(':').map(Number);
  const slotDate = new Date(y, mo - 1, d, h, mi, 0);
  return slotDate <= now;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function addDays(dateStr, days) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getAvailableSlots(dateStr) {
  const settings = getSettings();
  if (settings.schedule_locked) {
    return { locked: true, slots: [] };
  }

  const db = getDb();
  const unavailable = db.prepare('SELECT 1 FROM unavailable_dates WHERE date = ?').get(dateStr);
  if (unavailable) {
    return { locked: false, slots: [] };
  }

  const dow = getDayOfWeek(dateStr);
  const working = db.prepare(
    'SELECT * FROM working_hours WHERE day_of_week = ? AND enabled = 1'
  ).get(dow);

  if (!working) {
    return { locked: false, slots: [] };
  }

  const duration = settings.session_duration_minutes;
  const buffer = settings.buffer_minutes;
  const step = duration + buffer;

  const breaks = db.prepare(
    'SELECT start_time, end_time FROM breaks WHERE day_of_week IS NULL OR day_of_week = ?'
  ).all(dow);

  const blocked = db.prepare(
    'SELECT start_time, end_time FROM blocked_slots WHERE date = ?'
  ).all(dateStr);

  const booked = db.prepare(`
    SELECT start_time, end_time FROM appointments
    WHERE date = ? AND status IN ('pending', 'confirmed')
  `).all(dateStr);

  const busyRanges = [
    ...breaks.map((b) => ({
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time),
    })),
    ...blocked.map((b) => ({
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time || b.start_time) + duration,
    })),
    ...booked.map((b) => ({
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time),
    })),
  ];

  const dayStart = timeToMinutes(working.start_time);
  const dayEnd = timeToMinutes(working.end_time);
  const slots = [];

  for (let start = dayStart; start + duration <= dayEnd; start += step) {
    const end = start + duration;
    const startTime = minutesToTime(start);
    const endTime = minutesToTime(end);

    if (isPastSlot(dateStr, startTime)) continue;

    const conflict = busyRanges.some((r) => overlaps(start, end, r.start, r.end));
    if (!conflict) {
      slots.push({ start_time: startTime, end_time: endTime });
    }
  }

  return { locked: false, slots };
}

/**
 * Suggest next available slots after a conflict, searching forward from a date/time.
 */
export function suggestNextSlots({ fromDate, afterTime = null, limit = 5, maxDays = 21 } = {}) {
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return [];

  const suggestions = [];
  let date = fromDate;

  for (let day = 0; day < maxDays && suggestions.length < limit; day++) {
    if (day > 0) date = addDays(fromDate, day);
    const { locked, slots } = getAvailableSlots(date);
    if (locked) break;

    for (const slot of slots) {
      if (date === fromDate && afterTime && slot.start_time <= afterTime) continue;
      suggestions.push({
        date,
        start_time: slot.start_time,
        end_time: slot.end_time,
      });
      if (suggestions.length >= limit) break;
    }
  }

  return suggestions;
}

export function bookAppointment(data) {
  const db = getDb();
  const settings = getSettings();

  if (settings.schedule_locked) {
    throw Object.assign(new Error('SCHEDULE_LOCKED'), { code: 'SCHEDULE_LOCKED' });
  }

  const {
    date,
    start_time,
    patient_name,
    patient_phone,
    patient_email,
    service_id,
    attendance_type,
    meeting_link,
    notes,
    booking_ip,
  } = data;

  if (!date || !start_time || !patient_name?.trim() || !patient_phone?.trim() || !patient_email?.trim()) {
    throw Object.assign(new Error('MISSING_FIELDS'), { code: 'MISSING_FIELDS' });
  }

  const attendance = parseAttendanceType(attendance_type);
  if (!attendance) {
    throw Object.assign(new Error('INVALID_ATTENDANCE'), { code: 'INVALID_ATTENDANCE' });
  }

  if (!isValidEmail(patient_email)) {
    throw Object.assign(new Error('INVALID_EMAIL'), { code: 'INVALID_EMAIL' });
  }

  if (!isValidPhone(patient_phone)) {
    throw Object.assign(new Error('INVALID_PHONE'), { code: 'INVALID_PHONE' });
  }

  const availability = getAvailableSlots(date);
  const slotOk = availability.slots.some((s) => s.start_time === start_time);
  if (!slotOk) {
    const err = Object.assign(new Error('SLOT_UNAVAILABLE'), { code: 'SLOT_UNAVAILABLE' });
    err.suggestions = suggestNextSlots({ fromDate: date, afterTime: start_time, limit: 5 });
    throw err;
  }

  const parsedServiceId = parseServiceId(service_id);
  let serviceName = null;
  let endTime;
  if (parsedServiceId) {
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(parsedServiceId);
    if (service) {
      serviceName = service.name;
      endTime = minutesToTime(
        timeToMinutes(start_time) + (service.duration_minutes || settings.session_duration_minutes)
      );
    }
  }
  if (!endTime) {
    endTime = minutesToTime(timeToMinutes(start_time) + settings.session_duration_minutes);
  }

  const phone = normalizePhoneE164(patient_phone);
  const email = patient_email.trim().toLowerCase();
  const link = attendance === 'online'
    ? ((meeting_link && String(meeting_link).trim()) || getOnlineMeetingLink() || null)
    : null;
  const notesValue = notes?.trim() ? String(notes).trim().slice(0, 1000) : null;
  const ipValue = booking_ip ? String(booking_ip).slice(0, 64) : null;

  try {
    return transaction(() => {
      const taken = db.prepare(`
        SELECT id FROM appointments
        WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed')
      `).get(date, start_time);

      if (taken) {
        const err = Object.assign(new Error('SLOT_TAKEN'), { code: 'SLOT_TAKEN' });
        err.suggestions = suggestNextSlots({ fromDate: date, afterTime: start_time, limit: 5 });
        throw err;
      }

      db.prepare(`
        INSERT INTO appointments
          (patient_name, patient_email, patient_phone, service_id, service_name,
           date, start_time, end_time, status, attendance_type, meeting_link, notes, booking_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
      `).run(
        patient_name.trim(),
        email,
        phone,
        parsedServiceId,
        serviceName,
        date,
        start_time,
        endTime,
        attendance,
        link,
        notesValue,
        ipValue
      );

      const id = lastInsertId(db);
      const code = buildReferenceCode(id, date);
      db.prepare('UPDATE appointments SET reference_code = ? WHERE id = ?').run(code, id);

      logAppointmentAudit(db, {
        appointmentId: id,
        action: 'created',
        actor: 'public',
        details: {
          source: 'public_booking',
          date,
          start_time,
          attendance_type: attendance,
          booking_ip: ipValue,
        },
      });

      return ensureAppointmentReference(db, db.prepare('SELECT * FROM appointments WHERE id = ?').get(id));
    });
  } catch (err) {
    if (err.code === 'SLOT_TAKEN' || err.message === 'SLOT_TAKEN') {
      if (!err.suggestions) {
        err.suggestions = suggestNextSlots({ fromDate: date, afterTime: start_time, limit: 5 });
      }
    }
    // Unique index race
    if (String(err.message || '').includes('UNIQUE') || String(err.code || '').includes('CONSTRAINT')) {
      const conflict = Object.assign(new Error('SLOT_TAKEN'), { code: 'SLOT_TAKEN' });
      conflict.suggestions = suggestNextSlots({ fromDate: date, afterTime: start_time, limit: 5 });
      throw conflict;
    }
    throw err;
  }
}
