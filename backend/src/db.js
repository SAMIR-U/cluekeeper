import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
}

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS organizers (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rallies (
  id                    TEXT PRIMARY KEY,
  organizer_id          TEXT NOT NULL REFERENCES organizers(id),
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'NOT_STARTED'
                        CHECK (status IN ('NOT_STARTED','IN_PROGRESS','FINISHED')),
  duration_minutes      INTEGER NOT NULL,
  extra_minutes         INTEGER NOT NULL DEFAULT 0,
  wrong_attempt_penalty INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 3,
  warning_minutes       TEXT NOT NULL DEFAULT '15,5',
  started_at            INTEGER,
  finished_at           INTEGER,
  finish_reason         TEXT CHECK (finish_reason IN ('TIMEOUT','MANUAL')),
  created_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  rally_id      TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  joined_at     INTEGER NOT NULL,
  finished_at   INTEGER,
  UNIQUE (rally_id, name_key)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id                 TEXT PRIMARY KEY,
  rally_id           TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  title              TEXT NOT NULL,
  clue_text          TEXT NOT NULL,
  latitude           REAL NOT NULL,
  longitude          REAL NOT NULL,
  radius             REAL NOT NULL DEFAULT 30,
  validation_methods TEXT NOT NULL DEFAULT '["GEOFENCE"]',
  qr_secret          TEXT NOT NULL,
  nfc_uid            TEXT,
  hide_location      INTEGER NOT NULL DEFAULT 1,
  points             INTEGER NOT NULL DEFAULT 100,
  challenge_type     TEXT NOT NULL CHECK (challenge_type IN ('QUESTION','PHOTO','AUDIO','COMPASS')),
  challenge_json     TEXT NOT NULL,
  answer_json        TEXT NOT NULL DEFAULT '{}',
  UNIQUE (rally_id, position)
);

CREATE TABLE IF NOT EXISTS progress (
  team_id        TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id  TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('ARRIVED','COMPLETED')),
  arrival_method TEXT,
  arrived_at     INTEGER,
  completed_at   INTEGER,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  correct       INTEGER NOT NULL,
  late          INTEGER NOT NULL DEFAULT 0,
  captured_at   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  result_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidences (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('PHOTO','AUDIO')),
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  path          TEXT NOT NULL,
  late          INTEGER NOT NULL DEFAULT 0,
  captured_at   INTEGER NOT NULL,
  received_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rally_id   TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  team_id    TEXT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data_json  TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS warnings_sent (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (team_id, minutes)
);

CREATE INDEX IF NOT EXISTS idx_notifications_rally ON notifications(rally_id, id);
CREATE INDEX IF NOT EXISTS idx_evidences_cp ON evidences(team_id, checkpoint_id);
`);

export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

// Transacciones reentrantes + callbacks que se ejecutan solo tras el COMMIT
let depth = 0;
let hooks = [];

export function afterCommit(fn) {
  if (depth === 0) fn();
  else hooks.push(fn);
}

export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    depth = 0;
    const pending = hooks;
    hooks = [];
    pending.forEach((h) => h());
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ya revertida */ }
    depth = 0;
    hooks = [];
    throw error;
  }
}
