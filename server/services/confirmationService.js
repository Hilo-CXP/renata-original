import { getDb, nowIso } from '../db.js';
import { PRACTICE, getOnlineMeetingLink } from '../config/practice.js';
import { sendEmail } from './emailService.js';
import { sendMobileMessage, sendWhatsApp } from './messagingService.js';
import {
  escapeHtml,
  formatDateBR,
  formatPhoneDisplay,
  normalizePhoneE164,
} from '../utils.js';

function attendanceLabel(type) {
  return type === 'online' ? 'Online' : 'Presencial';
}

function resolveMeetingLink(appointment) {
  if (appointment.attendance_type !== 'online') return null;
  return appointment.meeting_link || getOnlineMeetingLink() || null;
}

function buildLocationBlock(appointment) {
  if (appointment.attendance_type === 'online') {
    const link = resolveMeetingLink(appointment);
    return {
      label: 'Link da consulta online',
      text: link || 'O link da consulta será enviado antes do horário agendado.',
      html: link
        ? `<a href="${escapeHtml(link)}" style="color:#4a3070;word-break:break-all;">${escapeHtml(link)}</a>`
        : 'O link da consulta será enviado antes do horário agendado.',
    };
  }
  return {
    label: 'Endereço do consultório',
    text: PRACTICE.address,
    html: PRACTICE.addressHtml,
  };
}

function buildInstructions(appointment) {
  if (appointment.attendance_type === 'online') {
    return [
      'Entre na sala virtual com alguns minutos de antecedência.',
      'Prefira um ambiente silencioso e com boa conexão de internet.',
      'Use fones de ouvido, se possível, para maior privacidade.',
      'Em caso de imprevisto, entre em contato o quanto antes para remarcar.',
    ];
  }
  return [
    'Chegue com cerca de 10 minutos de antecedência.',
    'Traga um documento com foto, se for a primeira consulta.',
    'Em caso de atraso ou necessidade de remarcar, avise com antecedência.',
    'O consultório fica em local de fácil acesso em Itaquera.',
  ];
}

