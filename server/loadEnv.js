import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = dotenv.config({ path: path.join(rootDir, '.env') });

if (result.error) {
  console.warn('Aviso: não foi possível carregar .env:', result.error.message);
}

// Senhas de app do Gmail costumam ter espaços — remove aspas e espaços extras.
for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'NOTIFY_EMAIL']) {
  const value = process.env[key];
  if (typeof value === 'string') {
    process.env[key] = value.trim().replace(/^['"]|['"]$/g, '');
  }
}

export default result;
