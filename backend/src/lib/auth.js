import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const COOKIE_NAME = 'ck_session';

const sign = (payload, ttlSeconds) =>
  jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: ttlSeconds });

export function signSession(payload, ttlSeconds) {
  return sign({ typ: 'session', ...payload }, ttlSeconds);
}

// Token firmado que va dentro del QR de acceso del organizador
export function signJoinToken(rallyId) {
  return sign({ typ: 'join', rid: rallyId }, 14 * 24 * 3600);
}

export function verifyToken(token, typ) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return payload.typ === typ ? payload : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token, ttlSeconds) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: ttlSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
  });
}
