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
      patient_name TEXT NOT NULL,
      patient_email TEXT,
      patient_phone TEXT NOT NULL,
      service_id INTEGER REFERENCES services(id),
      service_name TEXT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rescheduled')),
      attendance_type TEXT NOT NULL DEFAULT 'presencial'
        CHECK (attendance_type IN ('presencial', 'online')),
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
      ON appointments(date, start_time)
      WHERE status IN ('pending', 'confirmed');
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
}

function migrateSchema(database) {
  const cols = database.prepare('PRAGMA table_info(appointments)').all();
  if (!cols.some((c) => c.name === 'attendance_type')) {
    database.exec(`
      ALTER TABLE appointments ADD COLUMN attendance_type TEXT NOT NULL DEFAULT 'presencial'
        CHECK (attendance_type IN ('presencial', 'online'))
    `);
  }
}

export function nowIso() {
  return new Date().toISOString();
}