export function buildClientConfirmationEmail(appointment) {
  const whenDate = formatDateBR(appointment.date);
  const location = buildLocationBlock(appointment);
  const instructions = buildInstructions(appointment);
  const siteUrl = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const name = escapeHtml(appointment.patient_name);
  const service = escapeHtml(appointment.service_name || 'Consulta');
  const typeLabel = attendanceLabel(appointment.attendance_type);

  const text = [
    `Olá, ${appointment.patient_name}!`,
    '',
    'Sua consulta foi confirmada com sucesso.',
    '',
    ...(appointment.reference_code ? [`Referência: ${appointment.reference_code}`] : []),
    `Psicóloga: ${PRACTICE.psychologistName}`,
    `Serviço: ${appointment.service_name || 'Consulta'}`,
    `Tipo: ${typeLabel}`,
    `Data: ${whenDate}`,
    `Horário: ${appointment.start_time}`,
    `${location.label}: ${location.text}`,
    '',
    'Orientações importantes:',
    ...instructions.map((i) => `- ${i}`),
    '',
    `Telefone / WhatsApp: ${PRACTICE.phoneDisplay}`,
    `E-mail: ${PRACTICE.email}`,
    '',
    `Obrigada por escolher o ${PRACTICE.practiceName}.`,
    'Será um prazer acompanhá-la(o) nesta jornada.',
    '',
    PRACTICE.psychologistName,
    PRACTICE.crp,
  ].join('\n');

  const instructionHtml = instructions
    .map((i) => `<li style="margin:0 0 8px;color:#3a3a3a;line-height:1.5;">${escapeHtml(i)}</li>`)
    .join('');

  const refHtml = appointment.reference_code
    ? `<div><strong style="color:#2d1b4e;">Referência:</strong> ${escapeHtml(appointment.reference_code)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consulta confirmada</title>
</head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #efe8f7;">
          <tr>
            <td style="background:#4a3070;padding:28px 28px 24px;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:22px;color:#ffffff;font-weight:600;">${escapeHtml(PRACTICE.psychologistName)}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#e8dff5;margin-top:6px;">Psicologia &amp; Arteterapia</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 12px;font-size:16px;color:#3a3a3a;">Olá, <strong style="color:#2d1b4e;">${name}</strong>!</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#6b6b6b;">Sua consulta foi confirmada com sucesso. Seguem os detalhes do agendamento:</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3eef9;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a3a3a;line-height:1.7;">
                    <div><strong style="color:#2d1b4e;">Paciente:</strong> ${name}</div>
                    ${refHtml}
                    <div><strong style="color:#2d1b4e;">Psicóloga:</strong> ${escapeHtml(PRACTICE.psychologistName)}</div>
                    <div><strong style="color:#2d1b4e;">Serviço:</strong> ${service}</div>
                    <div><strong style="color:#2d1b4e;">Tipo:</strong> ${typeLabel}</div>
                    <div><strong style="color:#2d1b4e;">Data:</strong> ${whenDate}</div>
                    <div><strong style="color:#2d1b4e;">Horário:</strong> ${escapeHtml(appointment.start_time)}</div>
                    <div style="margin-top:8px;"><strong style="color:#2d1b4e;">${escapeHtml(location.label)}:</strong><br>${location.html}</div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:18px;color:#2d1b4e;">Orientações importantes</p>
              <ul style="margin:0 0 24px;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
                ${instructionHtml}
              </ul>

              <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a3a3a;">
                <strong>Contato:</strong> ${escapeHtml(PRACTICE.phoneDisplay)} ·
                <a href="mailto:${escapeHtml(PRACTICE.email)}" style="color:#4a3070;">${escapeHtml(PRACTICE.email)}</a>
              </p>
              <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#6b6b6b;">
                Obrigada por escolher o ${escapeHtml(PRACTICE.practiceName)}. Será um prazer caminhar ao seu lado nesta jornada.
              </p>
              <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#2d1b4e;">
                ${escapeHtml(PRACTICE.psychologistName)}<br>
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#999;">${escapeHtml(PRACTICE.crp)}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#999;text-align:center;">
              <a href="${escapeHtml(siteUrl)}" style="color:#6b4d8a;text-decoration:none;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `Consulta confirmada — ${whenDate} às ${appointment.start_time}`,
    text,
    html,
  };
}

export function buildClientMobileMessage(appointment) {
  const whenDate = formatDateBR(appointment.date);
  const location = buildLocationBlock(appointment);
  const typeLabel = attendanceLabel(appointment.attendance_type);
  const ref = appointment.reference_code ? `\n🔖 Ref: ${appointment.reference_code}` : '';

  return [
    `Olá, ${appointment.patient_name}! Sua consulta com ${PRACTICE.psychologistName} está confirmada.`,
    `📅 ${whenDate} às ${appointment.start_time}`,
    `🩺 ${typeLabel}${appointment.service_name ? ` — ${appointment.service_name}` : ''}`,
    `📍 ${location.label}: ${location.text}${ref}`,
    `Dúvidas ou remarcação: ${PRACTICE.phoneDisplay} / ${PRACTICE.email}`,
  ].join('\n');
}

export function buildClientReminderEmail(appointment) {
  const whenDate = formatDateBR(appointment.date);
  const location = buildLocationBlock(appointment);
  const typeLabel = attendanceLabel(appointment.attendance_type);
  const refLine = appointment.reference_code ? `Referência: ${appointment.reference_code}` : '';

  const text = [
    `Olá, ${appointment.patient_name}!`,
    '',
    'Lembrete da sua consulta:',
    '',
    `Data: ${whenDate}`,
    `Horário: ${appointment.start_time}`,
    `Tipo: ${typeLabel}`,
    appointment.service_name ? `Serviço: ${appointment.service_name}` : '',
    `${location.label}: ${location.text}`,
    refLine,
    '',
    `Contato: ${PRACTICE.phoneDisplay} · ${PRACTICE.email}`,
    PRACTICE.psychologistName,
  ].filter(Boolean).join('\n');

  return {
    subject: `Lembrete de consulta — ${whenDate} às ${appointment.start_time}`,
    text,
    html: `<p>Olá, <strong>${escapeHtml(appointment.patient_name)}</strong>!</p>
      <p>Lembrete da sua consulta em <strong>${whenDate}</strong> às <strong>${escapeHtml(appointment.start_time)}</strong>
      (${escapeHtml(typeLabel)}).</p>
      <p><strong>${escapeHtml(location.label)}:</strong><br>${location.html}</p>
      ${appointment.reference_code ? `<p>Referência: <strong>${escapeHtml(appointment.reference_code)}</strong></p>` : ''}
      <p>Contato: ${escapeHtml(PRACTICE.phoneDisplay)}</p>`,
  };
}

export function buildClientReminderMobile(appointment) {
  const whenDate = formatDateBR(appointment.date);
  const location = buildLocationBlock(appointment);
  return [
    `🔔 Lembrete: consulta com ${PRACTICE.psychologistName}`,
    `📅 ${whenDate} às ${appointment.start_time}`,
    `📍 ${location.label}: ${location.text}`,
    appointment.reference_code ? `🔖 Ref: ${appointment.reference_code}` : null,
    `Dúvidas: ${PRACTICE.phoneDisplay}`,
  ].filter(Boolean).join('\n');
}

function markConfirmation(appointmentId, field) {
  const allowed = {
    confirmation_email_sent_at: true,
    confirmation_mobile_sent_at: true,
  };
  if (!allowed[field]) throw new Error('Invalid confirmation field');

  getDb().prepare(`
    UPDATE appointments
    SET ${field} = ?, updated_at = ?
    WHERE id = ?
  `).run(nowIso(), nowIso(), appointmentId);
}

/**
 * Envia confirmações ao cliente (e-mail + WhatsApp/SMS).
 * Evita duplicatas via colunas no banco (a menos que force=true). Nunca lança.
 */
export async function sendClientConfirmations(appointment, { force = false } = {}) {
  const result = {
    email: { sent: false, skipped: false, reason: null },
    mobile: { sent: false, skipped: false, reason: null, channel: null },
  };

  if (!appointment?.id) {
    console.error('Confirmation skipped: missing appointment id');
    result.email.reason = 'missing_appointment_id';
    result.mobile.reason = 'missing_appointment_id';
    return result;
  }

  const fresh = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(appointment.id);
  if (!fresh) {
    console.error('Confirmation skipped: appointment not found', appointment.id);
    result.email.reason = 'appointment_not_found';
    result.mobile.reason = 'appointment_not_found';
    return result;
  }

  const emailPayload = buildClientConfirmationEmail(fresh);
  const mobileText = buildClientMobileMessage(fresh);

  // Dedup só após envio bem-sucedido; force=true (admin) permite reenvio.
  // confirmation_email_sent_at começa NULL — não bloqueia o primeiro envio.
  if (!force && fresh.confirmation_email_sent_at) {
    result.email = { sent: true, skipped: true, reason: 'already_sent' };
  } else if (!fresh.patient_email) {
    result.email = { sent: false, skipped: true, reason: 'missing_email' };
  } else {
    const emailResult = await sendEmail({
      to: fresh.patient_email,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
    });
    result.email = { ...emailResult, skipped: false };
    if (emailResult.sent) {
      markConfirmation(fresh.id, 'confirmation_email_sent_at');
    } else {
      console.error(
        `Confirmation email failed for appointment #${fresh.id}:`,
        emailResult.reason || 'unknown'
      );
    }
  }

  if (!force && fresh.confirmation_mobile_sent_at) {
    result.mobile = { sent: true, skipped: true, reason: 'already_sent', channel: null };
  } else {
    const to = normalizePhoneE164(fresh.patient_phone);
    if (!to) {
      result.mobile = { sent: false, skipped: true, reason: 'invalid_phone', channel: null };
    } else {
      const mobileResult = await sendMobileMessage(to, mobileText);
      // Sem WhatsApp/SMS configurado: não trata como falha (e-mail pode ter ido).
      const notConfigured = mobileResult.reason === 'mobile_not_configured';
      result.mobile = {
        ...mobileResult,
        skipped: notConfigured,
      };
      if (mobileResult.sent) {
        markConfirmation(fresh.id, 'confirmation_mobile_sent_at');
      } else if (!notConfigured) {
        console.error(
          `Confirmation mobile failed for appointment #${fresh.id}:`,
          mobileResult.reason || 'unknown'
        );
      }
    }
  }

  return result;
}

