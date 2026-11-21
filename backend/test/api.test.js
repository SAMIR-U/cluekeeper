import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
process.env.RATE_LIMIT = 'off';
process.env.CORS_ORIGINS = 'http://localhost:5173';

const { createApp } = await import('../src/app.js');
const { createOrganizer } = await import('../src/services/bootstrap.js');
const { run } = await import('../src/db.js');
const { tick } = await import('../src/services/ticker.js');

let server;
let base;

before(async () => {
  createOrganizer('org@test.dev', 'clave-segura-1', 'Org');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

async function call(method, url, { token, body, headers = {}, form } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const pngForm = (fields, buf = PNG, name = 'x.jpg') => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('file', new Blob([buf]), name);
  return f;
};

const state = {};

test('organizador: login y configuración del rally', async () => {
  const bad = await call('POST', '/api/auth/organizer/login', { body: { email: 'org@test.dev', password: 'mala' } });
  assert.equal(bad.status, 401);

  const login = await call('POST', '/api/auth/organizer/login', { body: { email: 'org@test.dev', password: 'clave-segura-1' } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /ck_session=.*HttpOnly/i);
  state.org = login.data.token;

  const rally = await call('POST', '/api/admin/rallies', {
    token: state.org, body: { name: 'Rally Test', durationMinutes: 60, wrongAttemptPenalty: 10, maxAttempts: 2 },
  });
  assert.equal(rally.status, 201);
  state.rally = rally.data;

  const common = { latitude: 4.6, longitude: -74.07, radius: 50, points: 100 };
  const cps = [
    { ...common, title: 'A', clueText: 'Pista A', validationMethods: ['GEOFENCE'],
      challenge: { type: 'QUESTION', title: 'Q', instruction: '¿Color?', acceptedAnswers: ['Rojo'] } },
    { ...common, title: 'B', clueText: 'Pista B', validationMethods: ['GEOFENCE', 'QR'],
      challenge: { type: 'PHOTO', title: 'F', instruction: 'Foto' } },
    { ...common, title: 'C', clueText: 'Pista C', validationMethods: ['QR'],
      challenge: { type: 'COMPASS', title: 'Br', instruction: 'Norte', bearing: 350, tolerance: 20 } },
  ];
  state.cps = [];
  for (const cp of cps) {
    const r = await call('POST', `/api/admin/rallies/${state.rally.id}/checkpoints`, { token: state.org, body: cp });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    state.cps.push(r.data);
  }

  const qr = await call('GET', `/api/admin/rallies/${state.rally.id}/join-qr`, { token: state.org });
  assert.match(qr.data, /<svg/);
});

test('HU-01/03: unirse con código, estado del rally, y rutas protegidas', async () => {
  const bad = await call('POST', '/api/auth/team/join', { body: { code: 'NOPE00', teamName: 'Lobos' } });
  assert.equal(bad.status, 404);
  assert.equal(bad.data.error.code, 'INVALID_RALLY_CODE');

  const join = await call('POST', '/api/auth/team/join', { body: { code: state.rally.code.toLowerCase(), teamName: ' Los  Lobos ' } });
  assert.equal(join.status, 201);
  assert.equal(join.data.team.name, 'Los Lobos');
  state.team = join.data.token;
  state.teamKey = join.data.teamKey;

  const dup = await call('POST', '/api/auth/team/join', { body: { code: state.rally.code, teamName: 'los lobos' } });
  assert.equal(dup.status, 409);

  const resume = await call('POST', '/api/auth/team/resume', { body: { code: state.rally.code, teamName: 'Los Lobos', teamKey: state.teamKey } });
  assert.equal(resume.status, 200);

  const st = await call('GET', '/api/rally', { token: state.team });
  assert.equal(st.data.rally.status, 'NOT_STARTED');
  assert.equal((await call('GET', '/api/route/current', { token: state.team })).status, 409);

  assert.equal((await call('GET', '/api/rally')).status, 401);
  assert.equal((await call('GET', `/api/admin/rallies/${state.rally.id}`, { token: state.team })).status, 403);

  const evil = await call('POST', '/api/auth/organizer/login', {
    headers: { Origin: 'https://evil.example' }, body: { email: 'org@test.dev', password: 'clave-segura-1' },
  });
  assert.equal(evil.status, 403);
});

test('HU-24 + HU-04/06/08/14: iniciar, ver pista, geocerca, reto y siguiente pista', async () => {
  assert.equal((await call('POST', `/api/admin/rallies/${state.rally.id}/start`, { token: state.org })).status, 200);
  assert.equal((await call('POST', `/api/admin/rallies/${state.rally.id}/start`, { token: state.org })).status, 409);
  assert.equal((await call('POST', `/api/admin/rallies/${state.rally.id}/checkpoints`, { token: state.org, body: {} })).status, 409);

  const route = await call('GET', '/api/route/current', { token: state.team });
  assert.equal(route.data.state, 'ACTIVE');
  const cp = route.data.checkpoint;
  assert.equal(cp.clue.kind, 'CLUE');
  assert.equal(cp.location, null, 'no debe revelar la ubicación');
  assert.equal(cp.challenge, null);
  assert.ok(!JSON.stringify(route.data).includes('Rojo'));

  // sin llegar no se ve el reto
  assert.equal((await call('GET', `/api/checkpoints/${cp.id}/challenge`, { token: state.team })).status, 403);
  // no puede adelantarse al siguiente
  assert.equal((await call('POST', `/api/checkpoints/${state.cps[1].id}/arrive`, { token: state.team, body: { method: 'GEOFENCE', latitude: 4.6, longitude: -74.07 } })).status, 403);

  const far = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'GEOFENCE', latitude: 4.61, longitude: -74.07, accuracy: 10 } });
  assert.equal(far.data.arrived, false);
  assert.equal(far.data.reason, 'OUTSIDE_GEOFENCE');
  assert.ok(far.data.remaining > 900);

  const prox = await call('POST', `/api/checkpoints/${cp.id}/proximity`, { token: state.team, body: { latitude: 4.61, longitude: -74.07 } });
  assert.equal(prox.data.distance % 25, 0);

  const lowAcc = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'GEOFENCE', latitude: 4.6, longitude: -74.07, accuracy: 500 } });
  assert.equal(lowAcc.data.reason, 'LOW_ACCURACY');

  const ok = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'GEOFENCE', latitude: 4.6001, longitude: -74.07, accuracy: 10 } });
  assert.equal(ok.data.arrived, true);
  assert.equal(ok.data.challenge.content.type, 'QUESTION');
  assert.ok(!JSON.stringify(ok.data).includes('Rojo'));

  const wrong = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { answer: 'azul' } });
  assert.equal(wrong.data.correct, false);
  assert.equal(wrong.data.attemptsLeft, 1);

  const key = 'sub-0000-0001';
  const right = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, headers: { 'Idempotency-Key': key }, body: { answer: ' ROJO! ' } });
  assert.equal(right.data.correct, true);
  assert.equal(right.data.pointsAwarded, 90, 'penaliza 10 por el intento fallido');
  assert.equal(right.data.next.clue.checkpointId, state.cps[1].id);
  assert.equal(right.data.progress.completed, 1);

  const replay = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, headers: { 'Idempotency-Key': key }, body: { answer: 'x' } });
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.pointsAwarded, 90);

  const again = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { answer: 'rojo' } });
  assert.equal(again.status, 409);

  const notes = await call('GET', '/api/notifications', { token: state.team });
  assert.deepEqual(notes.data.notifications.map((n) => n.type), ['RALLY_STARTED', 'NEW_CLUE']);
});

