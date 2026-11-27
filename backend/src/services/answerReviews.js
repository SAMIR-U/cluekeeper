import { one, run, tx } from '../db.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { notify } from './notifications.js';
import { findRally } from './rallies.js';
import { teamState } from './play.js';

export function reviewAnswer(rallyId, submissionId, action, note = '') {
  return tx(async () => {
    const review = await one(
      `SELECT ar.*, s.answer_text, s.matched_answer
       FROM answer_reviews ar JOIN submissions s ON s.id=ar.submission_id
       JOIN teams t ON t.id=ar.team_id
       WHERE ar.submission_id=? AND t.rally_id=? FOR UPDATE`,
      submissionId, rallyId,
    );
    if (!review) throw notFound('ANSWER_REVIEW_NOT_FOUND', 'Respuesta no encontrada');
    if (review.status !== 'PENDING') throw conflict('REVIEW_ALREADY_RESOLVED', 'Esta respuesta ya fue revisada');

    const reviewedAt = Date.now();
    if (action === 'REJECT') {
      await run("UPDATE answer_reviews SET status='REJECTED', reviewed_at=?, review_note=? WHERE submission_id=?", reviewedAt, note, submissionId);
      await notify({
        rallyId, teamId: review.team_id, type: 'ANSWER_REJECTED',
        title: 'Respuesta no aprobada', body: note || 'Revisa la pista y vuelve a enviar tu respuesta.',
        data: { checkpointId: review.checkpoint_id },
      });
      return { submissionId, status: 'REJECTED', reviewedAt, reviewNote: note };
    }

    const checkpoint = await one('SELECT * FROM checkpoints WHERE id=? AND rally_id=?', review.checkpoint_id, rallyId);
    const team = await one('SELECT * FROM teams WHERE id=? AND rally_id=? FOR UPDATE', review.team_id, rallyId);
    const progress = await one('SELECT * FROM progress WHERE team_id=? AND checkpoint_id=? FOR UPDATE', team.id, checkpoint.id);
    if (!progress || progress.status === 'COMPLETED') {
      throw conflict('CHECKPOINT_ALREADY_COMPLETED', 'El equipo ya completó esta estación');
    }

    const pointsAwarded = Math.max(0, checkpoint.points);
    await run("UPDATE answer_reviews SET status='APPROVED', reviewed_at=?, review_note=? WHERE submission_id=?", reviewedAt, note, submissionId);
    await run(
      `UPDATE progress SET status='COMPLETED', completed_at=?, points_awarded=?, attempts=attempts+1
       WHERE team_id=? AND checkpoint_id=?`,
      reviewedAt, pointsAwarded, team.id, checkpoint.id,
    );
    await run('UPDATE teams SET score=score+? WHERE id=?', pointsAwarded, team.id);
    await run('UPDATE submissions SET correct=1 WHERE id=?', submissionId);

    const rally = await findRally(rallyId);
    const after = await teamState(rally, team);
    const finished = !after.current;
    if (finished) await run('UPDATE teams SET finished_at=? WHERE id=?', reviewedAt, team.id);
    if (rally.status === 'IN_PROGRESS') {
      if (finished) {
        await notify({ rallyId, teamId: team.id, type: 'ROUTE_COMPLETED', title: '¡Ruta completada!', body: 'Tu respuesta fue aprobada. Terminaste todos los checkpoints.' });
      } else {
        await notify({
          rallyId, teamId: team.id, type: 'NEW_CLUE', title: 'Nueva pista desbloqueada',
          body: 'Tu respuesta fue aprobada. Ya puedes ver la siguiente pista.',
          data: { checkpointId: after.current.cp.id },
        });
      }
    }
    return { submissionId, status: 'APPROVED', reviewedAt, pointsAwarded, score: team.score + pointsAwarded, finished };
  });
}
