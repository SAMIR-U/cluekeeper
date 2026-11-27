import { randomUUID } from 'node:crypto';
import { one, all, run, tx } from '../db.js';
import { config } from '../config.js';
import { MIN, teamEnd } from '../lib/time.js';
import { checkGeofence, angularDiff, normalizeText } from '../lib/geo.js';
import { verifyCheckpointCode, safeEqual } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { notify } from './notifications.js';

/* ---------- Estado del equipo en la ruta ---------- */

export async function teamState(rally, team) {
  const cps = await all('SELECT * FROM checkpoints WHERE rally_id=? ORDER BY position', rally.id);
  const prog = new Map((await all('SELECT * FROM progress WHERE team_id=?', team.id)).map((p) => [p.checkpoint_id, p]));
  const started = rally.status !== 'NOT_STARTED';

  let current = null;
  let completed = 0;
  let unlockedAt = started ? Math.max(rally.started_at, team.joined_at) : null;

  const items = cps.map((cp) => {
    const p = prog.get(cp.id) ?? null;
    let status;
    if (p?.status === 'COMPLETED') status = 'COMPLETED';
    else if (!started) status = 'LOCKED';
    else if (!current) status = p?.status === 'ARRIVED' ? 'ARRIVED' : 'CLUE';
    else status = 'LOCKED';

    const item = { cp, p, status, unlockedAt: status === 'LOCKED' ? null : unlockedAt };
    if (status === 'COMPLETED') {
      completed++;
      unlockedAt = p.completed_at;
    } else if (!current && status !== 'LOCKED') {
      current = item;
    }
    return item;
  });

  return { items, current, completed, total: cps.length };
}

/* ---------- Vistas (lo que ve el participante) ---------- */

const jsonParse = (s) => JSON.parse(s);

export function clueView(cp) {
  return {
    contentId: `clue-${cp.id}`,
    checkpointId: cp.id,
    kind: 'CLUE',
    content: { title: `Pista ${cp.position}`, text: cp.clue_text },
  };
}

export function challengeView(cp) {
  const base = jsonParse(cp.challenge_json);
  return {
    contentId: `challenge-${cp.id}`,
    checkpointId: cp.id,
    kind: 'CHALLENGE',
    content: {
      ...base,
      type: cp.challenge_type,
      evidenceType: ['PHOTO', 'AUDIO'].includes(cp.challenge_type) ? cp.challenge_type : null,
      points: cp.points,
    },
  };
}

export function routeView(item) {
  const { cp, p } = item;
  return {
    id: cp.id,
    position: cp.position,
    status: item.status,
    unlockedAt: item.unlockedAt,
    arrivedAt: p?.arrived_at ?? null,
    validationMethods: jsonParse(cp.validation_methods),
    hideLocation: !!cp.hide_location,
    // La ubicación exacta solo se entrega si el reto no es de observación
    location: cp.hide_location ? null : { latitude: cp.latitude, longitude: cp.longitude, radius: cp.radius },
    points: cp.points,
    clue: clueView(cp),
    challenge: item.status === 'ARRIVED' ? challengeView(cp) : null,
  };
}

export async function routeCurrent(rally, team) {
  if (rally.status === 'NOT_STARTED') throw conflict('RALLY_NOT_STARTED', 'El rally aún no ha iniciado');
  const state = await teamState(rally, team);
  const progress = { completed: state.completed, total: state.total };
  if (!state.current) return { state: 'ALL_COMPLETED', progress, checkpoint: null };
  if (Date.now() >= teamEnd(rally, team)) return { state: 'TIME_UP', progress, checkpoint: null };
  return { state: 'ACTIVE', progress, checkpoint: routeView(state.current) };
}

export async function progressView(rally, team) {
  const state = await teamState(rally, team);
  const reviews = await all(
    'SELECT checkpoint_id, status, submitted_at, reviewed_at, review_note FROM photo_reviews WHERE team_id=? ORDER BY submitted_at DESC',
    team.id,
  );
  const latestReview = new Map();
  for (const review of reviews) if (!latestReview.has(review.checkpoint_id)) latestReview.set(review.checkpoint_id, review);
  return {
    completed: state.completed,
    total: state.total,
    checkpoints: state.items.map(({ cp, p, status, unlockedAt }) => ({
      id: cp.id,
      position: cp.position,
      // No se revela el nombre del lugar hasta que el equipo lo desbloquea
      title: status === 'LOCKED' ? null : `Pista ${cp.position}`,
      status,
      points: cp.points,
      pointsAwarded: p?.points_awarded ?? 0,
      attempts: p?.attempts ?? 0,
      reviewStatus: latestReview.get(cp.id)?.status ?? null,
      reviewSubmittedAt: latestReview.get(cp.id)?.submitted_at ?? null,
      reviewNote: latestReview.get(cp.id)?.review_note ?? '',
      unlockedAt,
      arrivedAt: p?.arrived_at ?? null,
      completedAt: p?.completed_at ?? null,
      // Tiempo por reto (HU-16)
      secondsToArrive: p?.arrived_at && unlockedAt ? Math.round((p.arrived_at - unlockedAt) / 1000) : null,
      secondsOnChallenge: p?.completed_at && p.arrived_at ? Math.round((p.completed_at - p.arrived_at) / 1000) : null,
      secondsTotal: p?.completed_at && unlockedAt ? Math.round((p.completed_at - unlockedAt) / 1000) : null,
    })),
  };
}