test('HU-11/21/22: evidencia con idempotencia, validación y reto de foto', async () => {
  const cp = state.cps[1];
  const id = 'ev-test-0001';
  const fields = { evidenceId: id, checkpointId: cp.id, type: 'PHOTO' };

  const fake = await call('POST', '/api/evidences', { token: state.team, form: pngForm(fields, Buffer.from('no soy una imagen, solo texto largo')) });
  assert.equal(fake.status, 415);
  const wrongType = await call('POST', '/api/evidences', { token: state.team, form: pngForm({ ...fields, type: 'AUDIO' }) });
  assert.equal(wrongType.status, 415);
  const future = await call('POST', '/api/evidences', { token: state.team, form: pngForm({ ...fields, checkpointId: state.cps[2].id }) });
  assert.equal(future.status, 403);

  // aún sin evidencia: el reto no se acepta
  await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'QR', code: `CK1.${cp.id}.${cp.qrPayload.split('.')[2]}` } });
  const early = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { evidenceId: id } });
  assert.equal(early.status, 422);

  const up = await call('POST', '/api/evidences', { token: state.team, headers: { 'Idempotency-Key': id }, form: pngForm(fields) });
  assert.equal(up.status, 201);
  assert.equal(up.data.evidenceId, id);
  assert.equal(up.data.status, 'RECEIVED');

  const dup = await call('POST', '/api/evidences', { token: state.team, headers: { 'Idempotency-Key': id }, form: pngForm(fields) });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.replayed, true);

  const mismatch = await call('POST', '/api/evidences', { token: state.team, headers: { 'Idempotency-Key': 'otro-id-1234' }, form: pngForm(fields) });
  assert.equal(mismatch.status, 400);

  const done = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { evidenceId: id } });
  assert.equal(done.data.correct, true);
  assert.equal(done.data.pointsAwarded, 100);
});

