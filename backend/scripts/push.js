import { Router } from 'express';
import { z } from 'zod';
import { AppError, parse } from '../lib/errors.js';
import { authenticate, limiter } from '../middleware/index.js';
import { getPublicKey, isAllowedEndpoint, pushEnabled, removeSubscription, saveSubscription, sendTest } from '../services/push.js';

const router = Router();
const teamOnly = authenticate(['team']);
const perTeam = (limit) => limiter({ limit, key: (req) => req.team?.id ?? 'anon' });

const requireEnabled = (req, res, next) =>
  pushEnabled() ? next() : next(new AppError(503, 'PUSH_DISABLED', 'Las notificaciones push no están configuradas en el servidor'));

const base64url = z.string().min(1).regex(/^[A-Za-z0-9_-]+={0,2}$/, 'Debe ser base64url');

// Mismo formato que PushSubscription.toJSON() del navegador
const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedEndpoint, 'Endpoint de push no permitido'),
  keys: z.object({ p256dh: base64url.max(200), auth: base64url.max(100) }),
});

// Clave pública VAPID (applicationServerKey): el front la necesita antes de suscribirse. Es pública.
router.get('/public-key', (req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? getPublicKey() : null });
});

router.post('/subscribe', teamOnly, requireEnabled, perTeam(20), async (req, res) => {
  const sub = parse(subscriptionSchema, req.body);
  await saveSubscription(req.team, sub, req.get('user-agent'));
  res.status(201).json({ subscribed: true });
});

router.delete('/subscribe', teamOnly, perTeam(20), async (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(2048) }), req.body);
  await removeSubscription(req.team, endpoint);
  res.status(204).end();
});

// Envía una notificación de prueba a los dispositivos del equipo
router.post('/test', teamOnly, requireEnabled, perTeam(5), async (req, res) => {
  res.json(await sendTest(req.team));
});

export default router;
