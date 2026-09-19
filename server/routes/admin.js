import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  getDb,
  nowIso,
  transaction,
  lastInsertId,
  buildReferenceCode,
  logAppointmentAudit,
  ensureAppointmentReference,
} from '../db.js';
import { authMiddleware, cookieOptions, signToken } from '../auth.js';
import {
  getAvailableSlots,
  getSettings,
  timeToMinutes,
  minutesToTime,
  suggestNextSlots,
} from '../slotEngine.js';
import {
  notifyCancellation,
  notifyNewBooking,
  sendClientConfirmations,
  sendClientReminder,
} from '../notifications.js';
import { normalizeAttendance, parseServiceId } from '../utils.js';
import { subscribe, appointmentChanged } from '../events.js';
import { getOnlineMeetingLink } from '../config/practice.js';

const router = Router();

const VALID_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'rescheduled']);

function actorFrom(req) {
  return {
    actor: req.admin?.username || 'admin',
    actorId: req.admin?.id || null,
  };
}

function conflictPayload(date, startTime, message = 'Horário já ocupado') {
  const suggestions = suggestNextSlots({ fromDate: date, afterTime: startTime, limit: 5 });
  return { error: message, code: 'SLOT_TAKEN', ...(suggestions.length ? { suggestions } : {}) };
}

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

/** Live calendar sync via Server-Sent Events */
router.get('/events', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, at: nowIso() })}\n\n`);

  const unsubscribe = subscribe((message) => {
    res.write(`id: ${message.id}\nevent: ${message.event}\ndata: ${JSON.stringify(message)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/appointments', authMiddleware, (req, res) => {
  const { from, to, date, status, q } = req.query;
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
  if (q?.trim()) {
    query += ' AND (patient_name LIKE ? OR patient_email LIKE ? OR patient_phone LIKE ? OR reference_code LIKE ?)';
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }

  query += ' ORDER BY date ASC, start_time ASC';
  const rows = getDb().prepare(query).all(...params);
  res.json(rows);
});

