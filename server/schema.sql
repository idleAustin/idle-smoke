-- Canonical Kimball Star Schema DDL (SQLite 3.37+ STRICT & Cloudflare D1 compatible)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS player_dim (
    id                       TEXT    PRIMARY KEY,
    callsign                 TEXT    NOT NULL CHECK (length(callsign) BETWEEN 2 AND 16),
    token_hash               TEXT    NOT NULL UNIQUE,
    platform                 TEXT    NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
    lifetime_smoked          INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_smoked >= 0),
    best_smoked              INTEGER NOT NULL DEFAULT 0 CHECK (best_smoked >= 0),
    shifts_completed         INTEGER NOT NULL DEFAULT 0 CHECK (shifts_completed >= 0),
    promotion_rounds_cleared INTEGER NOT NULL DEFAULT 0 CHECK (promotion_rounds_cleared BETWEEN 0 AND 9),
    avatar_config            TEXT,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS environment_dim (
    id                     TEXT    PRIMARY KEY CHECK (id IN (
      'alleyway',
      'restaurant',
      'parking-garage',
      'dumpster',
      'office-sidewalk',
      'breakroom-patio',
      'strip-mall-median',
      'designated-gazebo',
      'executive-balcony',
      'concert-side-stage',
      'superyacht-aft-deck',
      'penthouse-helipad'
    )),
    name                   TEXT    NOT NULL,
    sector                 TEXT    NOT NULL,
    phase                  INTEGER NOT NULL DEFAULT 1 CHECK (phase IN (1, 2, 3)),
    sector_order           INTEGER NOT NULL DEFAULT 1 CHECK (sector_order BETWEEN 1 AND 12),
    sector_quota_required  INTEGER NOT NULL DEFAULT 5 CHECK (sector_quota_required > 0),
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

CREATE INDEX IF NOT EXISTS idx_shift_fact_player_env_smoked
    ON shift_fact (player_id, status, environment_id, smoked);

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

CREATE TABLE IF NOT EXISTS smoke_session (
    id             TEXT    PRIMARY KEY,
    code           TEXT    NOT NULL CHECK (length(code) = 2),
    host_player_id TEXT    NOT NULL REFERENCES player_dim(id) ON DELETE CASCADE,
    environment_id TEXT    NOT NULL REFERENCES environment_dim(id) ON DELETE RESTRICT,
    status         TEXT    NOT NULL CHECK (status IN ('waiting', 'active', 'completed')),
    created_at     INTEGER NOT NULL,
    started_at     INTEGER,
    completed_at   INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_smoke_session_code
    ON smoke_session (code, status, created_at DESC);

CREATE TABLE IF NOT EXISTS smoke_session_participant (
    session_id   TEXT    NOT NULL REFERENCES smoke_session(id) ON DELETE CASCADE,
    player_id    TEXT    NOT NULL REFERENCES player_dim(id) ON DELETE CASCADE,
    joined_at    INTEGER NOT NULL,
    shift_id     TEXT    REFERENCES shift_fact(id) ON DELETE SET NULL,
    smoked       INTEGER CHECK (smoked IS NULL OR smoked >= 0),
    tap_count    INTEGER CHECK (tap_count IS NULL OR tap_count >= 0),
    duration_ms  INTEGER CHECK (duration_ms IS NULL OR (duration_ms BETWEEN 0 AND 15000)),
    completed_at INTEGER,
    PRIMARY KEY (session_id, player_id)
) STRICT;

INSERT INTO app_config (key, value, updated_at)
VALUES ('schema_version', '4', CAST(strftime('%s', 'now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at;

INSERT INTO environment_dim (id, name, sector, phase, sector_order, sector_quota_required, unlock_smoked_required) VALUES
    ('alleyway', 'Alleyway', 'SECTOR 01 · EAST BRICK ALLEY', 1, 1, 5, 0),
    ('restaurant', 'Behind a Restaurant', 'SECTOR 02 · KITCHEN SERVICE EXIT', 1, 2, 10, 5),
    ('parking-garage', 'Parking Garage', 'SECTOR 03 · SUB-LEVEL B2 DECK', 1, 3, 15, 15),
    ('dumpster', 'By a Dumpster', 'SECTOR 04 · LOADING DOCK CORRAL', 1, 4, 20, 30),
    ('office-sidewalk', 'Office Sidewalk', 'SECTOR 05 · CURBSIDE ASH URN', 2, 5, 25, 50),
    ('breakroom-patio', 'Breakroom Patio', 'SECTOR 06 · CONCRETE PICNIC TABLE', 2, 6, 30, 75),
    ('strip-mall-median', 'Strip-Mall Median', 'SECTOR 07 · RETENTION POND GRAVEL', 2, 7, 35, 105),
    ('designated-gazebo', 'Designated Gazebo', 'SECTOR 08 · PLEXIGLASS SMOKING SHED', 2, 8, 40, 140),
    ('executive-balcony', 'Executive Balcony', 'SECTOR 09 · 84TH FLOOR CORNER TERRACE', 3, 9, 50, 180),
    ('concert-side-stage', 'Concert Side-Stage', 'SECTOR 10 · VIP ALL-ACCESS RISER', 3, 10, 60, 230),
    ('superyacht-aft-deck', 'Superyacht Aft Deck', 'SECTOR 11 · MONACO HARBOR MOORING', 3, 11, 75, 290),
    ('penthouse-helipad', 'Penthouse Helipad', 'SECTOR 12 · SOVEREIGN ROOFTOP PAD', 3, 12, 100, 365)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    sector = excluded.sector,
    phase = excluded.phase,
    sector_order = excluded.sector_order,
    sector_quota_required = excluded.sector_quota_required,
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