/* ---------- Reglas de tiempo (también para datos capturados offline) ---------- */

// Devuelve el instante efectivo de la acción: captured_at si viene de la cola offline
export function effectiveTime(rally, team, capturedAt) {
  if (rally.status === 'NOT_STARTED') throw conflict('RALLY_NOT_STARTED', 'El rally aún no ha iniciado');
  const now = Date.now();
  let t = now;

  if (capturedAt != null) {
    if (!Number.isFinite(capturedAt)) {
      throw badRequest('INVALID_CAPTURED_AT', 'La fecha de captura no es válida');
    }
    // El reloj de un teléfono puede ir adelantado o atrasado: en vez de rechazar la acción,
    // se ajusta al rango válido [inicio del rally, ahora]
    t = Math.min(Math.max(capturedAt, rally.started_at), now);
  }

  const end = teamEnd(rally, team);
  const grace = config.lateSyncGraceMinutes * MIN;
  if (t > end || now > end + grace) {
    throw conflict('TIME_EXPIRED', 'El tiempo del equipo terminó');
  }
  return { t, late: now > end };
}

/* ---------- Helpers ---------- */

async function findItem(rally, team, checkpointId) {
  const state = await teamState(rally, team);
  const item = state.items.find((i) => i.cp.id === checkpointId);
  if (!item) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
  return { state, item };
}

function requireCurrent(state, item) {
  if (item.status === 'COMPLETED') throw conflict('ALREADY_COMPLETED', 'Este checkpoint ya fue completado');
  if (state.current?.cp.id !== item.cp.id) {
    throw forbidden('CHECKPOINT_LOCKED', 'Aún no has desbloqueado este checkpoint');
  }
}

// Con ubicación oculta se redondea la distancia para dificultar deducir el punto exacto
function clientDistance(cp, meters) {
  return cp.hide_location ? Math.round(meters / 25) * 25 : Math.round(meters);
}

function geoResult(cp, position) {
  const g = checkGeofence(position, cp);
  return {
    inside: g.inside,
    distance: clientDistance(cp, g.distance),
    remaining: clientDistance(cp, g.remaining),
    ...(cp.hide_location ? {} : { radius: cp.radius }),
  };
}

/* ---------- HU-06 / HU-08: cercanía y llegada ---------- */

export async function proximity(rally, team, checkpointId, body) {
  if (rally.status !== 'IN_PROGRESS') throw conflict('RALLY_NOT_ACTIVE', 'El rally no está en curso');
  const { state, item } = await findItem(rally, team, checkpointId);
  requireCurrent(state, item);
  if (body.accuracy != null && body.accuracy > config.maxGeoAccuracyM) {
    return { reliable: false, reason: 'LOW_ACCURACY', accuracy: body.accuracy, maxAccuracy: config.maxGeoAccuracyM };
  }
  return { reliable: true, ...geoResult(item.cp, body) };
}

// Bloquea la fila del equipo: serializa sus acciones (doble toque, reintentos de la cola offline)
const lockTeam = (teamId) => one('SELECT * FROM teams WHERE id=? FOR UPDATE', teamId);

