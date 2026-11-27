import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

/* ---------- Esquema (PostgreSQL) ---------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizers (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    BIGINT NOT NULL
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
  started_at            BIGINT,
  finished_at           BIGINT,
  finish_reason         TEXT CHECK (finish_reason IN ('TIMEOUT','MANUAL')),
  created_at            BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  rally_id      TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  joined_at     BIGINT NOT NULL,
  finished_at   BIGINT,
  UNIQUE (rally_id, name_key)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id                 TEXT PRIMARY KEY,
  rally_id           TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  title              TEXT NOT NULL,
  clue_text          TEXT NOT NULL,
  latitude           DOUBLE PRECISION NOT NULL,
  longitude          DOUBLE PRECISION NOT NULL,
  radius             DOUBLE PRECISION NOT NULL DEFAULT 30,
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
  arrived_at     BIGINT,
  completed_at   BIGINT,
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
  captured_at   BIGINT NOT NULL,
  created_at    BIGINT NOT NULL,
  result_json   TEXT NOT NULL,
  answer_text   TEXT,
  matched_answer TEXT
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS answer_text TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS matched_answer TEXT;

-- Las fotos y audios se guardan en la base de datos: el servicio no necesita disco persistente
CREATE TABLE IF NOT EXISTS evidences (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('PHOTO','AUDIO')),
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  late          INTEGER NOT NULL DEFAULT 0,
  captured_at   BIGINT NOT NULL,
  received_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_reviews (
  evidence_id  TEXT PRIMARY KEY REFERENCES evidences(id) ON DELETE CASCADE,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  submitted_at BIGINT NOT NULL,
  reviewed_at  BIGINT,
  review_note  TEXT NOT NULL DEFAULT ''
);

ALTER TABLE photo_reviews DROP CONSTRAINT IF EXISTS photo_reviews_status_check;
ALTER TABLE photo_reviews ADD CONSTRAINT photo_reviews_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED'));

-- Recupera fotografías que llegaron antes de que se registrara la revisión.
INSERT INTO submissions (id, team_id, checkpoint_id, correct, late, captured_at, created_at, result_json)
SELECT 'photo_' || e.id, e.team_id, e.checkpoint_id, 0, e.late, e.captured_at, e.received_at,
       '{"submissionId":"photo_' || e.id || '","correct":false,"completed":false,"pendingReview":true,"reviewKind":"PHOTO","pointsAwarded":0}'
FROM evidences e
LEFT JOIN photo_reviews pr ON pr.evidence_id=e.id
WHERE e.type='PHOTO' AND pr.evidence_id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO photo_reviews (evidence_id, team_id, checkpoint_id, submission_id, status, submitted_at)
SELECT e.id, e.team_id, e.checkpoint_id, 'photo_' || e.id, 'PENDING', e.received_at
FROM evidences e
LEFT JOIN photo_reviews pr ON pr.evidence_id=e.id
WHERE e.type='PHOTO' AND pr.evidence_id IS NULL
ON CONFLICT (evidence_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS answer_reviews (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  submitted_at  BIGINT NOT NULL,
  reviewed_at   BIGINT,
  review_note   TEXT NOT NULL DEFAULT ''
);

ALTER TABLE answer_reviews DROP CONSTRAINT IF EXISTS answer_reviews_status_check;
ALTER TABLE answer_reviews ADD CONSTRAINT answer_reviews_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED'));

-- Si existían varias solicitudes pendientes por errores anteriores, conserva activa solo la más reciente.
UPDATE photo_reviews older SET status='SUPERSEDED'
WHERE older.status='PENDING' AND EXISTS (
  SELECT 1 FROM photo_reviews newer
  WHERE newer.team_id=older.team_id AND newer.checkpoint_id=older.checkpoint_id AND newer.status='PENDING'
    AND (newer.submitted_at > older.submitted_at OR (newer.submitted_at = older.submitted_at AND newer.evidence_id > older.evidence_id))
);
UPDATE answer_reviews older SET status='SUPERSEDED'
WHERE older.status='PENDING' AND EXISTS (
  SELECT 1 FROM answer_reviews newer
  WHERE newer.team_id=older.team_id AND newer.checkpoint_id=older.checkpoint_id AND newer.status='PENDING'
    AND (newer.submitted_at > older.submitted_at OR (newer.submitted_at = older.submitted_at AND newer.submission_id > older.submission_id))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  rally_id   TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  team_id    TEXT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data_json  TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS warnings_sent (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (team_id, minutes)
);

-- Dispositivos suscritos a Web Push (un equipo puede tener varios teléfonos)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,           -- sha256(endpoint)
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rally_id   TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  last_ok_at BIGINT,
  failures   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_team ON push_subscriptions(team_id);
CREATE INDEX IF NOT EXISTS idx_push_rally ON push_subscriptions(rally_id);
CREATE INDEX IF NOT EXISTS idx_notifications_rally ON notifications(rally_id, id);
CREATE INDEX IF NOT EXISTS idx_evidences_cp ON evidences(team_id, checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_teams_rally ON teams(rally_id);
CREATE INDEX IF NOT EXISTS idx_photo_reviews_status ON photo_reviews(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_answer_reviews_status ON answer_reviews(status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_reviews_one_pending_per_station ON photo_reviews(team_id, checkpoint_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_reviews_one_pending_per_station ON answer_reviews(team_id, checkpoint_id) WHERE status='PENDING';
`;

/* ---------- Drivers ---------- */