test('HU-09/12: QR inválido/válido y brújula; ruta completada, ranking y progreso', async () => {
  const cp = state.cps[2];
  const bad = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'QR', code: `CK1.${cp.id}.mal` } });
  assert.equal(bad.data.arrived, false);
  const notAllowed = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'GEOFENCE', latitude: 4.6, longitude: -74.07 } });
  assert.equal(notAllowed.status, 422);

  const ok = await call('POST', `/api/checkpoints/${cp.id}/arrive`, { token: state.team, body: { method: 'QR', code: cp.qrPayload } });
  assert.equal(ok.data.arrived, true);

  const off = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { heading: 180 } });
  assert.equal(off.data.correct, false);
  const good = await call('POST', `/api/checkpoints/${cp.id}/submit`, { token: state.team, body: { heading: 5 } }); // 350° ± 20° (cruza el 0)
  assert.equal(good.data.correct, true);
  assert.equal(good.data.finished, true);
  assert.equal(good.data.next, null);
  assert.equal(good.data.score, 90 + 100 + 90);

  const route = await call('GET', '/api/route/current', { token: state.team });
  assert.equal(route.data.state, 'ALL_COMPLETED');

  const prog = await call('GET', '/api/progress', { token: state.team });
  assert.equal(prog.data.completed, 3);
  assert.ok(prog.data.checkpoints.every((c) => c.status === 'COMPLETED' && c.secondsTotal != null));

  const rank = await call('GET', '/api/ranking', { token: state.team });
  assert.equal(rank.data.me.rank, 1);
  assert.equal(rank.data.me.finished, true);
});

