import { getDb, transaction, lastInsertId } from './db.js';

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

export function bookAppointment(data) {
  const db = getDb();
  const settings = getSettings();

  if (settings.schedule_locked) {
    throw new Error('SCHEDULE_LOCKED');
  }

  const { date, start_time, patient_name, patient_phone, patient_email, service_id } = data;

  if (!date || !start_time || !patient_name || !patient_phone) {
    throw new Error('MISSING_FIELDS');
  }

  const availability = getAvailableSlots(date);
  const slotOk = availability.slots.some((s) => s.start_time === start_time);
  if (!slotOk) {
    throw new Error('SLOT_UNAVAILABLE');
  }

  let serviceName = null;
  let endTime;
  if (service_id) {
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(service_id);
    if (service) {
      serviceName = service.name;
      endTime = minutesToTime(timeToMinutes(start_time) + (service.duration_minutes || settings.session_duration_minutes));
    }
  }
  if (!endTime) {
    endTime = minutesToTime(timeToMinutes(start_time) + settings.session_duration_minutes);
  }

  return transaction(() => {
    const taken = db.prepare(`
      SELECT id FROM appointments
      WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed')
    `).get(date, start_time);

    if (taken) throw new Error('SLOT_TAKEN');

    db.prepare(`
      INSERT INTO appointments
        (patient_name, patient_email, patient_phone, service_id, service_name, date, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
    `).run(
      patient_name.trim(),
      patient_email?.trim() || null,
      patient_phone.trim(),
      service_id || null,
      serviceName,
      date,
      start_time,
      endTime
    );

    const id = lastInsertId(db);
    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });
}
