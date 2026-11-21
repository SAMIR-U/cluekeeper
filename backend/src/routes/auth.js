import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, run, isUniqueViolation } from '../db.js';
import { config } from '../config.js';
import { AppError, conflict, notFound, parse, unauthorized } from '../lib/errors.js';
import { randomSecret, sha256, safeEqual } from '../lib/crypto.js';
import { clearSessionCookie, setSessionCookie, signSession, verifyToken } from '../lib/auth.js';
import { authenticate, limiter } from '../middleware/index.js';
import { findRally, findRallyByCode, loadRally, publicRally } from '../services/rallies.js';

const router = Router();

const cleanName = (s) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
const teamName = z.string().transform(cleanName).pipe(z.string().min(2, 'Mínimo 2 caracteres').max(40, 'Máximo 40 caracteres'));

const entry = z
  .object({
    code: z.string().trim().min(1).max(32).optional(),
    joinToken: z.string().max(2000).optional(),
    teamName,
  })
  .refine((d) => d.code || d.joinToken, { message: 'Envía el código del rally o el token del QR', path: ['code'] });

async function resolveRally({ code, joinToken }) {
  let rally = null;
  if (joinToken) {
    const payload = verifyToken(joinToken, 'join');
    rally = payload ? await findRally(payload.rid) : null;
  } else {
    rally = await findRallyByCode(code);
  }
  if (!rally) throw notFound('INVALID_RALLY_CODE', 'El código del rally no es válido');
  return loadRally(rally.id);
}

async function startSession(res, team, rally, extra = {}) {
  const ttl = config.teamSessionHours * 3600;
  const token = signSession({ sub: team.id, role: 'team', rid: rally.id }, ttl);
  setSessionCookie(res, token, ttl);
  // `token` permite usar Authorization: Bearer cuando el navegador bloquea cookies de terceros
  return { token, expiresIn: ttl, team: { id: team.id, name: team.name }, rally: await publicRally(rally, team), ...extra };
}

// Vista previa pública del rally (para el QR: "la app abre con el rally ya cargado")
router.get('/lookup', limiter({ limit: 30 }), async (req, res) => {
  const rally = await resolveRally({ code: req.query.code, joinToken: req.query.token });
  res.json({ rally: { id: rally.id, name: rally.name, status: rally.status, durationMinutes: rally.duration_minutes } });
});

// HU-01 / HU-02
router.post('/team/join', limiter({ limit: 20 }), async (req, res) => {
  const data = parse(entry, req.body);
  const rally = await resolveRally(data);
  if (rally.status === 'FINISHED') throw conflict('RALLY_FINISHED', 'Este rally ya finalizó');

  const teamKey = randomSecret(16);
  const team = { id: randomUUID(), name: data.teamName };
  try {
    await run(
      'INSERT INTO teams (id, rally_id, name, name_key, key_hash, joined_at) VALUES (?,?,?,?,?,?)',
      team.id, rally.id, team.name, team.name.toLocaleLowerCase('es'), sha256(teamKey), Date.now(),
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('TEAM_NAME_TAKEN', 'Ya existe un equipo con ese nombre en este rally');
    throw e;
  }
  const created = await one('SELECT * FROM teams WHERE id=?', team.id);
  // teamKey permite recuperar la sesión si se pierde la cookie o se cambia de dispositivo
  res.status(201).json(await startSession(res, created, rally, { teamKey }));
});

router.post('/team/resume', limiter({ limit: 20 }), async (req, res) => {
  const data = parse(entry.and(z.object({ teamKey: z.string().min(8).max(100) })), req.body);
  const rally = await resolveRally(data);
  const team = await one('SELECT * FROM teams WHERE rally_id=? AND name_key=?', rally.id, data.teamName.toLocaleLowerCase('es'));
  if (!team || !safeEqual(sha256(data.teamKey), team.key_hash)) {
    throw unauthorized('INVALID_TEAM_KEY', 'Equipo o clave de recuperación incorrectos');
  }
  res.json(await startSession(res, team, rally));
});

const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/organizer/login', limiter({ limit: 10 }), async (req, res) => {
  const { email, password } = parse(
    z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().min(1).max(200) }),
    req.body,
  );
  const organizer = await one('SELECT * FROM organizers WHERE email=?', email);
  const ok = bcrypt.compareSync(password, organizer?.password_hash ?? DUMMY_HASH);
  if (!organizer || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');

  const ttl = config.organizerSessionHours * 3600;
  const token = signSession({ sub: organizer.id, role: 'organizer' }, ttl);
  setSessionCookie(res, token, ttl);
  res.json({ token, expiresIn: ttl, organizer: { id: organizer.id, email: organizer.email, name: organizer.name } });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', authenticate(['team', 'organizer']), async (req, res) => {
  if (req.role === 'team') {
    return res.json({ role: 'team', team: { id: req.team.id, name: req.team.name }, rally: await publicRally(req.rally, req.team) });
  }
  res.json({ role: 'organizer', organizer: { id: req.organizer.id, email: req.organizer.email, name: req.organizer.name } });
});

export default router;
