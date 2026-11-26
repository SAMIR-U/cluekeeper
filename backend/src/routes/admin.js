import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { one, all } from '../db.js';
import { config } from '../config.js';
import { notFound, parse } from '../lib/errors.js';
import { signJoinToken } from '../lib/auth.js';
import { checkpointCode } from '../lib/crypto.js';
import { authenticate, ownedRally } from '../middleware/index.js';
import { extendTime, finishRally, publicRally, startRally, loadRally } from '../services/rallies.js';
import { ranking } from '../services/ranking.js';
import { buildReport, reportToCsv } from '../services/report.js';
import * as admin from '../services/admin.js';

const router = Router();
router.use(authenticate(['organizer']));

/* ---------- Esquemas ---------- */

const rallyInput = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, 'Usa 4-12 letras o números').optional(),
  durationMinutes: z.number().int().min(5).max(1440),
  wrongAttemptPenalty: z.number().int().min(0).max(1000).default(0),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  warningMinutes: z.array(z.number().int().min(1).max(240)).max(5).default([15, 5]),
});

const text = (max) => z.string().trim().min(1).max(max);
const challengeBase = { title: text(100), description: z.string().trim().max(500).optional(), instruction: text(500) };

const challengeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('QUESTION'),
    ...challengeBase,
    options: z.array(text(100)).min(2).max(6).optional(),
    acceptedAnswers: z.array(text(200)).min(1).max(10),
  }),
  z.object({ type: z.literal('PHOTO'), ...challengeBase }),
  z.object({ type: z.literal('AUDIO'), ...challengeBase }),
  z.object({
    type: z.literal('COMPASS'),
    ...challengeBase,
    bearing: z.number().min(0).max(360),
    tolerance: z.number().min(5).max(90).default(20),
  }),
]);

const checkpointInput = z
  .object({
    title: text(100),
    clueText: text(1000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().min(5).max(1000).default(30),
    validationMethods: z.array(z.enum(['GEOFENCE', 'QR', 'NFC'])).min(1).default(['GEOFENCE']),
    nfcUid: z.string().trim().max(50).optional(),
    hideLocation: z.boolean().default(true),
    points: z.number().int().min(0).max(1000).default(100),
    challenge: challengeSchema,
  })
  .refine((d) => !d.validationMethods.includes('NFC') || d.nfcUid, {
    path: ['nfcUid'], message: 'nfcUid es obligatorio si se admite NFC',
  });

/* ---------- Rallies ---------- */

router.post('/rallies', async (req, res) => {
  const rally = await admin.createRally(req.organizer.id, parse(rallyInput, req.body));
  res.status(201).json(await rallyAdminView(rally));
});

router.get('/rallies', async (req, res) => {
  const rows = await all('SELECT id FROM rallies WHERE organizer_id=? ORDER BY created_at DESC', req.organizer.id);
  const rallies = [];
  for (const r of rows) rallies.push(await rallyAdminView(await loadRally(r.id)));
  res.json({ rallies });
});

// HU-23: estado, tiempo y equipos registrados
router.get('/rallies/:id', async (req, res) => {
  const rally = await ownedRally(req);
  res.json({
    ...(await rallyAdminView(rally)),
    teams: await ranking(rally),
    checkpoints: (await all('SELECT * FROM checkpoints WHERE rally_id=? ORDER BY position', rally.id)).map(admin.checkpointAdminView),
  });
});

router.put('/rallies/:id', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  const d = parse(rallyInput, req.body);
  await admin.updateRally(rally.id, d);
  res.json(await rallyAdminView(await loadRally(rally.id)));
});

router.delete('/rallies/:id', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  await admin.deleteRally(rally.id);
  res.status(204).end();
});

async function rallyAdminView(rally) {
  const dummy = { extra_minutes: 0 };
  return {
    ...(await publicRally(rally, dummy)),
    code: rally.code,
    extraMinutes: rally.extra_minutes,
    finishedAt: rally.finished_at,
    finishReason: rally.finish_reason,
    wrongAttemptPenalty: rally.wrong_attempt_penalty,
    maxAttempts: rally.max_attempts,
    warningMinutes: rally.warning_minutes.split(',').map(Number),
    teamsCount: (await one('SELECT COUNT(*) AS n FROM teams WHERE rally_id=?', rally.id)).n,
  };
}

// HU-24
router.post('/rallies/:id/start', async (req, res) => {
  const rally = await startRally((await ownedRally(req)).id);
  res.json(await rallyAdminView(rally));
});

// HU-25
router.post('/rallies/:id/extend', async (req, res) => {
  const { minutes, teamId } = parse(
    z.object({ minutes: z.number().int().min(1).max(240), teamId: z.string().max(64).optional() }),
    req.body,
  );
  const rally = await extendTime((await ownedRally(req)).id, minutes, teamId ?? null);
  res.json(await rallyAdminView(rally));
});