const INT8 = 20;
const toNumber = (v) => (v === null ? null : Number(v));

async function createPgDriver() {
  pg.types.setTypeParser(INT8, toNumber); // BIGINT (epoch ms, COUNT) como number
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (e) => console.error('[pg pool]', e.message));
  const norm = (r) => ({ rows: r.rows, rowCount: r.rowCount });
  return {
    name: 'postgres',
    exec: (sql) => pool.query(sql),
    query: async (sql, params, client) => norm(await (client ?? pool).query(sql, params)),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* conexión caída */ }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// PGlite = PostgreSQL real compilado a WASM: desarrollo y pruebas sin instalar nada
async function createPgliteDriver() {
  const { PGlite, types } = await import('@electric-sql/pglite');
  let dataDir;
  if (config.pgliteDir !== ':memory:') {
    fs.mkdirSync(path.resolve(config.pgliteDir), { recursive: true });
    dataDir = path.resolve(config.pgliteDir);
  }
  const db = new PGlite(dataDir, { parsers: { [types.INT8]: toNumber } });
  await db.waitReady;
  const norm = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    name: 'pglite',
    exec: (sql) => db.exec(sql),
    query: async (sql, params, client) => norm(await (client ?? db).query(sql, params)),
    transaction: (fn) => db.transaction((tx) => fn(tx)),
    close: () => db.close(),
  };
}

const driver = config.databaseUrl ? await createPgDriver() : await createPgliteDriver();
await driver.exec(SCHEMA);
if (driver.name === 'pglite') console.warn('[db] DATABASE_URL no definido: usando PGlite (solo desarrollo)');

/* ---------- API de consultas ---------- */

const als = new AsyncLocalStorage();

// Los servicios escriben `?`; se convierte a $1, $2… de PostgreSQL
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function exec(sql, params) {
  const store = als.getStore();
  const values = params.map((v) => (v === undefined ? null : v));
  return driver.query(toPg(sql), values, store?.client);
}

export const one = async (sql, ...params) => (await exec(sql, params)).rows[0];
export const all = async (sql, ...params) => (await exec(sql, params)).rows;
export const run = async (sql, ...params) => {
  const r = await exec(sql, params);
  return { changes: r.rowCount, rows: r.rows };
};

export const isUniqueViolation = (error) => error?.code === '23505';

// Ejecuta `fn` tras el COMMIT (p. ej. emitir eventos SSE solo si la transacción se confirmó)
export function afterCommit(fn) {
  const store = als.getStore();
  if (store) store.hooks.push(fn);
  else fn();
}

// Transacción reentrante: dentro de otra transacción solo ejecuta fn
export async function tx(fn) {
  if (als.getStore()) return fn();
  const hooks = [];
  const result = await driver.transaction((client) => als.run({ client, hooks }, fn));
  hooks.forEach((h) => h());
  return result;
}

export const closeDb = () => driver.close();
