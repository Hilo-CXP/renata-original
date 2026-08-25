import './loadEnv.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  try {
    req.admin = verifyToken(token);
    next();
  } catch {
    res.clearCookie('admin_token', { httpOnly: true, sameSite: 'strict' });
    return res.status(401).json({ error: 'Sessão expirada' });
  }
}

export function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  };
}
