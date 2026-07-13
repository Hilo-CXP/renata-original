import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail(to, subject, text, html) {
  const transport = getTransporter();
  if (!transport || !to) return { sent: false, reason: 'email_not_configured' };

  try {
    await transport.sendMail({
      from: `"Renata Batista" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>'),
    });
    return { sent: true };
  } catch (err) {
    console.error('Email error:', err.message);
    return { sent: false, reason: err.message };
  }
}

export async function sendWhatsApp(message) {
  const url = process.env.WHATSAPP_WEBHOOK_URL;
  const number = process.env.WHATSAPP_NOTIFY_NUMBER;
  if (!url || !number) return { sent: false, reason: 'whatsapp_not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, message }),
    });
    return { sent: res.ok };
  } catch (err) {
    console.error('WhatsApp error:', err.message);
    return { sent: false, reason: err.message };
  }
}

function formatDateBR(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export async function notifyNewBooking(appointment, notifyEmail) {
  const when = `${formatDateBR(appointment.date)} às ${appointment.start_time}`;
  const subject = `Nova consulta agendada — ${appointment.patient_name}`;
  const text = [
    'Nova consulta confirmada no site:',
    '',
    `Paciente: ${appointment.patient_name}`,
    `Telefone: ${appointment.patient_phone}`,
    appointment.patient_email ? `E-mail: ${appointment.patient_email}` : '',
    appointment.service_name ? `Serviço: ${appointment.service_name}` : '',
    `Atendimento: ${appointment.attendance_type === 'online' ? 'Online' : 'Presencial'}`,
    `Data/hora: ${when}`,
    '',
    'Acesse o painel administrativo para gerenciar.',
  ].filter(Boolean).join('\n');

  await sendEmail(notifyEmail, subject, text);
  await sendWhatsApp(`📅 Nova consulta: ${appointment.patient_name} — ${when}. Tel: ${appointment.patient_phone}`);
}

export async function notifyCancellation(appointment, notifyEmail) {
  const when = `${formatDateBR(appointment.date)} às ${appointment.start_time}`;
  const subject = `Consulta cancelada — ${appointment.patient_name}`;
  const text = `A consulta de ${appointment.patient_name} (${when}) foi cancelada.`;

  await sendEmail(notifyEmail, subject, text);
  await sendWhatsApp(`❌ Cancelamento: ${appointment.patient_name} — ${when}`);
}

export async function notifyWaitingList(entry, notifyEmail) {
  const subject = `Nova solicitação na lista de espera — ${entry.name}`;
  const text = [
    'Nova entrada na lista de espera:',
    '',
    `Nome: ${entry.name}`,
    `Telefone: ${entry.phone}`,
    entry.email ? `E-mail: ${entry.email}` : '',
    entry.preferred_day ? `Dia preferido: ${entry.preferred_day}` : '',
    entry.preferred_time ? `Horário preferido: ${entry.preferred_time}` : '',
    entry.note ? `Observação: ${entry.note}` : '',
  ].filter(Boolean).join('\n');

  await sendEmail(notifyEmail, subject, text);
  await sendWhatsApp(`📋 Lista de espera: ${entry.name} — ${entry.phone}`);
}
