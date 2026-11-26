import { db } from '../db/cluekeeperDB';
import { api } from './api';

let activeSync;

export async function queuePlayAction({ rallyId, teamId, checkpointId, kind, body, idempotencyKey }) {
  const action = {
    id: crypto.randomUUID(), rallyId, teamId, checkpointId, kind, body,
    idempotencyKey: idempotencyKey || null,
    status: 'PENDING', createdAt: Date.now(),
  };
  await db.playActions.add(action);
  return action;
}

async function runSync() {
  const actions = await db.playActions.where('status').equals('PENDING').sortBy('createdAt');
  let sent = 0;
  for (const action of actions) {
    try {
      if (action.kind === 'SUBMIT' && action.body.evidenceId) {
        const evidence = await db.evidences.get(action.body.evidenceId);
        if (evidence && evidence.status !== 'SENT') break;
      }
      await db.playActions.update(action.id, { status: 'SENDING', lastError: null });
      if (action.kind === 'ARRIVE') {
        await api(`/checkpoints/${action.checkpointId}/arrive`, { method: 'POST', body: action.body });
      } else {
        await api(`/checkpoints/${action.checkpointId}/submit`, {
          method: 'POST',
          headers: { 'Idempotency-Key': action.idempotencyKey },
          body: { ...action.body, submissionId: action.idempotencyKey },
        });
      }
      await db.playActions.update(action.id, { status: 'SENT', syncedAt: Date.now(), lastError: null });
      sent++;
    } catch (error) {
      if (action.kind === 'SUBMIT' && error.code === 'ALREADY_COMPLETED') {
        await db.playActions.update(action.id, { status: 'SENT', syncedAt: Date.now(), lastError: null });
        sent++;
        continue;
      }
      if (!error.status || error.status >= 500) {
        await db.playActions.update(action.id, { status: 'PENDING', lastError: error.message });
        break;
      }
      await db.playActions.update(action.id, { status: 'FAILED', lastError: error.message });
      // Preserve ordering: a later answer cannot be valid if its arrival did not sync.
      break;
    }
  }
  if (sent) window.dispatchEvent(new CustomEvent('cluekeeper:play-synced'));
  return { sent };
}

export function syncPlayActions() {
  if (!activeSync) activeSync = runSync().finally(() => { activeSync = null; });
  return activeSync;
}

export async function recoverInterruptedActions() {
  await db.playActions.where('status').equals('SENDING').modify({ status: 'PENDING' });
}
