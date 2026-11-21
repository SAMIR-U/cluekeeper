import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { authenticate, limiter } from '../middleware/index.js';
import { publicRally } from '../services/rallies.js';
import * as play from '../services/play.js';
import { ranking } from '../services/ranking.js';
import { listNotifications } from '../services/notifications.js';

const router = Router();
const teamOnly = authenticate(['team']);
const perTeam = (limit) => limiter({ limit, key: (req) => req.team?.id ?? 'anon' });

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const capturedAt = z.number().int().positive().optional();
const idKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

// HU-03 / HU-16: estado del rally y cronómetro (el cliente calcula con serverTime para evitar desfases de reloj)
router.get('/rally', teamOnly, async (req, res) => {
  const state = await play.teamState(req.rally, req.team);
  res.json({
    rally: await publicRally(req.rally, req.team),
    team: { id: req.team.id, name: req.team.name, score: req.team.score },
    progress: { completed: state.completed, total: state.total },
  });
});

// HU-04 / HU-05: pista vigente
router.get('/route/current', teamOnly, async (req, res) => {
  res.json(await play.routeCurrent(req.rally, req.team));
});

// HU-07: progreso y tiempos por reto
router.get('/progress', teamOnly, async (req, res) => {
  res.json(await play.progressView(req.rally, req.team));
});

// HU-17
router.get('/ranking', teamOnly, async (req, res) => {
  const rows = await ranking(req.rally);
  res.json({ rallyStatus: req.rally.status, ranking: rows, me: rows.find((r) => r.teamId === req.team.id) ?? null });
});

// HU-06: distancia al checkpoint (sin comprometer la llegada)
const position = z.object({ latitude: lat, longitude: lng, accuracy: z.number().min(0).optional() });
router.post('/checkpoints/:id/proximity', teamOnly, perTeam(30), async (req, res) => {
  res.json(await play.proximity(req.rally, req.team, req.params.id, parse(position, req.body)));
});

// HU-08 / HU-09 / HU-10: validar llegada por GPS, QR o NFC
const arriveSchema = z
  .object({
    method: z.enum(['GEOFENCE', 'QR', 'NFC']),
    latitude: lat.optional(),
    longitude: lng.optional(),
    accuracy: z.number().min(0).optional(),
    code: z.string().max(300).optional(),
    uid: z.string().max(100).optional(),
    capturedAt,
  })
  .superRefine((d, ctx) => {
    if (d.method === 'GEOFENCE' && (d.latitude == null || d.longitude == null)) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Se requiere latitude y longitude' });
    }
    if (d.method === 'QR' && !d.code) ctx.addIssue({ code: 'custom', path: ['code'], message: 'Se requiere code' });
    if (d.method === 'NFC' && !d.code && !d.uid) ctx.addIssue({ code: 'custom', path: ['code'], message: 'Se requiere code o uid' });
  });
router.post('/checkpoints/:id/arrive', teamOnly, perTeam(30), async (req, res) => {
  res.json(await play.arrive(req.rally, req.team, req.params.id, parse(arriveSchema, req.body)));
});

router.get('/checkpoints/:id/challenge', teamOnly, async (req, res) => {
  res.json(await play.getChallenge(req.rally, req.team, req.params.id));
});

// HU-11 a HU-14, HU-21: respuesta del reto (idempotente, apta para la cola offline)
const submitSchema = z.object({
  submissionId: idKey.optional(),
  answer: z.string().max(500).optional(),
  heading: z.number().optional(),
  evidenceId: idKey.optional(),
  capturedAt,
});
router.post('/checkpoints/:id/submit', teamOnly, perTeam(30), async (req, res) => {
  const key = req.get('idempotency-key');
  const body = parse(submitSchema, req.body);
  const idempotencyKey = key ? parse(idKey, key) : undefined;
  res.json(await play.submit(req.rally, req.team, req.params.id, body, idempotencyKey));
});

// HU-18 / HU-19: bandeja de notificaciones (alternativa al stream SSE y para recuperar las perdidas)
router.get('/notifications', teamOnly, async (req, res) => {
  const after = Number(req.query.after) || 0;
  res.json({ notifications: await listNotifications({ rallyId: req.rally.id, teamId: req.team.id, afterId: after }) });
});

export default router;
