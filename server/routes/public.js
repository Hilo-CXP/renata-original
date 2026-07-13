import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb, lastInsertId } from '../db.js';
import { bookAppointment, getAvailableSlots, getSettings } from '../slotEngine.js';
import {
  notifyNewBooking,
  notifyWaitingList,
} from '../notifications.js';

const router = Router();

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

router.get('/settings', (_req, res) => {
  const settings = getSettings();
  res.json({
    schedule_locked: !!settings.schedule_locked,
    session_duration_minutes: settings.session_duration_minutes,
  });
});

router.get('/services', (_req, res) => {
  const services = getDb().prepare(`
    SELECT id, name, description, duration_minutes
    FROM services WHERE active = 1
    ORDER BY sort_order, name
  `).all();
  res.json(services);
});

router.get('/slots', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Data inválida' });
  }
  const result = getAvailableSlots(date);
  res.json(result);
});

router.post('/appointments', bookingLimiter, async (req, res) => {
  try {
    const appointment = bookAppointment(req.body);
    const settings = getSettings();
    if (settings.notify_email) {
      await notifyNewBooking(appointment, settings.notify_email);
    }
    res.status(201).json({
      message: 'Consulta confirmada com sucesso!',
      appointment: {
        date: appointment.date,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
      },
    });
  } catch (err) {
    const map = {
      SCHEDULE_LOCKED: [403, 'Agenda fechada. Entre na lista de espera.'],
      MISSING_FIELDS: [400, 'Preencha nome, telefone, data e horário.'],
      SLOT_UNAVAILABLE: [409, 'Horário indisponível. Escolha outro.'],
      SLOT_TAKEN: [409, 'Este horário acabou de ser reservado. Escolha outro.'],
    };
    const [status, msg] = map[err.message] || [500, 'Erro ao agendar. Tente novamente.'];
    res.status(status).json({ error: msg });
  }
});

router.post('/waiting-list', bookingLimiter, async (req, res) => {
  const { name, phone, email, preferred_day, preferred_time, note } = req.body;

  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO waiting_list (name, email, phone, preferred_day, preferred_time, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    email?.trim() || null,
    phone.trim(),
    preferred_day?.trim() || null,
    preferred_time?.trim() || null,
    note?.trim() || null
  );

  const entry = db.prepare('SELECT * FROM waiting_list WHERE id = ?').get(lastInsertId(db));
  const settings = getSettings();
  if (settings.notify_email) {
    await notifyWaitingList(entry, settings.notify_email);
  }

  res.status(201).json({ message: 'Você entrou na lista de espera. Entraremos em contato em breve.' });
});

export default router;
