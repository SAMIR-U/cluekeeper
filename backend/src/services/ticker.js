import { all, one, run, tx } from '../db.js';
import { MIN, teamEnd } from '../lib/time.js';
import { loadRally } from './rallies.js';
import { notify } from './notifications.js';

// Revisa rallies activos: cierra los vencidos y avisa cuando queda poco tiempo (HU-19)
export function tick() {
  const active = all("SELECT id FROM rallies WHERE status='IN_PROGRESS'");
  for (const { id } of active) {
    const rally = loadRally(id);
    if (rally.status !== 'IN_PROGRESS') continue;

    const thresholds = rally.warning_minutes.split(',').map(Number).filter((n) => n > 0);
    const teams = all('SELECT * FROM teams WHERE rally_id=? AND finished_at IS NULL', id);

    for (const team of teams) {
      const remaining = teamEnd(rally, team) - Date.now();
      if (remaining <= 0) continue;
      const crossed = thresholds.filter((t) => remaining <= t * MIN);
      if (!crossed.length) continue;

      tx(() => {
        const fresh = crossed.filter(
          (t) => !one('SELECT 1 AS x FROM warnings_sent WHERE team_id=? AND minutes=?', team.id, t),
        );
        if (!fresh.length) return;
        for (const t of crossed) run('INSERT OR IGNORE INTO warnings_sent (team_id, minutes) VALUES (?,?)', team.id, t);
        const minutes = Math.min(...crossed);
        notify({
          rallyId: id,
          teamId: team.id,
          type: 'TIME_WARNING',
          title: 'Queda poco tiempo',
          body: `Quedan menos de ${minutes} minutos.`,
          data: { minutes },
        });
      });
    }
  }
}

export function startTicker(intervalMs = 15_000) {
  const timer = setInterval(() => {
    try { tick(); } catch (error) { console.error('[ticker]', error); }
  }, intervalMs);
  timer.unref();
  return timer;
}
