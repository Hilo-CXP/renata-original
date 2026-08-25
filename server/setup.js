import './loadEnv.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = getDb();

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'AltereSenhaForte123!';
const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`Admin "${username}" atualizado.`);
} else {
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Admin "${username}" criado.`);
}

const notifyEmail = process.env.NOTIFY_EMAIL;
if (notifyEmail) {
  db.prepare('UPDATE settings SET notify_email = ? WHERE id = 1').run(notifyEmail);
}

console.log('Banco de dados pronto em data/agenda.db');
console.log('Execute: npm start');
