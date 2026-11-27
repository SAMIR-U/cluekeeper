import { one, run, tx } from '../db.js';
import { sniff } from '../lib/files.js';
import { badRequest, conflict, AppError } from '../lib/errors.js';
import { assertEvidenceAllowed } from './play.js';

export const MAX_BYTES = { PHOTO: 8 * 1024 * 1024, AUDIO: 15 * 1024 * 1024 };

const receipt = (e, replayed = false) => ({
  evidenceId: e.id,
  status: 'RECEIVED',
  checkpointId: e.checkpoint_id,
  type: e.type,
  size: e.size,
  receivedAt: e.received_at,
  ...(replayed ? { replayed: true } : {}),
});

async function replay(team, evidenceId) {
  const existing = await one(
    'SELECT id, team_id, checkpoint_id, type, size, received_at FROM evidences WHERE id=?',
    evidenceId,
  );
  if (!existing) return null;
  if (existing.team_id !== team.id) throw conflict('EVIDENCE_ID_TAKEN', 'Identificador de evidencia en uso');
  return { status: 200, body: receipt(existing, true) };
}

// Contrato con evidenceSync.js: { evidenceId, status: "RECEIVED" }
export async function receiveEvidence(rally, team, { evidenceId, checkpointId, type, capturedAt }, file) {
  const prior = await replay(team, evidenceId);
  if (prior) return prior;

  if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED', 'Falta el archivo');
  if (file.buffer.length > MAX_BYTES[type]) {
    throw new AppError(413, 'FILE_TOO_LARGE', `El archivo supera el máximo de ${MAX_BYTES[type] / 1048576} MB`);
  }
  const detected = sniff(file.buffer);
  if (!detected || detected.type !== type) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA', `El archivo no es ${type === 'PHOTO' ? 'una imagen' : 'un audio'} válido`);
  }

  return tx(async () => {
    const { t, late, cp } = await assertEvidenceAllowed(rally, team, checkpointId, capturedAt);
    const receivedAt = Date.now();
    const r = await run(
      `INSERT INTO evidences (id, team_id, checkpoint_id, type, mime, size, data, late, captured_at, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`,
      evidenceId, team.id, cp.id, type, detected.mime, file.buffer.length, file.buffer, late ? 1 : 0, t, receivedAt,
    );
    if (r.changes === 0) return (await replay(team, evidenceId)); // subida simultánea del mismo id
    // Una foto recibida entra de inmediato a moderación, aunque el cliente se cierre
    // antes de pulsar "Enviar reto". Así el organizador siempre puede verla y decidir.
    if (type === 'PHOTO') {
      const submissionId = `photo_${evidenceId}`;
      const result = { submissionId, correct: false, completed: false, pendingReview: true, reviewKind: 'PHOTO', pointsAwarded: 0 };
      await run(
        `INSERT INTO submissions (id, team_id, checkpoint_id, correct, late, captured_at, created_at, result_json)
         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`,
        submissionId, team.id, cp.id, 0, late ? 1 : 0, t, receivedAt, JSON.stringify(result),
      );
      await run(
        `INSERT INTO photo_reviews (evidence_id, team_id, checkpoint_id, submission_id, status, submitted_at)
         VALUES (?,?,?,?,'PENDING',?) ON CONFLICT (evidence_id) DO NOTHING`,
        evidenceId, team.id, cp.id, submissionId, receivedAt,
      );
    }
    return {
      status: 201,
      body: receipt({ id: evidenceId, checkpoint_id: cp.id, type, size: file.buffer.length, received_at: receivedAt }),
    };
  });
}