router.get('/appointments/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const appt = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return res.status(404).json({ error: 'Consulta não encontrada' });

  const audit = getDb().prepare(`
    SELECT * FROM appointment_audit
    WHERE appointment_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(id);

  res.json({ ...appt, audit });
});

router.post('/appointments', authMiddleware, async (req, res) => {
  const db = getDb();
  const settings = getSettings();
  const {
    patient_name, patient_email, patient_phone,
    service_id, date, start_time, status = 'confirmed',
    attendance_type, notes,
  } = req.body;

  const parsedServiceId = parseServiceId(service_id);
  const parsedAttendance = normalizeAttendance(attendance_type);
  const { actor, actorId } = actorFrom(req);

  if (!patient_name || !patient_phone || !date || !start_time) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Status inválido' });
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
  const notesValue = notes?.trim() ? String(notes).trim().slice(0, 1000) : null;

  try {
    const appointment = transaction(() => {
      if (status === 'pending' || status === 'confirmed') {
        const taken = db.prepare(`
          SELECT id FROM appointments
          WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed')
        `).get(date, start_time);
        if (taken) throw Object.assign(new Error('SLOT_TAKEN'), { code: 'SLOT_TAKEN' });
      }

      db.prepare(`
        INSERT INTO appointments
          (patient_name, patient_email, patient_phone, service_id, service_name,
           date, start_time, end_time, status, attendance_type, meeting_link, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patient_name.trim(),
        patient_email?.trim() || null,
        patient_phone.trim(),
        parsedServiceId,
        serviceName,
        date,
        start_time,
        endTime,
        status,
        parsedAttendance,
        parsedAttendance === 'online'
          ? (req.body.meeting_link?.trim() || getOnlineMeetingLink() || null)
          : null,
        notesValue
      );
      const newId = lastInsertId(db);
      const code = buildReferenceCode(newId, date);
      db.prepare('UPDATE appointments SET reference_code = ? WHERE id = ?').run(code, newId);

      logAppointmentAudit(db, {
        appointmentId: newId,
        action: 'created',
        actor,
        actorId,
        details: { source: 'admin', date, start_time, status },
      });

      return ensureAppointmentReference(db, db.prepare('SELECT * FROM appointments WHERE id = ?').get(newId));
    });

    appointmentChanged('created', appointment, { source: 'admin' });

    if (status === 'confirmed') {
      await sendClientConfirmations(appointment).catch((err) => {
        console.error('Client confirmation error (admin create):', err.message);
      });
    }
    if (settings.notify_email && status === 'confirmed') {
      await notifyNewBooking(appointment, settings.notify_email).catch(() => {});
    }
    res.status(201).json(appointment);
  } catch (err) {
    if (err.code === 'SLOT_TAKEN' || err.message === 'SLOT_TAKEN') {
      return res.status(409).json(conflictPayload(date, start_time));
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
    service_id, date, start_time, status, attendance_type, meeting_link, notes,
  } = req.body;

  const { actor, actorId } = actorFrom(req);
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
  if (!VALID_STATUSES.has(newStatus)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const newAttendance = attendance_type !== undefined
    ? normalizeAttendance(attendance_type)
    : normalizeAttendance(existing.attendance_type);

  const newMeetingLink = meeting_link !== undefined
    ? (newAttendance === 'online' ? (meeting_link?.trim() || null) : null)
    : (newAttendance === 'online' ? existing.meeting_link : null);

  const newNotes = notes !== undefined
    ? (notes?.trim() ? String(notes).trim().slice(0, 1000) : null)
    : existing.notes;

  const dateChanged = newDate !== existing.date || newStart !== existing.start_time;
  const statusChanged = newStatus !== existing.status;

  try {
    const updated = transaction(() => {
      if (dateChanged && (newStatus === 'pending' || newStatus === 'confirmed')) {
        const taken = db.prepare(`
          SELECT id FROM appointments
          WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed') AND id != ?
        `).get(newDate, newStart, id);
        if (taken) throw Object.assign(new Error('SLOT_TAKEN'), { code: 'SLOT_TAKEN' });
      }

      db.prepare(`
        UPDATE appointments SET
          patient_name = ?, patient_email = ?, patient_phone = ?,
          service_id = ?, service_name = ?, date = ?, start_time = ?, end_time = ?,
          status = ?, attendance_type = ?, meeting_link = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        patient_name ?? existing.patient_name,
        patient_email !== undefined ? (patient_email || null) : existing.patient_email,
        patient_phone ?? existing.patient_phone,
        parsedServiceId,
        serviceName,
        newDate, newStart, endTime, newStatus,
        newAttendance,
        newMeetingLink,
        newNotes,
        nowIso(), id
      );

      let action = 'updated';
      if (dateChanged) action = 'rescheduled';
      else if (statusChanged && newStatus === 'cancelled') action = 'cancelled';
      else if (statusChanged && newStatus === 'confirmed') action = 'confirmed';
      else if (statusChanged && newStatus === 'completed') action = 'completed';

      logAppointmentAudit(db, {
        appointmentId: id,
        action,
        actor,
        actorId,
        details: {
          from: { date: existing.date, start_time: existing.start_time, status: existing.status },
          to: { date: newDate, start_time: newStart, status: newStatus },
        },
      });

      return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    });

    appointmentChanged(dateChanged ? 'rescheduled' : 'updated', updated, { source: 'admin' });

    if (statusChanged && newStatus === 'confirmed' && existing.status !== 'confirmed') {
      await sendClientConfirmations(updated).catch((err) => {
        console.error('Client confirmation error (admin update):', err.message);
      });
    }

    res.json(updated);
  } catch (err) {
    if (err.code === 'SLOT_TAKEN' || err.message === 'SLOT_TAKEN') {
      return res.status(409).json(conflictPayload(newDate, newStart));
    }
    throw err;
  }
});

router.post('/appointments/:id/confirm', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });
  if (existing.status === 'cancelled') {
    return res.status(400).json({ error: 'Não é possível confirmar uma consulta cancelada' });
  }

  const { actor, actorId } = actorFrom(req);
  const updated = transaction(() => {
    db.prepare(`UPDATE appointments SET status = 'confirmed', updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
    logAppointmentAudit(db, {
      appointmentId: id,
      action: 'confirmed',
      actor,
      actorId,
      details: { previous_status: existing.status },
    });
    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });

  appointmentChanged('confirmed', updated, { source: 'admin' });

  const notifications = await sendClientConfirmations(updated).catch((err) => {
    console.error('Client confirmation error (admin confirm):', err.message);
    return null;
  });

  res.json({ ...updated, notifications });
});

router.post('/appointments/:id/complete', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });
  if (existing.status === 'cancelled') {
    return res.status(400).json({ error: 'Não é possível concluir uma consulta cancelada' });
  }

  const { actor, actorId } = actorFrom(req);
  const updated = transaction(() => {
    db.prepare(`UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
    logAppointmentAudit(db, {
      appointmentId: id,
      action: 'completed',
      actor,
      actorId,
      details: { previous_status: existing.status },
    });
    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });

  appointmentChanged('completed', updated, { source: 'admin' });
  res.json(updated);
});

router.post('/appointments/:id/reschedule', authMiddleware, async (req, res) => {
  const db = getDb();
  const settings = getSettings();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });

  const { date, start_time, status } = req.body;
  if (!date || !start_time) {
    return res.status(400).json({ error: 'Informe a nova data e horário' });
  }

  const duration = timeToMinutes(existing.end_time) - timeToMinutes(existing.start_time)
    || settings.session_duration_minutes;
  const endTime = minutesToTime(timeToMinutes(start_time) + duration);
  const newStatus = status && VALID_STATUSES.has(status)
    ? status
    : (existing.status === 'cancelled' || existing.status === 'completed' ? 'confirmed' : existing.status);

  const { actor, actorId } = actorFrom(req);

  try {
    const updated = transaction(() => {
      if (newStatus === 'pending' || newStatus === 'confirmed') {
        const taken = db.prepare(`
          SELECT id FROM appointments
          WHERE date = ? AND start_time = ? AND status IN ('pending', 'confirmed') AND id != ?
        `).get(date, start_time, id);
        if (taken) throw Object.assign(new Error('SLOT_TAKEN'), { code: 'SLOT_TAKEN' });
      }

      db.prepare(`
        UPDATE appointments SET
          date = ?, start_time = ?, end_time = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(date, start_time, endTime, newStatus, nowIso(), id);

      logAppointmentAudit(db, {
        appointmentId: id,
        action: 'rescheduled',
        actor,
        actorId,
        details: {
          from: { date: existing.date, start_time: existing.start_time, status: existing.status },
          to: { date, start_time, status: newStatus },
        },
      });

      return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    });

    appointmentChanged('rescheduled', updated, { source: 'admin' });
    res.json(updated);
  } catch (err) {
    if (err.code === 'SLOT_TAKEN' || err.message === 'SLOT_TAKEN') {
      return res.status(409).json(conflictPayload(date, start_time));
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

  const { actor, actorId } = actorFrom(req);
  const updated = transaction(() => {
    db.prepare(`
      UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?
    `).run(nowIso(), id);

    logAppointmentAudit(db, {
      appointmentId: id,
      action: 'cancelled',
      actor,
      actorId,
      details: { previous_status: existing.status },
    });

    return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  });

  appointmentChanged('cancelled', updated, { source: 'admin' });

  if (settings.notify_email) {
    await notifyCancellation(existing, settings.notify_email).catch(() => {});
  }
  res.json(updated);
});

router.post('/appointments/:id/resend-confirmation', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });

  const notifications = await sendClientConfirmations(existing, { force: true });
  const { actor, actorId } = actorFrom(req);
  logAppointmentAudit(db, {
    appointmentId: id,
    action: 'confirmation_resent',
    actor,
    actorId,
    details: { notifications },
  });

  res.json({ ok: true, notifications });
});

