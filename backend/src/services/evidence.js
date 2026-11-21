import { one, run, tx } from '../db.js';
import { sniff, saveFile } from '../lib/files.js';
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

// Contrato con evidenceSync.js: { evidenceId, status: "RECEIVED" }
export function receiveEvidence(rally, team, { evidenceId, checkpointId, type, capturedAt }, file) {
  const existing = one('SELECT * FROM evidences WHERE id=?', evidenceId);
  if (existing) {
    if (existing.team_id !== team.id) throw conflict('EVIDENCE_ID_TAKEN', 'Identificador de evidencia en uso');
    return { status: 200, body: receipt(existing, true) };
  }

  if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED', 'Falta el archivo');
  if (file.buffer.length > MAX_BYTES[type]) {
    throw new AppError(413, 'FILE_TOO_LARGE', `El archivo supera el máximo de ${MAX_BYTES[type] / 1048576} MB`);
  }
  const detected = sniff(file.buffer);
  if (!detected || detected.type !== type) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA', `El archivo no es ${type === 'PHOTO' ? 'una imagen' : 'un audio'} válido`);
  }

  return tx(() => {
    const { t, late, cp } = assertEvidenceAllowed(rally, team, checkpointId, capturedAt);
    if (late) { /* se acepta dentro de la ventana de gracia y se marca para el reporte */ }
    const rel = saveFile(rally.id, team.id, evidenceId, detected.ext, file.buffer);
    const receivedAt = Date.now();
    run(
      `INSERT INTO evidences (id, team_id, checkpoint_id, type, mime, size, path, late, captured_at, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      evidenceId, team.id, cp.id, type, detected.mime, file.buffer.length, rel, late ? 1 : 0, t, receivedAt,
    );
    return {
      status: 201,
      body: receipt({ id: evidenceId, checkpoint_id: cp.id, type, size: file.buffer.length, received_at: receivedAt }),
    };
  });
}
