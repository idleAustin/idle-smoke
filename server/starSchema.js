// Star schema DDL, SQLite pragmas, environment unlock thresholds, seed data, and date-dimension key builder.
export const UNLOCK_THRESHOLDS = Object.freeze({
  alleyway: 0,
  restaurant: 5,
  'parking-garage': 15,
  dumpster: 30,
});

export const ENVIRONMENT_SEEDS = Object.freeze([
  {
    id: 'alleyway',
    name: 'Alleyway',
    sector: 'SECTOR 01 · EAST BRICK ALLEY',
    unlock_smoked_required: UNLOCK_THRESHOLDS.alleyway,
  },
  {
    id: 'restaurant',
    name: 'Behind a Restaurant',
    sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
    unlock_smoked_required: UNLOCK_THRESHOLDS.restaurant,
  },
  {
    id: 'parking-garage',
    name: 'Parking Garage',
    sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
    unlock_smoked_required: UNLOCK_THRESHOLDS['parking-garage'],
  },
  {
    id: 'dumpster',
    name: 'By a Dumpster',
    sector: 'SECTOR 04 · LOADING DOCK CORRAL',
    unlock_smoked_required: UNLOCK_THRESHOLDS.dumpster,
  },
]);

/**
 * @param {number} lifetimeSmoked
 * @returns {Array<'alleyway' | 'restaurant' | 'parking-garage' | 'dumpster'>}
 */
export function getUnlockedEnvironments(lifetimeSmoked) {
  const safeTotal = Number.isFinite(lifetimeSmoked) && lifetimeSmoked > 0 ? Math.floor(lifetimeSmoked) : 0;
  return /** @type {Array<'alleyway' | 'restaurant' | 'parking-garage' | 'dumpster'>} */ (
    ENVIRONMENT_SEEDS
      .filter(env => safeTotal >= env.unlock_smoked_required)
      .map(env => env.id)
  );
}

export const SQLITE_PRAGMA_STATEMENTS = Object.freeze([
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  'PRAGMA synchronous = NORMAL;',
  'PRAGMA cache_size = -64000;',
  'PRAGMA temp_store = MEMORY;',
  'PRAGMA busy_timeout = 5000;',
]);

