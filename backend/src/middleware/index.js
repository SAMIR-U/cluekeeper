import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { AppError, forbidden, unauthorized, notFound } from '../lib/errors.js';
import { COOKIE_NAME, verifyToken } from '../lib/auth.js';
import { one } from '../db.js';
import { loadRally } from '../services/rallies.js';

export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // La API devuelve datos/archivos, nunca HTML ejecutable. También protege el SVG de los QR.
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    'Cache-Control': 'no-store',
  });
  next();
}

// Defensa CSRF: las cookies viajan cross-site, así que se exige origen conocido en métodos que escriben
export function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // clientes no-navegador
  let sameHost = false;
  try { sameHost = new URL(origin).host === req.get('host'); } catch { /* origen inválido */ }
  if (sameHost || config.corsOrigins.includes(origin.replace(/\/$/, ''))) return next();
  next(forbidden('ORIGIN_NOT_ALLOWED', 'Origen no autorizado'));
}

export function limiter({ windowMs = 60_000, limit = 30, key } = {}) {
  if (!config.rateLimitEnabled) return (req, res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key, validate: { keyGeneratorIpFallback: false } } : {}),
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes, intenta en un momento')),
  });
}

function extractToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[COOKIE_NAME] ?? null;
}

// roles: 'team' | 'organizer'
export function authenticate(roles) {
  return async (req, res, next) => {
    const token = extractToken(req);
    const payload = token ? verifyToken(token, 'session') : null;
    if (!payload) return next(unauthorized('UNAUTHENTICATED', 'Inicia sesión para continuar'));
    if (!roles.includes(payload.role)) return next(forbidden('FORBIDDEN', 'No tienes permiso para esta acción'));

    if (payload.role === 'team') {
      const team = await one('SELECT * FROM teams WHERE id=?', payload.sub);
      if (!team) return next(unauthorized('UNAUTHENTICATED', 'La sesión ya no es válida'));
      req.team = team;
      req.rally = await loadRally(team.rally_id);
    } else {
      const organizer = await one('SELECT * FROM organizers WHERE id=?', payload.sub);
      if (!organizer) return next(unauthorized('UNAUTHENTICATED', 'La sesión ya no es válida'));
      req.organizer = organizer;
    }
    req.role = payload.role;
    next();
  };
}

// Rally administrado por el organizador autenticado
export async function ownedRally(req) {
  const rally = await loadRally(req.params.id);
  if (!rally || rally.organizer_id !== req.organizer.id) throw notFound('RALLY_NOT_FOUND', 'Rally no encontrado');
  return rally;
}

export function notFoundHandler(req, res, next) {
  next(notFound('NOT_FOUND', 'Ruta no encontrada'));
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', message: tooBig ? 'El archivo es demasiado grande' : err.message },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON mal formado' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Solicitud demasiado grande' } });
  }
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
}
