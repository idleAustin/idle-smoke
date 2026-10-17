-- Canonical Kimball Star Schema DDL (SQLite 3.37+ STRICT & Cloudflare D1 compatible)
PRAGMA foreign_keys = ON;

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

INSERT INTO environment_dim (id, name, sector, unlock_smoked_required) VALUES
    ('alleyway', 'Alleyway', 'SECTOR 01 · EAST BRICK ALLEY', 0),
    ('restaurant', 'Behind a Restaurant', 'SECTOR 02 · KITCHEN SERVICE EXIT', 5),
    ('parking-garage', 'Parking Garage', 'SECTOR 03 · SUB-LEVEL B2 DECK', 15),
    ('dumpster', 'By a Dumpster', 'SECTOR 04 · LOADING DOCK CORRAL', 30)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    sector = excluded.sector,
    unlock_smoked_required = excluded.unlock_smoked_required;

INSERT INTO date_dim (date_key, iso_date, year, month, day_of_month, day_of_week)
VALUES (
    CAST(strftime('%Y%m%d', 'now') AS INTEGER),
    strftime('%Y-%m-%d', 'now'),
    CAST(strftime('%Y', 'now') AS INTEGER),
    CAST(strftime('%m', 'now') AS INTEGER),
    CAST(strftime('%d', 'now') AS INTEGER),
    CAST(strftime('%w', 'now') AS INTEGER)
)
ON CONFLICT(date_key) DO NOTHING;