router.post('/appointments/:id/send-reminder', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    return res.status(400).json({ error: 'Não é possível enviar lembrete para esta consulta' });
  }

  const notifications = await sendClientReminder(existing);
  const { actor, actorId } = actorFrom(req);
  logAppointmentAudit(db, {
    appointmentId: id,
    action: 'reminder_sent',
    actor,
    actorId,
    details: { notifications },
  });

  res.json({ ok: true, notifications });
});

router.delete('/appointments/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Consulta não encontrada' });

  const { actor, actorId } = actorFrom(req);
  logAppointmentAudit(db, {
    appointmentId: id,
    action: 'deleted',
    actor,
    actorId,
    details: {
      date: existing.date,
      start_time: existing.start_time,
      patient_name: existing.patient_name,
      reference_code: existing.reference_code,
    },
  });

  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  appointmentChanged('deleted', existing, { source: 'admin' });
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
  appointmentChanged('schedule_locked', null, { locked: true });
  res.json({ schedule_locked: true });
});

router.post('/schedule/unlock', authMiddleware, (_req, res) => {
  getDb().prepare('UPDATE settings SET schedule_locked = 0, updated_at = ? WHERE id = 1').run(nowIso());
  appointmentChanged('schedule_unlocked', null, { locked: false });
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
  getDb().prepare(`
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
    db.prepare('INSERT INTO unavailable_dates (date, reason) VALUES (?, ?)').run(date, reason || null);
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
