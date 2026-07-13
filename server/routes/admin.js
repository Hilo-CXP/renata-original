import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, nowIso, transaction, lastInsertId } from '../db.js';
import { authMiddleware, cookieOptions, signToken } from '../auth.js';
import { getAvailableSlots, getSettings, timeToMinutes, minutesToTime } from '../slotEngine.js';
import { notifyCancellation, notifyNewBooking } from '../notifications.js';
import { normalizeAttendance, parseServiceId } from '../utils.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
  }

  const user = getDb().prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = signToken({ id: user.id, username: user.username });
  res.cookie('admin_token', token, cookieOptions());
  res.json({ username: user.username });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('admin_token', { httpOnly: true, sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ username: req.admin.username });
});

router.get('/appointments', authMiddleware, (req, res) => {
  const { from, to, date, status } = req.query;
  let query = 'SELECT * FROM appointments WHERE 1=1';
  const params = [];

  if (date) {
    query += ' AND date = ?';
    params.push(date);
  }
  if (from) {
    query += ' AND date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND date <= ?';
    params.push(to);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY date ASC, start_time ASC';
  const rows = getDb().prepare(query).all(...params);
  res.json(rows);
});

router.post('/appointments', authMiddleware, async (req, res) => {
  const db = getDb();
  const settings = getSettings();
  const {
    patient_name, patient_email, patient_phone,
    service_id, date, start_time, status = 'confirmed',
    attendance_type,
  } = req.body;

  const parsedServiceId = parseServiceId(service_id);
  const parsedAttendance = normalizeAttendance(attendance_type);

  if (!patient_name || !patient_phone || !date || !start_time) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  let serviceName = null;
  let duration = settings.session_duration_minutes;
  if (parsedServiceId) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(parsedServiceId);
    if (svc) {
      serviceName = svc.name;
      duration = svc.duration_minutes || duration;
    }
  }
  const endTime = minutesToTime(timeToMinutes(start_time) + duration);

  try {
    const appointment = transaction(() => {
      const taken = db.prepare(`
        SELECT id FROM appointments
        WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed')
      `).get(date, start_time);
      if (taken) throw new Error('SLOT_TAKEN');

      db.prepare(`
        INSERT INTO appointments
          (patient_name, patient_email, patient_phone, service_id, service_name, date, start_time, end_time, status, attendance_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patient_name.trim(), patient_email?.trim() || null, patient_phone.trim(),
        parsedServiceId, serviceName, date, start_time, endTime, status,
        parsedAttendance
      );
      const newId = lastInsertId(db);
      return db.prepare('SELECT * FROM appointments WHERE id = ?').get(newId);
    });

    if (settings.notify_email && status === 'confirmed') {
      await notifyNewBooking(appointment, settings.notify_email);
    }
    res.status(201).json(appointment);
  } catch (err) {
    if (err.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'Horário já ocupado' });
    }
    throw err;
  }
});

router.put('/appointments/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const settings = getSettings();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });

  const {
    patient_name, patient_email, patient_phone,
    service_id, date, start_time, status, attendance_type,
  } = req.body;

  const newDate = date || existing.date;
  const newStart = start_time || existing.start_time;
  let duration = settings.session_duration_minutes;
  let serviceName = existing.service_name;

  const parsedServiceId = service_id !== undefined
    ? parseServiceId(service_id)
    : existing.service_id;

  if (parsedServiceId) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(parsedServiceId);
    if (svc) {
      serviceName = svc.name;
      duration = svc.duration_minutes || duration;
    }
  } else if (service_id !== undefined) {
    serviceName = null;
  }

  const endTime = minutesToTime(timeToMinutes(newStart) + duration);
  const newStatus = status || existing.status;
  const newAttendance = attendance_type !== undefined
    ? normalizeAttendance(attendance_type)
    : normalizeAttendance(existing.attendance_type);

  try {
    const updated = transaction(() => {
      if (newDate !== existing.date || newStart !== existing.start_time) {
        const taken = db.prepare(`
          SELECT id FROM appointments
          WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed') AND id != ?
        `).get(newDate, newStart, id);
        if (taken) throw new Error('SLOT_TAKEN');
      }

      db.prepare(`
        UPDATE appointments SET
          patient_name = ?, patient_email = ?, patient_phone = ?,
          service_id = ?, service_name = ?, date = ?, start_time = ?, end_time = ?,
          status = ?, attendance_type = ?, updated_at = ?
        WHERE id = ?
      `).run(
        patient_name ?? existing.patient_name,
        patient_email !== undefined ? (patient_email || null) : existing.patient_email,
        patient_phone ?? existing.patient_phone,
        parsedServiceId,
        serviceName,
        newDate, newStart, endTime, newStatus,
        newAttendance,
        nowIso(), id
      );
      return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    });

    res.json(updated);
  } catch (err) {
    if (err.message === 'SLOT_TAKEN') {
      return res.status(409).json({ error: 'Horário já ocupado' });
    }
    throw err;
  }
});

router.post('/appointments/:id/cancel', authMiddleware, async (req, res) => {
  const db = getDb();
  const settings = getSettings();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });
  if (existing.status === 'cancelled') {
    return res.json(existing);
  }

  db.prepare(`
    UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?
  `).run(nowIso(), id);

  const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);

  if (settings.notify_email) {
    await notifyCancellation(existing, settings.notify_email);
  }
  res.json(updated);
});

router.delete('/appointments/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });

  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  res.json({ ok: true, deleted: true });
});

router.get('/settings', authMiddleware, (_req, res) => {
  const settings = getSettings();
  res.json(settings);
});

router.put('/settings', authMiddleware, (req, res) => {
  const { session_duration_minutes, buffer_minutes, notify_email } = req.body;
  getDb().prepare(`
    UPDATE settings SET
      session_duration_minutes = COALESCE(?, session_duration_minutes),
      buffer_minutes = COALESCE(?, buffer_minutes),
      notify_email = COALESCE(?, notify_email),
      updated_at = ?
    WHERE id = 1
  `).run(session_duration_minutes, buffer_minutes, notify_email, nowIso());
  res.json(getSettings());
});

router.post('/schedule/lock', authMiddleware, (_req, res) => {
  getDb().prepare('UPDATE settings SET schedule_locked = 1, updated_at = ? WHERE id = 1').run(nowIso());
  res.json({ schedule_locked: true });
});

router.post('/schedule/unlock', authMiddleware, (_req, res) => {
  getDb().prepare('UPDATE settings SET schedule_locked = 0, updated_at = ? WHERE id = 1').run(nowIso());
  res.json({ schedule_locked: false });
});

router.get('/working-hours', authMiddleware, (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM working_hours ORDER BY day_of_week').all();
  res.json(rows);
});

router.put('/working-hours', authMiddleware, (req, res) => {
  const { hours } = req.body;
  if (!Array.isArray(hours)) return res.status(400).json({ error: 'Formato inválido' });

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO working_hours (day_of_week, start_time, end_time, enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(day_of_week) DO UPDATE SET
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      enabled = excluded.enabled
  `);
  transaction(() => {
    hours.forEach((h) => upsert.run(h.day_of_week, h.start_time, h.end_time, h.enabled ? 1 : 0));
  });
  res.json(db.prepare('SELECT * FROM working_hours ORDER BY day_of_week').all());
});

router.get('/breaks', authMiddleware, (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM breaks ORDER BY day_of_week, start_time').all());
});

router.post('/breaks', authMiddleware, (req, res) => {
  const { day_of_week, start_time, end_time } = req.body;
  const r = getDb().prepare(`
    INSERT INTO breaks (day_of_week, start_time, end_time) VALUES (?, ?, ?)
  `).run(day_of_week ?? null, start_time, end_time);
  const db = getDb();
  res.status(201).json(db.prepare('SELECT * FROM breaks WHERE id = ?').get(lastInsertId(db)));
});

router.delete('/breaks/:id', authMiddleware, (req, res) => {
  getDb().prepare('DELETE FROM breaks WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/unavailable-dates', authMiddleware, (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM unavailable_dates ORDER BY date').all());
});

router.post('/unavailable-dates', authMiddleware, (req, res) => {
  const { date, reason } = req.body;
  try {
    const db = getDb();
    const r = db.prepare('INSERT INTO unavailable_dates (date, reason) VALUES (?, ?)').run(date, reason || null);
    res.status(201).json(db.prepare('SELECT * FROM unavailable_dates WHERE id = ?').get(lastInsertId(db)));
  } catch {
    res.status(409).json({ error: 'Data já bloqueada' });
  }
});

router.delete('/unavailable-dates/:id', authMiddleware, (req, res) => {
  getDb().prepare('DELETE FROM unavailable_dates WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/blocked-slots', authMiddleware, (req, res) => {
  const { date } = req.query;
  if (date) {
    return res.json(getDb().prepare('SELECT * FROM blocked_slots WHERE date = ? ORDER BY start_time').all(date));
  }
  res.json(getDb().prepare('SELECT * FROM blocked_slots ORDER BY date, start_time').all());
});

router.post('/blocked-slots', authMiddleware, (req, res) => {
  const { date, start_time, end_time, reason } = req.body;
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO blocked_slots (date, start_time, end_time, reason) VALUES (?, ?, ?, ?)
    `).run(date, start_time, end_time || null, reason || null);
    res.status(201).json(db.prepare('SELECT * FROM blocked_slots WHERE id = ?').get(lastInsertId(db)));
  } catch {
    res.status(409).json({ error: 'Horário já bloqueado' });
  }
});

router.delete('/blocked-slots/:id', authMiddleware, (req, res) => {
  getDb().prepare('DELETE FROM blocked_slots WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/slots', authMiddleware, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Informe a data' });
  res.json(getAvailableSlots(date));
});

router.get('/waiting-list', authMiddleware, (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM waiting_list ORDER BY created_at DESC').all());
});

router.put('/waiting-list/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const { status, name, email, phone, preferred_day, preferred_time, note } = req.body;
  const existing = getDb().prepare('SELECT * FROM waiting_list WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

  getDb().prepare(`
    UPDATE waiting_list SET
      status = COALESCE(?, status),
      name = COALESCE(?, name),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      preferred_day = COALESCE(?, preferred_day),
      preferred_time = COALESCE(?, preferred_time),
      note = COALESCE(?, note),
      updated_at = ?
    WHERE id = ?
  `).run(status, name, email, phone, preferred_day, preferred_time, note, nowIso(), id);

  res.json(getDb().prepare('SELECT * FROM waiting_list WHERE id = ?').get(id));
});

router.get('/services', authMiddleware, (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM services ORDER BY sort_order').all());
});

export default router;
