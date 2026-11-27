import { one, run, tx } from '../db.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { notify } from './notifications.js';
import { findRally } from './rallies.js';
import { teamState } from './play.js';

export function reviewPhoto(rallyId, evidenceId, action, note = '') {
  return tx(async () => {
    let evidence = await one(
      `SELECT e.*, t.rally_id FROM evidences e JOIN teams t ON t.id=e.team_id
       WHERE e.id=? AND t.rally_id=?`,
      evidenceId, rallyId,
    );
    if (!evidence) throw notFound('EVIDENCE_NOT_FOUND', 'Evidencia no encontrada');
    if (evidence.type !== 'PHOTO') throw unprocessable('PHOTO_ONLY', 'Solo las fotografías requieren aprobación');

    // Usa el mismo orden de bloqueo que la recepción de evidencias (equipo y luego revisión).
    await one('SELECT id FROM teams WHERE id=? AND rally_id=? FOR UPDATE', evidence.team_id, rallyId);
    evidence = await one(
      `SELECT e.*, t.rally_id FROM evidences e JOIN teams t ON t.id=e.team_id
       WHERE e.id=? AND t.rally_id=? FOR UPDATE`,
      evidenceId, rallyId,
    );
    const review = await one('SELECT * FROM photo_reviews WHERE evidence_id=? FOR UPDATE', evidenceId);
    if (!review) throw conflict('PHOTO_REVIEW_NOT_FOUND', 'Esta fotografía no está pendiente de revisión');
    if (review.status !== 'PENDING') throw conflict('REVIEW_ALREADY_RESOLVED', 'Esta fotografía ya fue revisada');

    const reviewedAt = Date.now();
    if (action === 'REJECT') {
      await run("UPDATE photo_reviews SET status='REJECTED', reviewed_at=?, review_note=? WHERE evidence_id=?", reviewedAt, note, evidenceId);
      await notify({
        rallyId, teamId: evidence.team_id, type: 'EVIDENCE_REJECTED',
        title: 'Foto no aprobada', body: note || 'Tomen otra fotografía para esta estación y vuelvan a enviarla.',
        data: { checkpointId: evidence.checkpoint_id },
      });
      return { evidenceId, status: 'REJECTED', reviewedAt, reviewNote: note };
    }

    const checkpoint = await one('SELECT * FROM checkpoints WHERE id=? AND rally_id=?', evidence.checkpoint_id, rallyId);
    const team = await one('SELECT * FROM teams WHERE id=? AND rally_id=? FOR UPDATE', evidence.team_id, rallyId);
    const progress = await one('SELECT * FROM progress WHERE team_id=? AND checkpoint_id=? FOR UPDATE', team.id, checkpoint.id);
    if (!progress) throw conflict('CHECKPOINT_NOT_ACTIVE', 'El equipo todavía no tiene esta estación activa');
    if (progress.status === 'COMPLETED') {
      await run("UPDATE photo_reviews SET status='APPROVED', reviewed_at=?, review_note=? WHERE evidence_id=?", reviewedAt, note, evidenceId);
      return { evidenceId, status: 'APPROVED', reviewedAt, pointsAwarded: 0, score: team.score, alreadyCompleted: true };
    }

    const pointsAwarded = Math.max(0, checkpoint.points);
    await run("UPDATE photo_reviews SET status='APPROVED', reviewed_at=?, review_note=? WHERE evidence_id=?", reviewedAt, note, evidenceId);
    await run(
      `UPDATE progress SET status='COMPLETED', completed_at=?, points_awarded=?, attempts=attempts+1
       WHERE team_id=? AND checkpoint_id=?`,
      reviewedAt, pointsAwarded, team.id, checkpoint.id,
    );
    await run('UPDATE teams SET score=score+? WHERE id=?', pointsAwarded, team.id);

    const rally = await findRally(rallyId);
    const after = await teamState(rally, team);
    const finished = !after.current;
    if (finished) await run('UPDATE teams SET finished_at=? WHERE id=?', reviewedAt, team.id);
    if (rally.status === 'IN_PROGRESS') {
      if (finished) {
        await notify({ rallyId, teamId: team.id, type: 'ROUTE_COMPLETED', title: '¡Ruta completada!', body: 'La última fotografía fue aprobada. Terminaste todos los checkpoints.' });
      } else {
        await notify({
          rallyId, teamId: team.id, type: 'NEW_CLUE', title: 'Nueva pista desbloqueada',
          body: 'Tu fotografía fue aprobada. Ya puedes ver la siguiente pista.',
          data: { checkpointId: after.current.cp.id },
        });
      }
    }
    return { evidenceId, status: 'APPROVED', reviewedAt, pointsAwarded, score: team.score + pointsAwarded, finished };
  });
}
