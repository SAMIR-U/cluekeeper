import { Router } from 'express';
import { authenticate } from '../middleware/index.js';
import { loadRally } from '../services/rallies.js';
import { bus, listNotifications } from '../services/notifications.js';
import { notFound } from '../lib/errors.js';

const router = Router();

// Server-Sent Events: nueva pista, aviso de tiempo, tiempo extra, fin del rally.
// Con EventSource usar { withCredentials: true }. Al reconectar, el navegador envía Last-Event-ID
// y se reenvían las notificaciones perdidas.
router.get('/', authenticate(['team', 'organizer']), (req, res) => {
  let rallyId;
  let teamId = null;
  if (req.role === 'team') {
    rallyId = req.rally.id;
    teamId = req.team.id;
  } else {
    const rally = loadRally(String(req.query.rallyId ?? ''));
    if (!rally || rally.organizer_id !== req.organizer.id) throw notFound('RALLY_NOT_FOUND', 'Rally no encontrado');
    rallyId = rally.id;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const send = (n) => res.write(`id: ${n.id}\nevent: notification\ndata: ${JSON.stringify(n)}\n\n`);

  const lastId = Number(req.get('last-event-id') ?? req.query.after ?? 0) || 0;
  if (lastId > 0) listNotifications({ rallyId, teamId, afterId: lastId }).forEach(send);

  const onNotification = (n) => {
    if (n.rallyId !== rallyId) return;
    if (teamId && n.teamId && n.teamId !== teamId) return;
    send(n);
  };
  bus.on('notification', onNotification);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('notification', onNotification);
  });
});

export default router;
