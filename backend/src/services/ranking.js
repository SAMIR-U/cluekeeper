import { all } from '../db.js';
import { teamEnd } from '../lib/time.js';

export async function ranking(rally) {
  const rows = await all(
    `SELECT t.id, t.name, t.score, t.finished_at, t.extra_minutes, t.joined_at,
       (SELECT COUNT(*) FROM progress p WHERE p.team_id=t.id AND p.status='COMPLETED') AS completed,
       (SELECT MAX(completed_at) FROM progress p WHERE p.team_id=t.id AND p.status='COMPLETED') AS last_completed_at
     FROM teams t WHERE t.rally_id=?`,
    rally.id,
  );

  // Más puntos > más checkpoints > completó antes > nombre
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.completed - a.completed ||
      (a.last_completed_at ?? Infinity) - (b.last_completed_at ?? Infinity) ||
      a.name.localeCompare(b.name, 'es'),
  );

  return rows.map((t, i) => ({
    rank: i + 1,
    teamId: t.id,
    name: t.name,
    score: t.score,
    completedCheckpoints: t.completed,
    finished: t.finished_at != null,
    finishedAt: t.finished_at,
    totalSeconds:
      t.finished_at != null && rally.started_at != null
        ? Math.round((t.finished_at - rally.started_at) / 1000)
        : null,
    lastCompletedAt: t.last_completed_at,
    extraMinutes: t.extra_minutes,
    endsAt: teamEnd(rally, t),
  }));
}
