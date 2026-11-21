import { randomUUID } from 'node:crypto';
import { one, all, run, tx, isUniqueViolation } from '../db.js';
import { randomCode, randomSecret, checkpointCode } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';

export async function createRally(organizerId, data) {
  for (let i = 0; i < 8; i++) {
    const id = randomUUID();
    const code = data.code ?? randomCode(6);
    try {
      await run(
        `INSERT INTO rallies (id, organizer_id, name, code, duration_minutes, wrong_attempt_penalty, max_attempts, warning_minutes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, organizerId, data.name, code, data.durationMinutes, data.wrongAttemptPenalty,
        data.maxAttempts, data.warningMinutes.join(','), Date.now(),
      );
      return await one('SELECT * FROM rallies WHERE id=?', id);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (data.code) throw conflict('CODE_TAKEN', 'Ese código de rally ya está en uso');
    }
  }
  throw conflict('CODE_GENERATION_FAILED', 'No se pudo generar un código único');
}

export function assertEditable(rally) {
  if (rally.status !== 'NOT_STARTED') {
    throw conflict('RALLY_LOCKED', 'La configuración solo puede cambiarse antes de iniciar el rally');
  }
}

/* ---- Checkpoints (vista completa para el organizador, incluye secretos) ---- */

export function checkpointAdminView(cp) {
  const challenge = JSON.parse(cp.challenge_json);
  const answer = JSON.parse(cp.answer_json);
  return {
    id: cp.id,
    position: cp.position,
    title: cp.title,
    clueText: cp.clue_text,
    latitude: cp.latitude,
    longitude: cp.longitude,
    radius: cp.radius,
    validationMethods: JSON.parse(cp.validation_methods),
    nfcUid: cp.nfc_uid,
    hideLocation: !!cp.hide_location,
    points: cp.points,
    challenge: { type: cp.challenge_type, ...challenge, ...answer },
    qrPayload: checkpointCode(cp),
  };
}

function splitChallenge({ type, acceptedAnswers, bearing, tolerance, ...publicPart }) {
  const answer =
    type === 'QUESTION' ? { acceptedAnswers } : type === 'COMPASS' ? { bearing, tolerance } : {};
  return { type, publicPart, answer };
}

const normUid = (uid) => (uid ? uid.replace(/[^0-9a-f]/gi, '').toLowerCase() : null);

export function createCheckpoint(rallyId, d) {
  return tx(async () => {
    await run('SELECT 1 FROM rallies WHERE id=? FOR UPDATE', rallyId); // evita posiciones duplicadas
    const { n } = await one('SELECT COALESCE(MAX(position),0)+1 AS n FROM checkpoints WHERE rally_id=?', rallyId);
    const { type, publicPart, answer } = splitChallenge(d.challenge);
    const id = randomUUID();
    await run(
      `INSERT INTO checkpoints (id, rally_id, position, title, clue_text, latitude, longitude, radius, validation_methods,
         qr_secret, nfc_uid, hide_location, points, challenge_type, challenge_json, answer_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, rallyId, n, d.title, d.clueText, d.latitude, d.longitude, d.radius, JSON.stringify(d.validationMethods),
      randomSecret(16), normUid(d.nfcUid), d.hideLocation ? 1 : 0, d.points, type,
      JSON.stringify(publicPart), JSON.stringify(answer),
    );
    return one('SELECT * FROM checkpoints WHERE id=?', id);
  });
}

export async function updateCheckpoint(rallyId, id, d) {
  const cp = await one('SELECT * FROM checkpoints WHERE id=? AND rally_id=?', id, rallyId);
  if (!cp) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
  const { type, publicPart, answer } = splitChallenge(d.challenge);
  await run(
    `UPDATE checkpoints SET title=?, clue_text=?, latitude=?, longitude=?, radius=?, validation_methods=?, nfc_uid=?,
       hide_location=?, points=?, challenge_type=?, challenge_json=?, answer_json=? WHERE id=?`,
    d.title, d.clueText, d.latitude, d.longitude, d.radius, JSON.stringify(d.validationMethods), normUid(d.nfcUid),
    d.hideLocation ? 1 : 0, d.points, type, JSON.stringify(publicPart), JSON.stringify(answer), id,
  );
  return one('SELECT * FROM checkpoints WHERE id=?', id);
}

export function deleteCheckpoint(rallyId, id) {
  return tx(async () => {
    const r = await run('DELETE FROM checkpoints WHERE id=? AND rally_id=?', id, rallyId);
    if (!r.changes) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
    await compact(rallyId);
  });
}

async function compact(rallyId) {
  const rows = await all('SELECT id FROM checkpoints WHERE rally_id=? ORDER BY position', rallyId);
  await setOrder(rows.map((r) => r.id));
}

// Dos fases (negativos y luego positivos) para no chocar con UNIQUE (rally_id, position)
async function setOrder(ids) {
  for (const [i, id] of ids.entries()) await run('UPDATE checkpoints SET position=? WHERE id=?', -(i + 1), id);
  for (const [i, id] of ids.entries()) await run('UPDATE checkpoints SET position=? WHERE id=?', i + 1, id);
}

export function reorderCheckpoints(rallyId, ids) {
  return tx(async () => {
    const current = (await all('SELECT id FROM checkpoints WHERE rally_id=?', rallyId)).map((r) => r.id).sort();
    if (current.length !== ids.length || [...ids].sort().some((id, i) => id !== current[i])) {
      throw conflict('INVALID_ORDER', 'La lista debe contener exactamente los checkpoints del rally');
    }
    await setOrder(ids);
  });
}

export async function updateRally(id, d) {
  try {
    await run(
      `UPDATE rallies SET name=?, code=COALESCE(?, code), duration_minutes=?, wrong_attempt_penalty=?, max_attempts=?, warning_minutes=? WHERE id=?`,
      d.name, d.code ?? null, d.durationMinutes, d.wrongAttemptPenalty, d.maxAttempts, d.warningMinutes.join(','), id,
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('CODE_TAKEN', 'Ese código de rally ya está en uso');
    throw e;
  }
}

export function deleteRally(id) {
  return run('DELETE FROM rallies WHERE id=?', id);
}
