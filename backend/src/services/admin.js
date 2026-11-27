import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, all, run, tx } from '../db.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { randomCode, randomSecret, checkpointCode } from '../lib/crypto.js';

// Servicio de administración: CRUD de rallies y checkpoints.
// Lo usan routes/admin.js (panel del organizador) y services/seedRally.js (carga del Rally UPTC).

const jsonParse = (s) => JSON.parse(s);

/* ---------- Rallies ---------- */

// Edición permitida solo antes de iniciar (la configuración queda bloqueada después)
export function assertEditable(rally) {
  if (rally.status !== 'NOT_STARTED') {
    throw conflict('RALLY_LOCKED', 'El rally ya inició: su configuración no se puede modificar');
  }
}

// Inserta sin lanzar excepción por código duplicado (dentro de una transacción de Postgres
// un error de unicidad dejaría la transacción abortada)
async function insertRally(organizerId, d, code) {
  const id = randomUUID();
  const r = await run(
    `INSERT INTO rallies (id, organizer_id, name, code, duration_minutes, wrong_attempt_penalty, max_attempts, warning_minutes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (code) DO NOTHING`,
    id, organizerId, d.name, code, d.durationMinutes, d.wrongAttemptPenalty ?? 0, d.maxAttempts ?? 3,
    (d.warningMinutes ?? [15, 5]).join(','), Date.now(),
  );
  return r.changes === 1 ? id : null;
}

export async function createRally(organizerId, d) {
  if (d.code) {
    const id = await insertRally(organizerId, d, d.code.trim().toUpperCase());
    if (!id) throw conflict('RALLY_CODE_TAKEN', 'Ya existe un rally con ese código');
    return one('SELECT * FROM rallies WHERE id=?', id);
  }
  for (let i = 0; i < 10; i++) {
    const id = await insertRally(organizerId, d, randomCode(6));
    if (id) return one('SELECT * FROM rallies WHERE id=?', id);
  }
  throw conflict('RALLY_CODE_TAKEN', 'No se pudo generar un código único; inténtalo de nuevo');
}