/** Envia lembrete ao paciente. Nunca lança. */
export async function sendClientReminder(appointment) {
  const result = {
    email: { sent: false, skipped: false, reason: null },
    mobile: { sent: false, skipped: false, reason: null, channel: null },
  };

  if (!appointment?.id) {
    result.email.reason = 'missing_appointment_id';
    result.mobile.reason = 'missing_appointment_id';
    return result;
  }

  const fresh = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(appointment.id);
  if (!fresh) {
    result.email.reason = 'appointment_not_found';
    result.mobile.reason = 'appointment_not_found';
    return result;
  }

  const emailPayload = buildClientReminderEmail(fresh);
  const mobileText = buildClientReminderMobile(fresh);

  if (!fresh.patient_email) {
    result.email = { sent: false, skipped: true, reason: 'missing_email' };
  } else {
    const emailResult = await sendEmail({
      to: fresh.patient_email,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
    });
    result.email = { ...emailResult, skipped: false };
  }

  const to = normalizePhoneE164(fresh.patient_phone);
  if (!to) {
    result.mobile = { sent: false, skipped: true, reason: 'invalid_phone', channel: null };
  } else {
    const mobileResult = await sendMobileMessage(to, mobileText);
    result.mobile = { ...mobileResult, skipped: false };
  }

  return result;
}

