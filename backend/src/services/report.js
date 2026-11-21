import { all } from '../db.js';
import { ranking } from './ranking.js';
import { teamState } from './play.js';
import { one } from '../db.js';

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

export function buildReport(rally) {
  const cps = all('SELECT id, position, title, points FROM checkpoints WHERE rally_id=? ORDER BY position', rally.id);
  const rows = ranking(rally);

  const teams = rows.map((r) => {
    const team = one('SELECT * FROM teams WHERE id=?', r.teamId);
    const state = teamState(rally, team);
    return {
      ...r,
      checkpoints: state.items.map(({ cp, p, status, unlockedAt }) => ({
        position: cp.position,
        title: cp.title,
        status,
        pointsAwarded: p?.points_awarded ?? 0,
        attempts: p?.attempts ?? 0,
        unlockedAt: iso(unlockedAt),
        arrivedAt: iso(p?.arrived_at),
        completedAt: iso(p?.completed_at),
        secondsTotal: p?.completed_at && unlockedAt ? Math.round((p.completed_at - unlockedAt) / 1000) : null,
        secondsOnChallenge: p?.completed_at && p.arrived_at ? Math.round((p.completed_at - p.arrived_at) / 1000) : null,
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rally: {
      id: rally.id,
      name: rally.name,
      code: rally.code,
      status: rally.status,
      startedAt: iso(rally.started_at),
      finishedAt: iso(rally.finished_at),
      durationMinutes: rally.duration_minutes,
      extraMinutes: rally.extra_minutes,
    },
    checkpoints: cps,
    teams,
  };
}

// Neutraliza inyección de fórmulas en Excel/Sheets (nombres de equipo los escribe el público)
function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report) {
  const header = [
    'Posicion', 'Equipo', 'Puntaje', 'Checkpoints completados', 'Termino la ruta', 'Tiempo total (s)',
    ...report.checkpoints.flatMap((c) => [`CP${c.position} puntos`, `CP${c.position} intentos`, `CP${c.position} tiempo (s)`]),
  ];
  const lines = [header.map(cell).join(',')];
  for (const t of report.teams) {
    lines.push(
      [
        t.rank, t.name, t.score, t.completedCheckpoints, t.finished ? 'Si' : 'No', t.totalSeconds,
        ...t.checkpoints.flatMap((c) => [c.pointsAwarded, c.attempts, c.secondsTotal]),
      ].map(cell).join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM para que Excel lea UTF-8
}
