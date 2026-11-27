import { one, all, run, tx } from '../db.js';
import { config } from '../config.js';
import { createRally, createCheckpoint, updateCheckpoint } from './admin.js';
import { UPTC_RALLY } from '../data/uptcRally.js';

// Deja el rally definido en `def` guardado en la base de datos. Es idempotente:
//  - no existe            -> lo crea con todas sus estaciones;
//  - existe sin empezar   -> lo sincroniza con la definición (conserva ids y QR de las estaciones);
//  - ya inició / tiene progreso -> no toca nada, para no alterar resultados.
export async function ensurePresetRally(organizerId, def = UPTC_RALLY) {
  return tx(async () => {
    let rally = await one('SELECT * FROM rallies WHERE code=? FOR UPDATE', def.code);
    const fields = {
      name: def.name,
      code: def.code,
      durationMinutes: def.code === UPTC_RALLY.code ? config.rallyDurationMinutes : def.durationMinutes,
      wrongAttemptPenalty: def.wrongAttemptPenalty,
      maxAttempts: def.maxAttempts,
      warningMinutes: def.warningMinutes,
    };

    if (!rally) {
      rally = await createRally(organizerId, fields);
      for (const cp of def.checkpoints) await createCheckpoint(rally.id, cp);
      return { action: 'created', rallyId: rally.id, checkpoints: def.checkpoints.length };
    }

    // Evento único: el organizador configurado en ADMIN_EMAIL debe poder verlo
    if (rally.organizer_id !== organizerId) {
      await run('UPDATE rallies SET organizer_id=? WHERE id=?', organizerId, rally.id);
    }

    const { n } = await one(
      'SELECT COUNT(*) AS n FROM progress WHERE team_id IN (SELECT id FROM teams WHERE rally_id=?)',
      rally.id,
    );
    if (rally.status !== 'NOT_STARTED' || n > 0) {
      return { action: 'kept', rallyId: rally.id, reason: 'ya iniciado o con progreso' };
    }

    await run(
      `UPDATE rallies SET name=?, duration_minutes=?, wrong_attempt_penalty=?, max_attempts=?, warning_minutes=? WHERE id=?`,
      def.name, fields.durationMinutes, def.wrongAttemptPenalty, def.maxAttempts, def.warningMinutes.join(','), rally.id,
    );
    const existing = await all('SELECT id FROM checkpoints WHERE rally_id=? ORDER BY position', rally.id);
    for (const [i, cp] of def.checkpoints.entries()) {
      if (existing[i]) await updateCheckpoint(rally.id, existing[i].id, cp);
      else await createCheckpoint(rally.id, cp);
    }
    for (const extra of existing.slice(def.checkpoints.length)) {
      await run('DELETE FROM checkpoints WHERE id=?', extra.id);
    }
    return { action: 'synced', rallyId: rally.id, checkpoints: def.checkpoints.length };
  });
}

// Se ejecuta al arrancar el servidor (desactivable con AUTO_SEED_RALLY=false)
export async function seedPresetRallies() {
  if (!config.autoSeedRally) return;
  if (!config.adminEmail) {
    console.warn('[seed] ADMIN_EMAIL no definido: no se puede asignar el rally UPTC a un organizador');
    return;
  }
  const organizer = await one('SELECT id FROM organizers WHERE email=?', config.adminEmail.toLowerCase());
  if (!organizer) return console.warn('[seed] No existe el organizador ADMIN_EMAIL; define también ADMIN_PASSWORD');
  const result = await ensurePresetRally(organizer.id);
  console.log(`[seed] Rally ${UPTC_RALLY.code}: ${result.action}${result.reason ? ` (${result.reason})` : ''}`);
}