test('HU-25/23/26: tiempo extra, reapertura tras vencer, reporte CSV seguro', async () => {
  const join = await call('POST', '/api/auth/team/join', { body: { code: state.rally.code, teamName: '=HYPERLINK("x")' } });
  const t2 = join.data.team.id;

  // Simula que el rally lleva 61 min (vencido) -> se cierra al consultarlo
  run('UPDATE rallies SET started_at = ? WHERE id=?', Date.now() - 61 * 60_000, state.rally.id);
  const st = await call('GET', '/api/rally', { token: join.data.token });
  assert.equal(st.data.rally.status, 'FINISHED');
  assert.equal((await call('POST', `/api/checkpoints/${state.cps[0].id}/proximity`, { token: join.data.token, body: { latitude: 4.6, longitude: -74.07 } })).status, 409);

  const tiny = await call('POST', `/api/admin/rallies/${state.rally.id}/extend`, { token: state.org, body: { minutes: 0 } });
  assert.equal(tiny.status, 400);
  const ext = await call('POST', `/api/admin/rallies/${state.rally.id}/extend`, { token: state.org, body: { minutes: 10, teamId: t2 } });
  assert.equal(ext.status, 200);
  assert.equal(ext.data.status, 'IN_PROGRESS');

  const mine = await call('GET', '/api/rally', { token: join.data.token });
  assert.ok(mine.data.rally.remainingSeconds > 8 * 60 && mine.data.rally.remainingSeconds <= 10 * 60);
  const notes = await call('GET', '/api/notifications', { token: join.data.token });
  assert.ok(notes.data.notifications.some((n) => n.type === 'TIME_EXTENDED'));

  // aviso de poco tiempo (HU-19): al equipo 2 le quedan ~10 min (< 15)
  tick();
  const warn = await call('GET', '/api/notifications', { token: join.data.token });
  assert.ok(warn.data.notifications.some((n) => n.type === 'TIME_WARNING'));
  tick();
  const warn2 = await call('GET', '/api/notifications', { token: join.data.token });
  assert.equal(warn2.data.notifications.filter((n) => n.type === 'TIME_WARNING').length, 1, 'no repite el aviso');

  const overview = await call('GET', `/api/admin/rallies/${state.rally.id}`, { token: state.org });
  assert.equal(overview.data.teamsCount, 2);
  assert.equal(overview.data.teams.length, 2);

  const csv = await call('GET', `/api/admin/rallies/${state.rally.id}/report?format=csv`, { token: state.org });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.data.includes("'=HYPERLINK"), 'neutraliza fórmulas');
  const json = await call('GET', `/api/admin/rallies/${state.rally.id}/report`, { token: state.org });
  assert.equal(json.data.teams[0].rank, 1);
  assert.equal(json.data.teams[0].score, 280);

  const evs = await call('GET', `/api/admin/rallies/${state.rally.id}/evidences`, { token: state.org });
  assert.equal(evs.data.evidences.length, 1);
  const file = await fetch(base + evs.data.evidences[0].fileUrl, { headers: { Authorization: `Bearer ${state.org}` } });
  assert.equal(file.headers.get('content-type'), 'image/png');

  const fin = await call('POST', `/api/admin/rallies/${state.rally.id}/finish`, { token: state.org });
  assert.equal(fin.status, 200);
  assert.equal((await call('POST', `/api/admin/rallies/${state.rally.id}/extend`, { token: state.org, body: { minutes: 5 } })).status, 409);
});

test('otro organizador no accede a rallies ajenos', async () => {
  createOrganizer('otro@test.dev', 'clave-segura-2');
  const login = await call('POST', '/api/auth/organizer/login', { body: { email: 'otro@test.dev', password: 'clave-segura-2' } });
  const r = await call('GET', `/api/admin/rallies/${state.rally.id}`, { token: login.data.token });
  assert.equal(r.status, 404);
});

test('SSE entrega notificaciones por el stream', async () => {
  const org = state.org;
  const rally = await call('POST', '/api/admin/rallies', { token: org, body: { name: 'SSE', durationMinutes: 30 } });
  await call('POST', `/api/admin/rallies/${rally.data.id}/checkpoints`, {
    token: org,
    body: { title: 'X', clueText: 'x', latitude: 1, longitude: 1, challenge: { type: 'PHOTO', title: 't', instruction: 'i' } },
  });
  const join = await call('POST', '/api/auth/team/join', { body: { code: rally.data.code, teamName: 'Stream' } });

  const ac = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${join.data.token}` }, signal: ac.signal });
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const reader = res.body.getReader();
  await call('POST', `/api/admin/rallies/${rally.data.id}/start`, { token: org });

  let text = '';
  const dec = new TextDecoder();
  while (!text.includes('RALLY_STARTED')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  ac.abort();
  assert.match(text, /event: notification/);
  assert.match(text, /RALLY_STARTED/);
});