export const STAR_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS player_dim (
    id               TEXT    PRIMARY KEY,
    callsign         TEXT    NOT NULL CHECK (length(callsign) BETWEEN 2 AND 16),
    token_hash       TEXT    NOT NULL UNIQUE,
    platform         TEXT    NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
    lifetime_smoked  INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_smoked >= 0),
    best_smoked      INTEGER NOT NULL DEFAULT 0 CHECK (best_smoked >= 0),
    shifts_completed INTEGER NOT NULL DEFAULT 0 CHECK (shifts_completed >= 0),
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS environment_dim (
    id                     TEXT    PRIMARY KEY CHECK (id IN ('alleyway', 'restaurant', 'parking-garage', 'dumpster')),
    name                   TEXT    NOT NULL,
    sector                 TEXT    NOT NULL,
    unlock_smoked_required INTEGER NOT NULL CHECK (unlock_smoked_required >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS date_dim (
    date_key     INTEGER PRIMARY KEY,
    iso_date     TEXT    NOT NULL UNIQUE,
    year         INTEGER NOT NULL,
    month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6)
) STRICT;

CREATE TABLE IF NOT EXISTS shift_fact (
    id             TEXT    PRIMARY KEY,
    player_id      TEXT    NOT NULL REFERENCES player_dim(id) ON DELETE CASCADE,
    environment_id TEXT    NOT NULL REFERENCES environment_dim(id) ON DELETE RESTRICT,
    date_key       INTEGER NOT NULL REFERENCES date_dim(date_key) ON DELETE RESTRICT,
    platform       TEXT    NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
    smoked         INTEGER NOT NULL DEFAULT 0 CHECK (smoked >= 0),
    tap_count      INTEGER NOT NULL DEFAULT 0 CHECK (tap_count >= 0),
    duration_ms    INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 15000),
    status         TEXT    NOT NULL CHECK (status IN ('started', 'verified', 'rejected')),
    started_at     INTEGER NOT NULL,
    completed_at   INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_shift_fact_leaderboard
    ON shift_fact (smoked DESC, completed_at ASC, player_id, environment_id, id)
    WHERE status = 'verified';

CREATE INDEX IF NOT EXISTS idx_shift_fact_player
    ON shift_fact (player_id, completed_at DESC, smoked, id);

CREATE INDEX IF NOT EXISTS idx_player_dim_best
    ON player_dim (best_smoked DESC, lifetime_smoked DESC, callsign, id);

CREATE TABLE IF NOT EXISTS player_auth (
    provider     TEXT    NOT NULL CHECK (provider IN ('password', 'google', 'apple', 'session')),
    provider_sub TEXT    NOT NULL,
    player_id    TEXT    NOT NULL REFERENCES player_dim(id) ON DELETE CASCADE,
    secret_hash  TEXT,
    email        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_sub)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_player_auth_player
    ON player_auth (player_id, provider);

CREATE TABLE IF NOT EXISTS tagline_dim (
    id         INTEGER PRIMARY KEY,
    joke_text  TEXT    NOT NULL UNIQUE CHECK (length(joke_text) BETWEEN 3 AND 280),
    is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
`;

export const DEFAULT_TAGLINE_CADENCE = '60s';
export const VALID_TAGLINE_CADENCES = Object.freeze(['60s', '5m', '15m', '1h', 'daily', 'per_shift']);

export const TAGLINE_SEEDS = Object.freeze([
  "you're always allotted 15 minutes for a smoke break.",
  "the productivity metrics are made up and the shift clock doesn't matter.",
  'OSHA is just a four-letter word we mutter by the dumpster.',
  "your supervisor still thinks you're looking for a pallet jack.",
  'every drag counts as cardiovascular training on the company health plan.',
  'the cherry burns faster than your quarterly performance review.',
  'second-hand smoke is the only team-building exercise that actually works.',
  "the forklift battery isn't the only thing getting smoked behind Bay 4.",
  'HR calls it time theft, but we call it spiritual alignment.',
  'the ashtray has more structural integrity than upper management.',
  'clocking back in is strictly a suggestion, not a lifestyle.',
  "the loading dock breeze is the closest thing you'll get to PTO.",
]);

export const SEED_TAGLINE_IF_INITIAL_SQL = `
INSERT INTO tagline_dim (joke_text, is_active, created_at)
SELECT ?, 1, ?
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'taglines_seeded_v2')
ON CONFLICT(joke_text) DO NOTHING
`;

export const MARK_TAGLINES_SEEDED_SQL = `
INSERT INTO app_config (key, value, updated_at)
VALUES ('taglines_seeded_v2', '1', ?)
ON CONFLICT(key) DO NOTHING
`;

export const ENSURE_DEFAULT_CADENCE_SQL = `
INSERT INTO app_config (key, value, updated_at)
VALUES ('tagline_cadence', '60s', ?)
ON CONFLICT(key) DO NOTHING
`;

export const UPSERT_ENVIRONMENT_DIM_SQL = `
INSERT INTO environment_dim (id, name, sector, unlock_smoked_required)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  sector = excluded.sector,
  unlock_smoked_required = excluded.unlock_smoked_required
`;

export const INSERT_DATE_DIM_SQL = `
INSERT INTO date_dim (date_key, iso_date, year, month, day_of_month, day_of_week)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(date_key) DO NOTHING
`;

export function buildDateDimRow(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day_of_month = d.getUTCDate();
  const day_of_week = d.getUTCDay();
  const mm = String(month).padStart(2, '0');
  const dd = String(day_of_month).padStart(2, '0');
  const iso_date = `${year}-${mm}-${dd}`;
  const date_key = year * 10000 + month * 100 + day_of_month;

  return {
    date_key,
    iso_date,
    year,
    month,
    day_of_month,
    day_of_week,
  };
}
