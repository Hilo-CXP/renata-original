import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'agenda.db');

let db;

export function getDb() {
  if (!db) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

export function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function lastInsertId(database) {
  return database.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schedule_locked INTEGER NOT NULL DEFAULT 0,
      session_duration_minutes INTEGER NOT NULL DEFAULT 50,
      buffer_minutes INTEGER NOT NULL DEFAULT 10,
      notify_email TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS working_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(day_of_week)
    );

    CREATE TABLE IF NOT EXISTS breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unavailable_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      reason TEXT,
      UNIQUE(date, start_time)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT UNIQUE,
      patient_name TEXT NOT NULL,
      patient_email TEXT,
      patient_phone TEXT NOT NULL,
      service_id INTEGER REFERENCES services(id),
      service_name TEXT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'rescheduled')),
      attendance_type TEXT NOT NULL DEFAULT 'presencial'
        CHECK (attendance_type IN ('presencial', 'online')),
      meeting_link TEXT,
      notes TEXT,
      booking_ip TEXT,
      confirmation_email_sent_at TEXT,
      confirmation_mobile_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS waiting_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT NOT NULL,
      preferred_day TEXT,
      preferred_time TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'contacted', 'scheduled', 'cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const settings = database.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!settings) {
    database.prepare(`
      INSERT INTO settings (id, schedule_locked, session_duration_minutes, buffer_minutes, notify_email)
      VALUES (1, 0, 50, 10, NULL)
    `).run();
  }

  const serviceCount = database.prepare('SELECT COUNT(*) AS c FROM services').get().c;
  if (serviceCount === 0) {
    const insert = database.prepare(`
      INSERT INTO services (name, description, duration_minutes, sort_order) VALUES (?, ?, ?, ?)
    `);
    const defaults = [
      ['Psicoterapia', 'Atendimento clínico individual para adultos.', 50, 1],
      ['Arteterapia', 'Expressão emocional por meio da arte.', 50, 2],
      ['Terapia de Casal', 'Fortalecimento da comunicação e vínculo.', 50, 3],
      ['Terapia Infantil', 'Atendimento lúdico para crianças.', 50, 4],
    ];
    defaults.forEach((s) => insert.run(...s));
  }

  const whCount = database.prepare('SELECT COUNT(*) AS c FROM working_hours').get().c;
  if (whCount === 0) {
    const insert = database.prepare(`
      INSERT INTO working_hours (day_of_week, start_time, end_time, enabled) VALUES (?, ?, ?, ?)
    `);
    for (let d = 1; d <= 6; d++) {
      insert.run(d, '08:00', '20:00', 1);
    }
    insert.run(0, '08:00', '20:00', 0);
  }

  migrateSchema(database);
  ensureAppointmentIndexes(database);
}