export function arrive(rally, team, checkpointId, body) {
  return tx(async () => {
    team = await lockTeam(team.id);
    const { t } = effectiveTime(rally, team, body.capturedAt);
    const { state, item } = await findItem(rally, team, checkpointId);
    requireCurrent(state, item);
    const { cp } = item;

    if (item.status === 'ARRIVED') {
      return { arrived: true, alreadyArrived: true, method: item.p.arrival_method, challenge: challengeView(cp) };
    }

    if (!jsonParse(cp.validation_methods).includes(body.method)) {
      throw unprocessable('METHOD_NOT_ALLOWED', 'Este checkpoint no admite ese método de validación');
    }

    if (body.method === 'GEOFENCE') {
      if (body.accuracy != null && body.accuracy > config.maxGeoAccuracyM) {
        return {
          arrived: false, reason: 'LOW_ACCURACY', accuracy: body.accuracy, maxAccuracy: config.maxGeoAccuracyM,
          message: 'La señal GPS es poco precisa. Acércate a un lugar abierto o usa el QR.',
        };
      }
      const geo = geoResult(cp, body);
      if (!geo.inside) return { arrived: false, reason: 'OUTSIDE_GEOFENCE', ...geo };
    } else {
      const ok =
        body.code != null
          ? verifyCheckpointCode(cp, body.code)
          : body.method === 'NFC' && cp.nfc_uid != null && body.uid != null &&
            safeEqual(String(body.uid).replace(/[^0-9a-f]/gi, '').toLowerCase(), cp.nfc_uid);
      if (!ok) return { arrived: false, reason: 'INVALID_CODE', message: 'El código no corresponde a este checkpoint' };
    }

    await run(
      `INSERT INTO progress (team_id, checkpoint_id, status, arrival_method, arrived_at)
       VALUES (?,?,'ARRIVED',?,?)
       ON CONFLICT(team_id, checkpoint_id) DO NOTHING`,
      team.id, cp.id, body.method, t,
    );
    return { arrived: true, method: body.method, arrivedAt: t, challenge: challengeView(cp) };
  });
}

export async function getChallenge(rally, team, checkpointId) {
  const { item } = await findItem(rally, team, checkpointId);
  if (item.status === 'LOCKED' || item.status === 'CLUE') {
    throw forbidden('CHECKPOINT_NOT_REACHED', 'Primero debes validar tu llegada al checkpoint');
  }
  return challengeView(item.cp);
}

/* ---------- HU-11 a HU-14: envío del reto y retroalimentación ---------- */

async function evaluate(cp, team, body) {
  const answer = jsonParse(cp.answer_json);
  switch (cp.challenge_type) {
    case 'QUESTION': {
      if (typeof body.answer !== 'string' || !body.answer.trim()) {
        throw badRequest('ANSWER_REQUIRED', 'Escribe tu respuesta');
      }
      const given = normalizeText(body.answer);
      const matchedAnswer = (answer.acceptedAnswers ?? []).find((candidate) => {
        const expected = normalizeText(candidate);
        if (expected === given) return true;
        if (!expected || !given) return false;
        const previous = Array.from({ length: expected.length + 1 }, (_, i) => i);
        for (let i = 1; i <= given.length; i++) {
          let diagonal = previous[0];
          previous[0] = i;
          for (let j = 1; j <= expected.length; j++) {
            const above = previous[j];
            previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (given[i - 1] === expected[j - 1] ? 0 : 1));
            diagonal = above;
          }
        }
        const distance = previous[expected.length];
        const shorter = Math.min(expected.length, given.length);
        const ratio = 1 - distance / Math.max(expected.length, given.length);
        return shorter >= 5 && distance <= 2 && ratio >= 0.8;
      });
      return { correct: Boolean(matchedAnswer), answerText: body.answer.trim(), matchedAnswer: matchedAnswer ?? null };
    }
    case 'COMPASS': {
      if (typeof body.heading !== 'number' || body.heading < 0 || body.heading > 360) {
        throw badRequest('HEADING_REQUIRED', 'Se requiere el rumbo (0-360)');
      }
      const correct = angularDiff(body.heading, answer.bearing) <= answer.tolerance;
      return { correct, answerText: `${body.heading}°`, matchedAnswer: `${answer.bearing}° ± ${answer.tolerance}°` };
    }
    default: {
      // PHOTO / AUDIO: la evidencia debe haberse recibido antes (sincronizada)
      const ev = body.evidenceId
        ? await one(
            'SELECT 1 AS ok FROM evidences WHERE id=? AND team_id=? AND checkpoint_id=? AND type=?',
            body.evidenceId, team.id, cp.id, cp.challenge_type,
          )
        : null;
      if (!ev) {
        throw unprocessable(
          'EVIDENCE_REQUIRED',
          'Aún no se ha recibido la evidencia. Sincroniza tu foto/audio e inténtalo de nuevo.',
        );
      }
      return { correct: true, answerText: null, matchedAnswer: null };
    }
  }
}

