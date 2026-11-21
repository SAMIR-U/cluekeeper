import { one, all, run, tx } from '../db.js';
import { MIN, timing } from '../lib/time.js';
import { conflict, unprocessable, notFound } from '../lib/errors.js';
import { notify } from './notifications.js';

export const findRally = (id) => one('SELECT * FROM rallies WHERE id=?', id) ?? null;
export const findRallyByCode = (code) =>
  one('SELECT * FROM rallies WHERE code=?', String(code).trim().toUpperCase()) ?? null;

// Carga el rally aplicando el cierre automático por tiempo (no depende de un cron)
export function loadRally(id) {
  const rally = findRally(id);
  return rally ? applyTimeout(rally) : null;
}

function latestDeadline(rally) {
  const { m } = one('SELECT COALESCE(MAX(extra_minutes),0) AS m FROM teams WHERE rally_id=?', rally.id);
  return rally.started_at + (rally.duration_minutes + rally.extra_minutes + m) * MIN;
}

function applyTimeout(rally) {
  if (rally.status !== 'IN_PROGRESS') return rally;
  const deadline = latestDeadline(rally);
  if (Date.now() < deadline) return rally;
  tx(() => {
    const r = run(
      "UPDATE rallies SET status='FINISHED', finished_at=?, finish_reason='TIMEOUT' WHERE id=? AND status='IN_PROGRESS'",
      deadline, rally.id,
    );
    if (r.changes === 1) {
      notify({ rallyId: rally.id, type: 'RALLY_FINISHED', title: 'Rally finalizado', body: 'Se terminó el tiempo.' });
    }
  });
  return findRally(rally.id);
}

export const countCheckpoints = (rallyId) =>
  one('SELECT COUNT(*) AS n FROM checkpoints WHERE rally_id=?', rallyId).n;

export function publicRally(rally, team) {
  return {
    id: rally.id,
    name: rally.name,
    status: rally.status,
    durationMinutes: rally.duration_minutes,
    totalCheckpoints: countCheckpoints(rally.id),
    ...(team ? timing(rally, team) : {}),
  };
}

export function startRally(rallyId) {
  return tx(() => {
    const rally = findRally(rallyId);
    if (rally.status !== 'NOT_STARTED') throw conflict('ALREADY_STARTED', 'El rally ya fue iniciado');
    if (countCheckpoints(rallyId) < 1) {
      throw unprocessable('NO_CHECKPOINTS', 'Agrega al menos un checkpoint antes de iniciar');
    }
    run("UPDATE rallies SET status='IN_PROGRESS', started_at=? WHERE id=?", Date.now(), rallyId);
    notify({
      rallyId, type: 'RALLY_STARTED', title: '¡El rally comenzó!',
      body: 'Ya puedes ver tu primera pista.',
    });
    return findRally(rallyId);
  });
}

export function finishRally(rallyId) {
  return tx(() => {
    const rally = findRally(rallyId);
    if (rally.status === 'NOT_STARTED') throw conflict('RALLY_NOT_STARTED', 'El rally aún no ha iniciado');
    if (rally.status === 'FINISHED') throw conflict('RALLY_FINISHED', 'El rally ya finalizó');
    run("UPDATE rallies SET status='FINISHED', finished_at=?, finish_reason='MANUAL' WHERE id=?", Date.now(), rallyId);
    notify({ rallyId, type: 'RALLY_FINISHED', title: 'Rally finalizado', body: 'El organizador cerró el rally.' });
    return findRally(rallyId);
  });
}

// Suma minutos al rally completo o a un solo equipo (HU-25)
export function extendTime(rallyId, minutes, teamId = null) {
  return tx(() => {
    let rally = findRally(rallyId);
    if (rally.status === 'NOT_STARTED') throw conflict('RALLY_NOT_STARTED', 'El rally aún no ha iniciado');
    if (rally.status === 'FINISHED' && rally.finish_reason !== 'TIMEOUT') {
      throw conflict('RALLY_FINISHED', 'El rally fue finalizado manualmente y no puede ampliarse');
    }

    let team = null;
    if (teamId) {
      team = one('SELECT * FROM teams WHERE id=? AND rally_id=?', teamId, rallyId);
      if (!team) throw notFound('TEAM_NOT_FOUND', 'Equipo no encontrado');
      run('UPDATE teams SET extra_minutes = extra_minutes + ? WHERE id=?', minutes, teamId);
    } else {
      run('UPDATE rallies SET extra_minutes = extra_minutes + ? WHERE id=?', minutes, rallyId);
    }

    rally = findRally(rallyId);
    if (rally.status === 'FINISHED') {
      // Cerrado por tiempo: se reabre solo si la ampliación alcanza para seguir jugando
      if (latestDeadline(rally) <= Date.now()) {
        throw conflict('EXTENSION_TOO_SHORT', 'La ampliación no alcanza: el plazo sigue vencido');
      }
      run("UPDATE rallies SET status='IN_PROGRESS', finished_at=NULL, finish_reason=NULL WHERE id=?", rallyId);
    }

    resetWarnings(findRally(rallyId), team ? [team.id] : all('SELECT id FROM teams WHERE rally_id=?', rallyId).map((t) => t.id));

    notify({
      rallyId,
      teamId: team?.id ?? null,
      type: 'TIME_EXTENDED',
      title: 'Tiempo adicional',
      body: `El organizador sumó ${minutes} minuto${minutes === 1 ? '' : 's'}.`,
      data: { minutes },
    });
    return findRally(rallyId);
  });
}

// Tras una ampliación, los avisos de "poco tiempo" vuelven a ser válidos
function resetWarnings(rally, teamIds) {
  for (const id of teamIds) {
    const team = one('SELECT * FROM teams WHERE id=?', id);
    const end = rally.started_at + (rally.duration_minutes + rally.extra_minutes + team.extra_minutes) * MIN;
    const remaining = end - Date.now();
    run('DELETE FROM warnings_sent WHERE team_id=? AND minutes*60000 < ?', id, remaining);
  }
}
