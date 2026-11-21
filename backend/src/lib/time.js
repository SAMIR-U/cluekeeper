export const MIN = 60_000;

// Momento en que vence el plazo de un equipo (rally + extras globales + extras del equipo)
export function teamDeadline(rally, team) {
  if (rally.started_at == null) return null;
  return rally.started_at + (rally.duration_minutes + rally.extra_minutes + team.extra_minutes) * MIN;
}

// Fin efectivo: el plazo, o antes si el organizador finalizó manualmente
export function teamEnd(rally, team) {
  const deadline = teamDeadline(rally, team);
  if (deadline == null) return null;
  return rally.finished_at != null ? Math.min(deadline, rally.finished_at) : deadline;
}

export function timing(rally, team, now = Date.now()) {
  const end = teamEnd(rally, team);
  return {
    serverTime: now,
    startedAt: rally.started_at,
    endsAt: end,
    remainingSeconds: end == null ? null : Math.max(0, Math.floor((end - now) / 1000)),
    extraMinutes: rally.extra_minutes + team.extra_minutes,
  };
}
