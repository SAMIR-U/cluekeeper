import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.DATABASE_URL) process.env.PGLITE_DIR = ':memory:';
process.env.RATE_LIMIT = 'off';
process.env.CORS_ORIGINS = 'http://localhost:5173';

const { createApp } = await import('../src/app.js');
const { createOrganizer } = await import('../src/services/bootstrap.js');
const { closeDb, one } = await import('../src/db.js');
const { initPush, isAllowedEndpoint } = await import('../src/services/push.js');

// Emisor falso: guarda cada envío y permite simular que un endpoint ya no existe (410)
const sent = [];
const gone = new Set();
initPush({
  key: 'BTest-public-key',
  send: async (subscription, payload, options) => {
    if (gone.has(subscription.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
  },
});

let server;
let base;

before(async () => {
  await createOrganizer('org@push.dev', 'clave-segura-1', 'Org');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  server.close();
  await closeDb();
});

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}

// El envío push es asíncrono respecto a la petición HTTP: se espera a que llegue
const waitFor = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('Tiempo agotado esperando el envío push');
};

const subOf = (n) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/dispositivo-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

const state = {};

test('validación de endpoints: solo https hacia servicios push conocidos', () => {
  assert.ok(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(isAllowedEndpoint('https://web.push.apple.com/abc'));
  assert.ok(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/?token=abc'));
  assert.ok(!isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'), 'solo https');
  assert.ok(!isAllowedEndpoint('https://localhost/x'));
  assert.ok(!isAllowedEndpoint('https://169.254.169.254/latest/meta-data'));
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com.evil.example/x'), 'sufijo engañoso');
  assert.ok(!isAllowedEndpoint('https://evilgoogleapis.com/x'));
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com:8443/x'), 'puerto distinto');
  assert.ok(!isAllowedEndpoint('no es una url'));
});

test('clave pública VAPID disponible sin sesión y suscripción protegida', async () => {
  const pk = await call('GET', '/api/push/public-key');
  assert.equal(pk.status, 200);
  assert.equal(pk.data.enabled, true);
  assert.equal(pk.data.publicKey, 'BTest-public-key');
  assert.equal((await call('POST', '/api/push/subscribe', { body: subOf(1) })).status, 401);
});

test('suscribir equipos, rechazar endpoints no permitidos y datos inválidos', async () => {
  const login = await call('POST', '/api/auth/organizer/login', { body: { email: 'org@push.dev', password: 'clave-segura-1' } });
  state.org = login.data.token;
  const rally = await call('POST', '/api/admin/rallies', { token: state.org, body: { name: 'Push', durationMinutes: 60 } });
  state.rally = rally.data;
  await call('POST', `/api/admin/rallies/${state.rally.id}/checkpoints`, {
    token: state.org,
    body: { title: 'A', clueText: 'a', latitude: 1, longitude: 1, challenge: { type: 'QUESTION', title: 'q', instruction: 'i', acceptedAnswers: ['si'] } },
  });

  const a = await call('POST', '/api/auth/team/join', { body: { code: state.rally.code, teamName: 'Equipo A' } });
  const b = await call('POST', '/api/auth/team/join', { body: { code: state.rally.code, teamName: 'Equipo B' } });
  state.a = { token: a.data.token, id: a.data.team.id };
  state.b = { token: b.data.token, id: b.data.team.id };

  assert.equal((await call('POST', '/api/push/subscribe', { token: state.a.token, body: subOf('a') })).status, 201);
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.b.token, body: subOf('b') })).status, 201);
  // re-suscribir el mismo dispositivo no duplica
  assert.equal((await call('POST', '/api/push/subscribe', { token: state.a.token, body: subOf('a') })).status, 201);
  assert.equal((await one('SELECT COUNT(*) AS n FROM push_subscriptions')).n, 2);

  const ssrf = await call('POST', '/api/push/subscribe', { token: state.a.token, body: { ...subOf('x'), endpoint: 'https://169.254.169.254/latest' } });
  assert.equal(ssrf.status, 400);
  const noKeys = await call('POST', '/api/push/subscribe', { token: state.a.token, body: { endpoint: subOf('y').endpoint } });
  assert.equal(noKeys.status, 400);
});

test('iniciar el rally envía push a todos los equipos con urgencia alta', async () => {
  sent.length = 0;
  assert.equal((await call('POST', `/api/admin/rallies/${state.rally.id}/start`, { token: state.org })).status, 200);
  await waitFor(() => sent.length >= 2);

  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [subOf('a').endpoint, subOf('b').endpoint]);
  const first = sent[0];
  assert.equal(first.payload.type, 'RALLY_STARTED');
  assert.equal(first.payload.title, '¡El rally comenzó!');
  assert.equal(first.payload.url, '/');
  assert.equal(first.options.urgency, 'high');
  assert.ok(first.options.TTL > 0);
  assert.ok(first.options.topic.length <= 32);
});

test('un aviso dirigido (tiempo extra a un equipo) solo llega a ese equipo', async () => {
  sent.length = 0;
  const ext = await call('POST', `/api/admin/rallies/${state.rally.id}/extend`, { token: state.org, body: { minutes: 5, teamId: state.b.id } });
  assert.equal(ext.status, 200);
  await waitFor(() => sent.length >= 1);
  await new Promise((r) => setTimeout(r, 100)); // por si hubiera un envío extra indebido
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, subOf('b').endpoint);
  assert.equal(sent[0].payload.type, 'TIME_EXTENDED');
});

test('endpoint caducado (410) se elimina; los demás siguen recibiendo', async () => {
  gone.add(subOf('b').endpoint);
  sent.length = 0;
  await call('POST', `/api/admin/rallies/${state.rally.id}/extend`, { token: state.org, body: { minutes: 1 } });
  await waitFor(() => sent.length >= 1);
  // espera a que se procese el borrado del 410
  const end = Date.now() + 3000;
  let n;
  do {
    n = (await one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE team_id=?', state.b.id)).n;
    if (n === 0) break;
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < end);
  assert.equal(n, 0, 'la suscripción 410 debe borrarse');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, subOf('a').endpoint);
});

test('notificación de prueba y baja de la suscripción', async () => {
  sent.length = 0;
  const t = await call('POST', '/api/push/test', { token: state.a.token });
  assert.equal(t.status, 200);
  assert.equal(t.data.sent, 1);
  assert.equal(sent[0].payload.type, 'TEST');

  const del = await call('DELETE', '/api/push/subscribe', { token: state.a.token, body: { endpoint: subOf('a').endpoint } });
  assert.equal(del.status, 204);
  assert.equal((await one('SELECT COUNT(*) AS n FROM push_subscriptions')).n, 0);

  // un equipo no puede dar de baja el dispositivo de otro
  await call('POST', '/api/push/subscribe', { token: state.b.token, body: subOf('b2') });
  await call('DELETE', '/api/push/subscribe', { token: state.a.token, body: { endpoint: subOf('b2').endpoint } });
  assert.equal((await one('SELECT COUNT(*) AS n FROM push_subscriptions')).n, 1);
});

test('máximo de dispositivos por equipo: se conservan los más recientes', async () => {
  for (let i = 0; i < 7; i++) {
    await call('POST', '/api/push/subscribe', { token: state.a.token, body: subOf(`m${i}`) });
    await new Promise((r) => setTimeout(r, 3)); // created_at distinto
  }
  const n = (await one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE team_id=?', state.a.id)).n;
  assert.equal(n, 5);
});