// Crea una edición limpia a partir de un rally finalizado y conserva intactos sus resultados.
export function createNewEdition(rallyId) {
  return tx(async () => {
    const source = await one('SELECT * FROM rallies WHERE id=? FOR UPDATE', rallyId);
    if (!source) throw notFound('RALLY_NOT_FOUND', 'Rally no encontrado');
    if (source.status !== 'FINISHED') {
      throw conflict('RALLY_NOT_FINISHED', 'Solo puedes crear una nueva edición cuando el rally haya finalizado');
    }

    const suffix = ' · Nueva edición';
    const definition = {
      name: `${source.name.slice(0, 80 - suffix.length).trimEnd()}${suffix}`,
      // Cada edición nueva del rally adopta la duración configurada en el backend.
      // La edición ya creada conserva su duración para no alterar una partida en curso.
      durationMinutes: config.rallyDurationMinutes,
      wrongAttemptPenalty: source.wrong_attempt_penalty,
      maxAttempts: source.max_attempts,
      warningMinutes: source.warning_minutes.split(',').map(Number),
    };
    let newId = null;
    for (let i = 0; i < 10 && !newId; i++) newId = await insertRally(source.organizer_id, definition, randomCode(6));
    if (!newId) throw conflict('RALLY_CODE_TAKEN', 'No se pudo generar un código único; inténtalo de nuevo');

    const checkpoints = await all('SELECT * FROM checkpoints WHERE rally_id=? ORDER BY position', rallyId);
    for (const checkpoint of checkpoints) {
      await run(
        `INSERT INTO checkpoints
          (id, rally_id, position, title, clue_text, latitude, longitude, radius, validation_methods, qr_secret,
           nfc_uid, hide_location, points, challenge_type, challenge_json, answer_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        randomUUID(), newId, checkpoint.position, checkpoint.title, checkpoint.clue_text,
        checkpoint.latitude, checkpoint.longitude, checkpoint.radius, checkpoint.validation_methods,
        randomSecret(), checkpoint.nfc_uid, checkpoint.hide_location, checkpoint.points,
        checkpoint.challenge_type, checkpoint.challenge_json, checkpoint.answer_json,
      );
    }
    return one('SELECT * FROM rallies WHERE id=?', newId);
  });
}

export async function updateRally(rallyId, d) {
  return tx(async () => {
    if (d.code) {
      const code = d.code.trim().toUpperCase();
      const clash = await one('SELECT id FROM rallies WHERE code=? AND id<>?', code, rallyId);
      if (clash) throw conflict('RALLY_CODE_TAKEN', 'Ya existe un rally con ese código');
      await run('UPDATE rallies SET code=? WHERE id=?', code, rallyId);
    }
    await run(
      `UPDATE rallies SET name=?, duration_minutes=?, wrong_attempt_penalty=?, max_attempts=?, warning_minutes=? WHERE id=?`,
      d.name, d.durationMinutes, d.wrongAttemptPenalty ?? 0, d.maxAttempts ?? 3, (d.warningMinutes ?? [15, 5]).join(','), rallyId,
    );
    return one('SELECT * FROM rallies WHERE id=?', rallyId);
  });
}

export async function deleteRally(rallyId) {
  await run('DELETE FROM rallies WHERE id=?', rallyId); // equipos, checkpoints y avisos caen en cascada
}

/* ---------- Checkpoints ---------- */

// Separa lo que ve el participante (challenge_json) de las respuestas correctas (answer_json)
function splitChallenge(challenge) {
  // eslint-disable-next-line no-unused-vars
  const { type, acceptedAnswers, bearing, tolerance, ...visible } = challenge;
  let answer = {};
  if (type === 'QUESTION') answer = { acceptedAnswers };
  if (type === 'COMPASS') answer = { bearing, tolerance: tolerance ?? 20 };
  return { type, visible, answer };
}

const cleanNfc = (uid) => String(uid).replace(/[^0-9a-f]/gi, '').toLowerCase();

function checkpointColumns(d) {
  const { type, visible, answer } = splitChallenge(d.challenge);
  const methods = d.validationMethods ?? ['GEOFENCE'];
  return [
    d.title, d.clueText, d.latitude, d.longitude, d.radius ?? 30,
    JSON.stringify(methods),
    methods.includes('NFC') && d.nfcUid ? cleanNfc(d.nfcUid) : null,
    (d.hideLocation ?? true) ? 1 : 0,
    d.points ?? 100,
    type, JSON.stringify(visible), JSON.stringify(answer),
  ];
}

export function createCheckpoint(rallyId, d) {
  return tx(async () => {
    await one('SELECT id FROM rallies WHERE id=? FOR UPDATE', rallyId); // serializa altas simultáneas
    const { next } = await one('SELECT COALESCE(MAX(position),0)+1 AS next FROM checkpoints WHERE rally_id=?', rallyId);
    const id = randomUUID();
    await run(
      `INSERT INTO checkpoints
         (id, rally_id, position, title, clue_text, latitude, longitude, radius, validation_methods, nfc_uid,
          hide_location, points, challenge_type, challenge_json, answer_json, qr_secret)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, rallyId, next, ...checkpointColumns(d), randomSecret(),
    );
    return one('SELECT * FROM checkpoints WHERE id=?', id);
  });
}

export async function updateCheckpoint(rallyId, checkpointId, d) {
  const existing = await one('SELECT id FROM checkpoints WHERE id=? AND rally_id=?', checkpointId, rallyId);
  if (!existing) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
  await run(
    `UPDATE checkpoints SET title=?, clue_text=?, latitude=?, longitude=?, radius=?, validation_methods=?, nfc_uid=?,
       hide_location=?, points=?, challenge_type=?, challenge_json=?, answer_json=?
     WHERE id=? AND rally_id=?`,
    ...checkpointColumns(d), checkpointId, rallyId,
  );
  return one('SELECT * FROM checkpoints WHERE id=?', checkpointId);
}

// `position` es UNIQUE por rally: se pasa por valores negativos para no chocar a mitad de la operación
async function renumber(rallyId, orderedIds) {
  await run('UPDATE checkpoints SET position = -position WHERE rally_id=?', rallyId);
  for (const [i, id] of orderedIds.entries()) {
    await run('UPDATE checkpoints SET position=? WHERE id=? AND rally_id=?', i + 1, id, rallyId);
  }
}

export function deleteCheckpoint(rallyId, checkpointId) {
  return tx(async () => {
    const r = await run('DELETE FROM checkpoints WHERE id=? AND rally_id=?', checkpointId, rallyId);
    if (r.changes === 0) throw notFound('CHECKPOINT_NOT_FOUND', 'Checkpoint no encontrado');
    const rest = await all('SELECT id FROM checkpoints WHERE rally_id=? ORDER BY position', rallyId);
    await renumber(rallyId, rest.map((c) => c.id));
  });
}

export function reorderCheckpoints(rallyId, ids) {
  return tx(async () => {
    const current = (await all('SELECT id FROM checkpoints WHERE rally_id=?', rallyId)).map((c) => c.id);
    const valid = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
    if (!valid) {
      throw unprocessable('INVALID_ORDER', 'La lista debe incluir exactamente todos los checkpoints del rally, sin repetir');
    }
    await renumber(rallyId, ids);
  });
}

// Vista del organizador: incluye respuestas aceptadas y el contenido exacto del QR/NFC
export function checkpointAdminView(cp) {
  return {
    id: cp.id,
    position: cp.position,
    title: cp.title,
    clueText: cp.clue_text,
    latitude: cp.latitude,
    longitude: cp.longitude,
    radius: cp.radius,
    validationMethods: jsonParse(cp.validation_methods),
    nfcUid: cp.nfc_uid,
    hideLocation: !!cp.hide_location,
    points: cp.points,
    challenge: { type: cp.challenge_type, ...jsonParse(cp.challenge_json), ...jsonParse(cp.answer_json) },
    qrPayload: checkpointCode(cp),
  };
}