export function submit(rally, team, checkpointId, body, idempotencyKey) {
  const submissionId = body.submissionId ?? idempotencyKey ?? randomUUID();

  return tx(async () => {
    team = await lockTeam(team.id);
    const prev = await one('SELECT * FROM submissions WHERE id=?', submissionId);
    if (prev) {
      if (prev.team_id !== team.id) throw conflict('SUBMISSION_ID_TAKEN', 'Identificador de envío en uso');
      return { ...jsonParse(prev.result_json), replayed: true };
    }

    const { t, late } = effectiveTime(rally, team, body.capturedAt);
    const { state, item } = await findItem(rally, team, checkpointId);
    requireCurrent(state, item);
    if (item.status !== 'ARRIVED') {
      throw conflict('NOT_ARRIVED', 'Primero debes validar tu llegada al checkpoint');
    }
    const { cp } = item;

    const evaluation = await evaluate(cp, team, body);
    const { correct, answerText, matchedAnswer } = evaluation;

    // Las fotos no desbloquean el siguiente punto hasta que organización las revise.
    if (cp.challenge_type === 'PHOTO') {
      const evidenceId = body.evidenceId;
      const existingReview = await one('SELECT status FROM photo_reviews WHERE evidence_id=?', evidenceId);
      if (existingReview?.status === 'APPROVED') throw conflict('ALREADY_COMPLETED', 'Esta foto ya fue aprobada');
      if (existingReview?.status === 'REJECTED') throw conflict('EVIDENCE_REJECTED', 'Toma una fotografía nueva para volver a enviar este reto');
      if (!existingReview) {
        await run(
          `INSERT INTO photo_reviews (evidence_id, team_id, checkpoint_id, submission_id, status, submitted_at)
           VALUES (?,?,?,?,'PENDING',?)`,
          evidenceId, team.id, cp.id, submissionId, t,
        );
      }
      const result = {
        submissionId, correct: false, completed: false, pendingReview: true, pointsAwarded: 0,
        reviewStatus: existingReview?.status ?? 'PENDING',
      };
      await run(
        `INSERT INTO submissions (id, team_id, checkpoint_id, correct, late, captured_at, created_at, result_json, answer_text, matched_answer)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        submissionId, team.id, cp.id, 0, late ? 1 : 0, t, Date.now(), JSON.stringify(result), answerText, matchedAnswer,
      );
      return result;
    }

    const priorAttempts = item.p.attempts;
    const attempts = priorAttempts + 1;
    const exhausted = !correct && attempts >= rally.max_attempts;
    const completed = correct || exhausted;

    let pointsAwarded = 0;
    if (correct) pointsAwarded = Math.max(0, cp.points - rally.wrong_attempt_penalty * priorAttempts);

    let result;
    if (completed) {
      await run(
        `UPDATE progress SET status='COMPLETED', completed_at=?, points_awarded=?, attempts=?
         WHERE team_id=? AND checkpoint_id=?`,
        t, pointsAwarded, attempts, team.id, cp.id,
      );
      await run('UPDATE teams SET score = score + ? WHERE id=?', pointsAwarded, team.id);

      const after = await teamState(rally, team);
      const finished = !after.current;
      if (finished) await run('UPDATE teams SET finished_at=? WHERE id=?', t, team.id);

      const { score } = await one('SELECT score FROM teams WHERE id=?', team.id);
      if (finished) {
        await notify({
          rallyId: rally.id, teamId: team.id, type: 'ROUTE_COMPLETED',
          title: '¡Ruta completada!', body: 'Terminaste todos los checkpoints.',
        });
      } else {
        await notify({
          rallyId: rally.id, teamId: team.id, type: 'NEW_CLUE',
          title: 'Nueva pista desbloqueada', body: 'Ya puedes ver la siguiente pista.',
          data: { checkpointId: after.current.cp.id },
        });
      }
      result = {
        submissionId, correct, completed: true, pointsAwarded, score, finished,
        ...(exhausted ? { reason: 'ATTEMPTS_EXHAUSTED' } : {}),
        progress: { completed: after.completed, total: after.total },
        next: finished ? null : routeView(after.current),
      };
    } else {
      await run('UPDATE progress SET attempts=? WHERE team_id=? AND checkpoint_id=?', attempts, team.id, cp.id);
      result = {
        submissionId, correct: false, completed: false, pointsAwarded: 0,
        attemptsLeft: rally.max_attempts - attempts,
      };
    }

    await run(
      'INSERT INTO submissions (id, team_id, checkpoint_id, correct, late, captured_at, created_at, result_json, answer_text, matched_answer) VALUES (?,?,?,?,?,?,?,?,?,?)',
      submissionId, team.id, cp.id, correct ? 1 : 0, late ? 1 : 0, t, Date.now(), JSON.stringify(result), answerText, matchedAnswer,
    );
    return result;
  });
}

/* ---------- Evidencias (foto / audio) ---------- */

export async function assertEvidenceAllowed(rally, team, checkpointId, capturedAt) {
  const { t, late } = effectiveTime(rally, team, capturedAt);
  const { item } = await findItem(rally, team, checkpointId);
  // No se aceptan evidencias de checkpoints que el equipo aún no desbloquea
  if (item.status === 'LOCKED') throw forbidden('CHECKPOINT_LOCKED', 'Aún no has desbloqueado este checkpoint');
  return { t, late, cp: item.cp };
}