router.post('/rallies/:id/finish', async (req, res) => {
  res.json(await rallyAdminView(await finishRally((await ownedRally(req)).id)));
});

/* ---------- QR de acceso (HU-02) ---------- */

router.get('/rallies/:id/join-qr', async (req, res) => {
  const rally = await ownedRally(req);
  // El frontend lee ?code=; el enlace con token (/join?token=) queda disponible en tokenUrl
  const url = `${config.appBaseUrl}/?code=${encodeURIComponent(rally.code)}`;
  const tokenUrl = `${config.appBaseUrl}/join?token=${encodeURIComponent(signJoinToken(rally.id))}`;
  if (req.query.format === 'json') return res.json({ url, tokenUrl, code: rally.code });
  res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
});

/* ---------- Checkpoints ---------- */

router.get('/rallies/:id/checkpoints', async (req, res) => {
  const rally = await ownedRally(req);
  res.json({
    checkpoints: (await all('SELECT * FROM checkpoints WHERE rally_id=? ORDER BY position', rally.id)).map(admin.checkpointAdminView),
  });
});

router.post('/rallies/:id/checkpoints', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  const cp = await admin.createCheckpoint(rally.id, parse(checkpointInput, req.body));
  res.status(201).json(admin.checkpointAdminView(cp));
});

router.put('/rallies/:id/checkpoints/order', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  await admin.reorderCheckpoints(rally.id, parse(z.object({ ids: z.array(z.string()) }), req.body).ids);
  res.status(204).end();
});

router.put('/rallies/:id/checkpoints/:cid', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  const cp = await admin.updateCheckpoint(rally.id, req.params.cid, parse(checkpointInput, req.body));
  res.json(admin.checkpointAdminView(cp));
});

router.delete('/rallies/:id/checkpoints/:cid', async (req, res) => {
  const rally = await ownedRally(req);
  admin.assertEditable(rally);
  await admin.deleteCheckpoint(rally.id, req.params.cid);
  res.status(204).end();
});

// QR imprimible del checkpoint (HU-09)
router.get('/rallies/:id/checkpoints/:cid/qr', async (req, res) => {
  const rally = await ownedRally(req);
  const cp = await one('SELECT * FROM checkpoints WHERE id=? AND rally_id=?', req.params.cid, rally.id);
  if (!cp) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
  res.type('image/svg+xml').send(await QRCode.toString(checkpointCode(cp), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
});

/* ---------- Resultados (HU-26) ---------- */

router.get('/rallies/:id/ranking', async (req, res) => {
  res.json({ ranking: await ranking(await ownedRally(req)) });
});

router.get('/rallies/:id/report', async (req, res) => {
  const rally = await ownedRally(req);
  const report = await buildReport(rally);
  const format = req.query.format ?? 'json';
  if (format === 'csv') {
    res.set('Content-Disposition', `attachment; filename="rally-${rally.code}-resultados.csv"`);
    return res.type('text/csv; charset=utf-8').send(reportToCsv(report));
  }
  res.json(report);
});

/* ---------- Evidencias recibidas ---------- */

router.get('/rallies/:id/evidences', async (req, res) => {
  const rally = await ownedRally(req);
  const rows = await all(
    `SELECT e.id, e.type, e.mime, e.size, e.late, e.captured_at, e.received_at, e.checkpoint_id, c.position, t.id AS team_id, t.name AS team_name
     FROM evidences e JOIN teams t ON t.id=e.team_id JOIN checkpoints c ON c.id=e.checkpoint_id
     WHERE t.rally_id=? ORDER BY e.received_at`,
    rally.id,
  );
  res.json({
    evidences: rows.map((e) => ({
      id: e.id, type: e.type, mime: e.mime, size: e.size, late: !!e.late,
      capturedAt: e.captured_at, receivedAt: e.received_at,
      checkpointId: e.checkpoint_id, checkpointPosition: e.position,
      teamId: e.team_id, teamName: e.team_name,
      fileUrl: `/api/admin/rallies/${rally.id}/evidences/${e.id}/file`,
    })),
  });
});

router.get('/rallies/:id/evidences/:eid/file', async (req, res) => {
  const rally = await ownedRally(req);
  const ev = await one(
    'SELECT e.mime, e.data FROM evidences e JOIN teams t ON t.id=e.team_id WHERE e.id=? AND t.rally_id=?',
    req.params.eid, rally.id,
  );
  if (!ev) throw notFound('EVIDENCE_NOT_FOUND', 'Evidencia no encontrada');
  res.type(ev.mime).send(Buffer.from(ev.data));
});

export default router;
