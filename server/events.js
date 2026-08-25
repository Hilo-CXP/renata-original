/**
 * Simple in-process event bus for admin calendar live sync (SSE).
 */
const listeners = new Set();
let seq = 0;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcast(event, payload = {}) {
  seq += 1;
  const message = {
    id: seq,
    event,
    payload,
    at: new Date().toISOString(),
  };
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (err) {
      console.error('SSE listener error:', err.message);
    }
  }
  return message;
}

export function appointmentChanged(action, appointment, extra = {}) {
  return broadcast('appointment', {
    action,
    appointment: appointment
      ? {
          id: appointment.id,
          reference_code: appointment.reference_code,
          date: appointment.date,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          status: appointment.status,
          patient_name: appointment.patient_name,
        }
      : null,
    ...extra,
  });
}