/** Notifica a clínica sobre novo agendamento (não bloqueia o cliente). */
export async function notifyClinicNewBooking(appointment, notifyEmail) {
  const when = `${formatDateBR(appointment.date)} às ${appointment.start_time}`;
  const subject = `Nova consulta agendada — ${appointment.patient_name}`;
  const text = [
    'Nova consulta confirmada no site:',
    '',
    `Paciente: ${appointment.patient_name}`,
    `Telefone: ${formatPhoneDisplay(appointment.patient_phone)}`,
    appointment.patient_email ? `E-mail: ${appointment.patient_email}` : '',
    appointment.service_name ? `Serviço: ${appointment.service_name}` : '',
    `Atendimento: ${attendanceLabel(appointment.attendance_type)}`,
    `Data/hora: ${when}`,
    '',
    'Acesse o painel administrativo para gerenciar.',
  ].filter(Boolean).join('\n');

  const tasks = [];
  if (notifyEmail) {
    tasks.push(sendEmail({ to: notifyEmail, subject, text }));
  }
  const clinicNumber = (process.env.WHATSAPP_NOTIFY_NUMBER || PRACTICE.phoneE164).replace(/\D/g, '');
  if (clinicNumber) {
    tasks.push(sendWhatsApp(
      clinicNumber,
      `📅 Nova consulta: ${appointment.patient_name} — ${when}. Tel: ${appointment.patient_phone}`
    ));
  }
  await Promise.allSettled(tasks);
}

export async function notifyClinicCancellation(appointment, notifyEmail) {
  const when = `${formatDateBR(appointment.date)} às ${appointment.start_time}`;
  const subject = `Consulta cancelada — ${appointment.patient_name}`;
  const text = `A consulta de ${appointment.patient_name} (${when}) foi cancelada.`;
  const tasks = [];
  if (notifyEmail) tasks.push(sendEmail({ to: notifyEmail, subject, text }));
  const clinicNumber = (process.env.WHATSAPP_NOTIFY_NUMBER || PRACTICE.phoneE164).replace(/\D/g, '');
  if (clinicNumber) {
    tasks.push(sendWhatsApp(clinicNumber, `❌ Cancelamento: ${appointment.patient_name} — ${when}`));
  }
  await Promise.allSettled(tasks);
}

export async function notifyClinicWaitingList(entry, notifyEmail) {
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

  const tasks = [];
  if (notifyEmail) tasks.push(sendEmail({ to: notifyEmail, subject, text }));
  const clinicNumber = (process.env.WHATSAPP_NOTIFY_NUMBER || PRACTICE.phoneE164).replace(/\D/g, '');
  if (clinicNumber) {
    tasks.push(sendWhatsApp(clinicNumber, `📋 Lista de espera: ${entry.name} — ${entry.phone}`));
  }
  await Promise.allSettled(tasks);
}
