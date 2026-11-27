import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { all, one, run, tx } from '../db.js';
import { config } from '../config.js';
import { bus } from './notifications.js';

const MAX_SUBSCRIPTIONS = 5;
let sender = webpush;
let publicKey = config.vapidPublicKey;
let initialized = false;
let notificationHandler;

const endpointId = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

export function isAllowedEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return config.pushAllowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function initPush(overrides = {}) {
  if (notificationHandler) bus.off('notification', notificationHandler);
  sender = overrides.send ? { sendNotification: overrides.send } : webpush;
  publicKey = overrides.key ?? config.vapidPublicKey;
  if (!overrides.send && config.vapidPublicKey && config.vapidPrivateKey) {
    sender.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  }
  initialized = Boolean(overrides.send || (config.vapidPublicKey && config.vapidPrivateKey));
  notificationHandler = (notification) => {
    if (!initialized) return;
    void sendToSubscribers(notification).catch((error) => console.error('[push] envío fallido:', error));
  };
  bus.on('notification', notificationHandler);
  return initialized;
}

export function pushStatus() {
  return { enabled: initialized && Boolean(publicKey), publicKey: initialized ? publicKey : null };
}

export async function subscribeDevice(team, rally, subscription, userAgent = '') {
  const id = endpointId(subscription.endpoint);
  const now = Date.now();
  await tx(async () => {
    await one('SELECT id FROM teams WHERE id=? FOR UPDATE', team.id);
    await run(
      `INSERT INTO push_subscriptions (id, team_id, rally_id, endpoint, p256dh, auth, user_agent, created_at, last_ok_at, failures)
       VALUES (?,?,?,?,?,?,?,?,?,0)
       ON CONFLICT (id) DO UPDATE SET team_id=EXCLUDED.team_id, rally_id=EXCLUDED.rally_id,
         p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent,
         created_at=EXCLUDED.created_at, last_ok_at=EXCLUDED.last_ok_at, failures=0`,
      id, team.id, rally.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth,
      userAgent.slice(0, 300), now, now,
    );
    const excess = await all(
      'SELECT id FROM push_subscriptions WHERE team_id=? ORDER BY created_at DESC, id DESC OFFSET ?',
      team.id, MAX_SUBSCRIPTIONS,
    );
    for (const row of excess) await run('DELETE FROM push_subscriptions WHERE id=? AND team_id=?', row.id, team.id);
  });
}

export async function unsubscribeDevice(team, endpoint) {
  await run('DELETE FROM push_subscriptions WHERE id=? AND team_id=?', endpointId(endpoint), team.id);
}

async function sendOne(row, payload, options) {
  const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  try {
    await sender.sendNotification(subscription, JSON.stringify(payload), options);
    await run('UPDATE push_subscriptions SET last_ok_at=?, failures=0 WHERE id=?', Date.now(), row.id);
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await run('DELETE FROM push_subscriptions WHERE id=?', row.id);
      return false;
    }
    await run('UPDATE push_subscriptions SET failures=failures+1 WHERE id=?', row.id);
    throw error;
  }
  return true;
}

async function sendToSubscribers(notification) {
  const rows = notification.teamId
    ? await all('SELECT * FROM push_subscriptions WHERE team_id=? AND rally_id=?', notification.teamId, notification.rallyId)
    : await all('SELECT * FROM push_subscriptions WHERE rally_id=?', notification.rallyId);
  const tag = `${notification.type}-${notification.teamId ?? notification.rallyId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const payload = {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    tag,
    url: '/',
  };
  const options = { TTL: 300, urgency: 'high', topic: tag };
  if (!rows.length) {
    console.warn(`[push] sin dispositivos suscritos para ${notification.type} (${notification.rallyId})`);
    return;
  }
  const results = await Promise.allSettled(rows.map((row) => sendOne(row, payload, options)));
  for (const result of results) {
    if (result.status === 'rejected') console.error('[push] no se pudo entregar una notificación:', result.reason?.statusCode ?? result.reason?.message ?? 'error');
  }
}

export async function sendTestNotification(team) {
  const rows = await all('SELECT * FROM push_subscriptions WHERE team_id=?', team.id);
  const payload = { id: `test-${Date.now()}`, type: 'TEST', title: 'Notificaciones activadas', body: 'ClueKeeper puede avisarte de las pistas y del tiempo.', data: {}, tag: 'cluekeeper-test', url: '/' };
  const results = await Promise.allSettled(rows.map((row) => sendOne(row, payload, { TTL: 300, urgency: 'high', topic: 'cluekeeper-test' })));
  for (const result of results) {
    if (result.status === 'rejected') console.error('[push] falló la notificación de prueba:', result.reason?.statusCode ?? result.reason?.message ?? 'error');
  }
  return { sent: results.filter((item) => item.status === 'fulfilled' && item.value).length };
}
