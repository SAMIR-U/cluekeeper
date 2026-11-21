import { EventEmitter } from 'node:events';
import { all, one, afterCommit } from '../db.js';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

const view = (r) => ({
  id: Number(r.id),
  rallyId: r.rally_id,
  teamId: r.team_id,
  type: r.type,
  title: r.title,
  body: r.body,
  data: JSON.parse(r.data_json),
  createdAt: Number(r.created_at),
});

// teamId = null => aviso para todos los equipos del rally
export async function notify({ rallyId, teamId = null, type, title, body = '', data = {} }) {
  const row = await one(
    `INSERT INTO notifications (rally_id, team_id, type, title, body, data_json, created_at)
     VALUES (?,?,?,?,?,?,?) RETURNING *`,
    rallyId, teamId, type, title, body, JSON.stringify(data), Date.now(),
  );
  const n = view(row);
  afterCommit(() => bus.emit('notification', n));
  return n;
}

export async function listNotifications({ rallyId, teamId = null, afterId = 0, limit = 100 }) {
  const rows = teamId
    ? await all(
        'SELECT * FROM notifications WHERE rally_id=? AND id>? AND (team_id IS NULL OR team_id=?) ORDER BY id LIMIT ?',
        rallyId, afterId, teamId, limit,
      )
    : await all('SELECT * FROM notifications WHERE rally_id=? AND id>? ORDER BY id LIMIT ?', rallyId, afterId, limit);
  return rows.map(view);
}
