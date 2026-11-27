import { Router } from 'express';
import { z } from 'zod';
import { AppError, parse } from '../lib/errors.js';
import { authenticate, limiter } from '../middleware/index.js';
import { isAllowedEndpoint, pushStatus, subscribeDevice, unsubscribeDevice } from '../services/push.js';

const router = Router();
const teamOnly = authenticate(['team']);
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{8,256}$/),
  }),
});
const endpointSchema = z.object({ endpoint: z.string().url().max(4096) });

router.get('/public-key', (req, res) => res.json(pushStatus()));

router.post('/subscribe', teamOnly, limiter({ limit: 20, key: (req) => req.team.id }), async (req, res) => {
  if (!pushStatus().enabled) throw new AppError(503, 'PUSH_DISABLED', 'Las notificaciones no están configuradas en el servidor');
  const subscription = parse(subscriptionSchema, req.body);
  if (!isAllowedEndpoint(subscription.endpoint)) throw new AppError(400, 'INVALID_PUSH_ENDPOINT', 'El servicio push no está permitido');
  await subscribeDevice(req.team, req.rally, subscription, req.get('user-agent') ?? '');
  res.status(201).json({ subscribed: true });
});

router.delete('/subscribe', teamOnly, limiter({ limit: 20, key: (req) => req.team.id }), async (req, res) => {
  const { endpoint } = parse(endpointSchema, req.body);
  if (!isAllowedEndpoint(endpoint)) throw new AppError(400, 'INVALID_PUSH_ENDPOINT', 'El servicio push no está permitido');
  await unsubscribeDevice(req.team, endpoint);
  res.status(204).end();
});

export default router;
