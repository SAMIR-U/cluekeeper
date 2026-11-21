import { all, one, run, tx } from '../db.js';
import { MIN, teamEnd } from '../lib/time.js';
import { loadRally } from './rallies.js';
import { notify } from './notifications.js';

// Revisa rallies activos: cierra los vencidos y avisa cuando queda poco tiempo (HU-19)
export async function tick() {
  const active = await all("SELECT id FROM rallies WHERE status='IN_PROGRESS'");
  for (const { id } of active) {
    const rally = await loadRally(id);
    if (rally.status !== 'IN_PROGRESS') continue;

    const thresholds = rally.warning_minutes.split(',').map(Number).filter((n) => n > 0);
    const teams = await all('SELECT * FROM teams WHERE rally_id=? AND finished_at IS NULL', id);

    for (const team of teams) {
      const remaining = teamEnd(rally, team) - Date.now();
      if (remaining <= 0) continue;
      const crossed = thresholds.filter((t) => remaining <= t * MIN);
      if (!crossed.length) continue;

      await tx(async () => {
        // INSERT ... DO NOTHING es atómico: si hay varias instancias, solo una avisa
        let isNew = false;
        for (const t of crossed) {
          const r = await run('INSERT INTO warnings_sent (team_id, minutes) VALUES (?,?) ON CONFLICT DO NOTHING', team.id, t);
          if (r.changes === 1) isNew = true;
        }
        if (!isNew) return;
        const minutes = Math.min(...crossed);
        await notify({
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
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (error) { console.error('[ticker]', error); } finally { busy = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}
