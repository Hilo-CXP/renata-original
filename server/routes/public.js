import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb, lastInsertId } from '../db.js';
import { bookAppointment, getAvailableSlots, getSettings, suggestNextSlots } from '../slotEngine.js';
import {
  notifyNewBooking,
  notifyWaitingList,
  sendClientConfirmations,
} from '../notifications.js';
import { appointmentChanged } from '../events.js';

const router = Router();

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

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
    const appointment = bookAppointment({
      ...req.body,
      booking_ip: clientIp(req),
    });

    // Persist first — notifications never roll back the booking
    appointmentChanged('created', appointment, { source: 'public' });

    let notifications = {
      email: { sent: false },
      mobile: { sent: false },
    };

    try {
      notifications = await sendClientConfirmations(appointment);
    } catch (err) {
      console.error('Client confirmation unexpected error:', err.message);
    }

    const settings = getSettings();
    if (settings.notify_email) {
      notifyNewBooking(appointment, settings.notify_email).catch((err) => {
        console.error('Clinic notify error:', err.message);
      });
    }

    const emailFailed = Boolean(notifications.email)
      && !notifications.email.sent
      && !notifications.email.skipped;
    const mobileFailed = Boolean(notifications.mobile)
      && !notifications.mobile.sent
      && !notifications.mobile.skipped;
    const anyFailed = emailFailed || mobileFailed;
    const emailSent = Boolean(notifications.email?.sent);
    const mobileSent = Boolean(notifications.mobile?.sent);
    const anySent = emailSent || mobileSent;

    let message = 'Consulta registrada com sucesso!';
    if (!anyFailed && emailSent && mobileSent) {
      message = 'Consulta registrada com sucesso! Enviamos a confirmação por e-mail e celular.';
    } else if (!anyFailed && emailSent) {
      message = 'Consulta registrada com sucesso! Enviamos a confirmação por e-mail.';
    } else if (!anyFailed && mobileSent) {
      message = 'Consulta registrada com sucesso! Enviamos a confirmação por celular.';
    } else if (anyFailed) {
      message = 'Consulta registrada com sucesso! Houve um problema ao enviar a confirmação automática. Se preferir, entre em contato pelo WhatsApp (11) 99278-9380.';
    }

    res.status(201).json({
      message,
      appointment: {
        id: appointment.id,
        reference_code: appointment.reference_code,
        date: appointment.date,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        attendance_type: appointment.attendance_type,
        service_name: appointment.service_name,
        status: appointment.status,
      },
      notifications: {
        email: {
          sent: Boolean(notifications.email?.sent),
          skipped: Boolean(notifications.email?.skipped),
        },
        mobile: {
          sent: Boolean(notifications.mobile?.sent),
          skipped: Boolean(notifications.mobile?.skipped),
          channel: notifications.mobile?.channel || null,
        },
        partialFailure: anyFailed,
      },
    });
  } catch (err) {
    const map = {
      SCHEDULE_LOCKED: [403, 'Agenda fechada. Entre na lista de espera.'],
      MISSING_FIELDS: [400, 'Preencha nome, e-mail, telefone, tipo de atendimento, data e horário.'],
      INVALID_ATTENDANCE: [400, 'Selecione o tipo de atendimento: Online ou Presencial.'],
      INVALID_EMAIL: [400, 'Informe um e-mail válido.'],
      INVALID_PHONE: [400, 'Informe um telefone/WhatsApp válido com DDD.'],
      SLOT_UNAVAILABLE: [409, 'Horário indisponível. Escolha outro ou veja as sugestões abaixo.'],
      SLOT_TAKEN: [409, 'Este horário acabou de ser reservado. Escolha outro ou veja as sugestões abaixo.'],
    };
    const code = err.code || err.message;
    const [status, msg] = map[code] || [500, 'Erro ao agendar. Tente novamente.'];
    if (!map[code]) console.error('Booking error:', err);

    const suggestions = err.suggestions
      || ((code === 'SLOT_UNAVAILABLE' || code === 'SLOT_TAKEN')
        ? suggestNextSlots({
          fromDate: req.body?.date,
          afterTime: req.body?.start_time,
          limit: 5,
        })
        : undefined);

    res.status(status).json({
      error: msg,
      code,
      ...(suggestions?.length ? { suggestions } : {}),
    });
  }
});

router.post('/waiting-list', bookingLimiter, async (req, res) => {
  const { name, phone, email, preferred_day, preferred_time, note } = req.body;

  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
  }

  const db = getDb();
  db.prepare(`
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
    notifyWaitingList(entry, settings.notify_email).catch((err) => {
      console.error('Waiting list notify error:', err.message);
    });
  }

  res.status(201).json({ message: 'Você entrou na lista de espera. Entraremos em contato em breve.' });
});

export default router;
