export function normalizeAttendance(value) {
  return value === 'online' ? 'online' : 'presencial';
}

export function parseServiceId(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const id = Number(value);
  return Number.isFinite(id) ? id : fallback;
}
