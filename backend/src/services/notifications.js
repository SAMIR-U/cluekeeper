import { EventEmitter } from 'node:events';
import { all, run, afterCommit } from '../db.js';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

const view = (r) => ({
  id: r.id,
  rallyId: r.rally_id,
  teamId: r.team_id,
  type: r.type,
  title: r.title,
  body: r.body,
  data: JSON.parse(r.data_json),
  createdAt: r.created_at,
});

// teamId = null => aviso para todos los equipos del rally
export function notify({ rallyId, teamId = null, type, title, body = '', data = {} }) {
  const createdAt = Date.now();
  const res = run(
    'INSERT INTO notifications (rally_id, team_id, type, title, body, data_json, created_at) VALUES (?,?,?,?,?,?,?)',
    rallyId, teamId, type, title, body, JSON.stringify(data), createdAt,
  );
  const n = view({
    id: Number(res.lastInsertRowid), rally_id: rallyId, team_id: teamId, type, title, body,
    data_json: JSON.stringify(data), created_at: createdAt,
  });
  afterCommit(() => bus.emit('notification', n));
  return n;
}

// Notificaciones visibles para un equipo (o todas las del rally si teamId es null)
export function listNotifications({ rallyId, teamId = null, afterId = 0, limit = 100 }) {
  const rows = teamId
    ? all(
        'SELECT * FROM notifications WHERE rally_id=? AND id>? AND (team_id IS NULL OR team_id=?) ORDER BY id LIMIT ?',
        rallyId, afterId, teamId, limit,
      )
    : all('SELECT * FROM notifications WHERE rally_id=? AND id>? ORDER BY id LIMIT ?', rallyId, afterId, limit);
  return rows.map(view);
}
