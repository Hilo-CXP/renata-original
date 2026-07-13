import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { verifyToken } from './auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const adminDir = path.join(rootDir, 'admin');
const PORT = process.env.PORT || 3000;

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      frameSrc: ["'self'", 'https://maps.google.com', 'https://www.google.com'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

// Rotas do admin ANTES do static — evita conflito com a pasta /admin
app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(adminDir, 'login.html'));
});

app.get('/admin', (req, res) => {
  const token = req.cookies?.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    verifyToken(token);
    res.sendFile(path.join(adminDir, 'dashboard.html'));
  } catch {
    res.clearCookie('admin_token', { httpOnly: true, sameSite: 'strict', path: '/' });
    res.redirect('/admin/login');
  }
});

app.use('/admin/css', express.static(path.join(adminDir, 'css')));
app.use('/admin/js', express.static(path.join(adminDir, 'js')));

// Static do site público (ignora /admin e /api)
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api')) {
    return next();
  }
  express.static(rootDir, { index: 'index.html' })(req, res, next);
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /api/admin\n');
});

app.use((_req, res) => {
  res.status(404).sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  Site:   http://localhost:' + PORT);
  console.log('  Admin:  http://localhost:' + PORT + '/admin/login');
  console.log('');
  console.log('  Usuario padrao: admin');
  console.log('  Senha padrao:   AltereSenhaForte123!');
  console.log('');
});
