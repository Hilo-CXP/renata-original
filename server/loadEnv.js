import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = dotenv.config({ path: path.join(rootDir, '.env') });

if (result.error) {
  console.warn('Aviso: não foi possível carregar .env:', result.error.message);
}

export default result;