function tableHasColumn(database, table, column) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function migrateSchema(database) {
  if (!tableHasColumn(database, 'appointments', 'attendance_type')) {
    database.exec(`
      ALTER TABLE appointments ADD COLUMN attendance_type TEXT NOT NULL DEFAULT 'presencial'
    `);
  }
  if (!tableHasColumn(database, 'appointments', 'meeting_link')) {
    database.exec('ALTER TABLE appointments ADD COLUMN meeting_link TEXT');
  }
  if (!tableHasColumn(database, 'appointments', 'confirmation_email_sent_at')) {
    database.exec('ALTER TABLE appointments ADD COLUMN confirmation_email_sent_at TEXT');
  }
  if (!tableHasColumn(database, 'appointments', 'confirmation_mobile_sent_at')) {
    database.exec('ALTER TABLE appointments ADD COLUMN confirmation_mobile_sent_at TEXT');
  }
  if (!tableHasColumn(database, 'appointments', 'notes')) {
    database.exec('ALTER TABLE appointments ADD COLUMN notes TEXT');
  }
  if (!tableHasColumn(database, 'appointments', 'booking_ip')) {
    database.exec('ALTER TABLE appointments ADD COLUMN booking_ip TEXT');
  }
  if (!tableHasColumn(database, 'appointments', 'reference_code')) {
    database.exec('ALTER TABLE appointments ADD COLUMN reference_code TEXT');
  }

  migrateAppointmentsStatusConstraint(database);
  backfillReferenceCodes(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS appointment_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor TEXT,
      actor_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function ensureAppointmentIndexes(database) {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
      ON appointments(date, start_time)
      WHERE status IN ('pending', 'confirmed');

    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(start_time);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_name ON appointments(patient_name);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_email ON appointments(patient_email);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_phone ON appointments(patient_phone);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_reference_unique
      ON appointments(reference_code) WHERE reference_code IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_appointment
      ON appointment_audit(appointment_id, created_at);
  `);
}

/**
 * SQLite cannot ALTER CHECK constraints — rebuild table when 'completed' is missing.
 */
function migrateAppointmentsStatusConstraint(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'")
    .get();
  if (!row?.sql) return;
  if (row.sql.includes("'completed'")) return;

  const has = (col) => tableHasColumn(database, 'appointments', col);
  const refSel = has('reference_code') ? 'reference_code' : 'NULL';
  const notesSel = has('notes') ? 'notes' : 'NULL';
  const ipSel = has('booking_ip') ? 'booking_ip' : 'NULL';
  const attendSel = has('attendance_type')
    ? "COALESCE(attendance_type, 'presencial')"
    : "'presencial'";
  const meetSel = has('meeting_link') ? 'meeting_link' : 'NULL';
  const emailSel = has('confirmation_email_sent_at') ? 'confirmation_email_sent_at' : 'NULL';
  const mobileSel = has('confirmation_mobile_sent_at') ? 'confirmation_mobile_sent_at' : 'NULL';

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec(`
    CREATE TABLE appointments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT UNIQUE,
      patient_name TEXT NOT NULL,
      patient_email TEXT,
      patient_phone TEXT NOT NULL,
      service_id INTEGER REFERENCES services(id),
      service_name TEXT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'rescheduled')),
      attendance_type TEXT NOT NULL DEFAULT 'presencial'
        CHECK (attendance_type IN ('presencial', 'online')),
      meeting_link TEXT,
      notes TEXT,
      booking_ip TEXT,
      confirmation_email_sent_at TEXT,
      confirmation_mobile_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO appointments_new (
      id, reference_code, patient_name, patient_email, patient_phone,
      service_id, service_name, date, start_time, end_time, status,
      attendance_type, meeting_link, notes, booking_ip,
      confirmation_email_sent_at, confirmation_mobile_sent_at, created_at, updated_at
    )
    SELECT
      id,
      ${refSel},
      patient_name, patient_email, patient_phone,
      service_id, service_name, date, start_time, end_time, status,
      ${attendSel},
      ${meetSel},
      ${notesSel},
      ${ipSel},
      ${emailSel}, ${mobileSel}, created_at, updated_at
    FROM appointments;

    DROP TABLE appointments;
    ALTER TABLE appointments_new RENAME TO appointments;
  `);
  database.exec('PRAGMA foreign_keys = ON');
}

function backfillReferenceCodes(database) {
  const missing = database
    .prepare('SELECT id, date FROM appointments WHERE reference_code IS NULL OR reference_code = \'\'')
    .all();
  if (!missing.length) return;

  const update = database.prepare('UPDATE appointments SET reference_code = ? WHERE id = ?');
  for (const row of missing) {
    update.run(buildReferenceCode(row.id, row.date), row.id);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

/** Unique public reference, e.g. RB-20260724-0042 */
export function buildReferenceCode(id, dateStr) {
  const datePart = (dateStr || nowIso().slice(0, 10)).replace(/-/g, '');
  const seq = String(id).padStart(4, '0');
  return `RB-${datePart}-${seq}`;
}

export function logAppointmentAudit(database, {
  appointmentId,
  action,
  actor = null,
  actorId = null,
  details = null,
}) {
  database.prepare(`
    INSERT INTO appointment_audit (appointment_id, action, actor, actor_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    appointmentId,
    action,
    actor,
    actorId,
    details ? JSON.stringify(details) : null,
    nowIso()
  );
}

export function ensureAppointmentReference(database, appointment) {
  if (appointment.reference_code) return appointment;
  const code = buildReferenceCode(appointment.id, appointment.date);
  database.prepare('UPDATE appointments SET reference_code = ? WHERE id = ?').run(code, appointment.id);
  return database.prepare('SELECT * FROM appointments WHERE id = ?').get(appointment.id);
}
