// Star schema DDL, SQLite pragmas, 12-sector progression thresholds, seed data, and Promotion gauntlet evaluator.
export const SCHEMA_VERSION = '3';

export const UNLOCK_THRESHOLDS = Object.freeze({
  alleyway: 0,
  restaurant: 5,
  'parking-garage': 15,
  dumpster: 30,
  'office-sidewalk': 50,
  'breakroom-patio': 75,
  'strip-mall-median': 105,
  'designated-gazebo': 140,
  'executive-balcony': 180,
  'concert-side-stage': 230,
  'superyacht-aft-deck': 290,
  'penthouse-helipad': 365,
});

export const SECTOR_QUOTAS = Object.freeze({
  alleyway: 5,
  restaurant: 10,
  'parking-garage': 15,
  dumpster: 20,
  'office-sidewalk': 25,
  'breakroom-patio': 30,
  'strip-mall-median': 35,
  'designated-gazebo': 40,
  'executive-balcony': 50,
  'concert-side-stage': 60,
  'superyacht-aft-deck': 75,
  'penthouse-helipad': 100,
});

export const CAMPAIGN_PHASES = Object.freeze([
  Object.freeze({
    phase: 1,
    code: 'PHASE 01',
    name: 'Started from the Bottom',
    subtitle: 'Service Grit · Back-of-House & Loading Docks',
    finalSectorId: 'dumpster',
    promoTitle: 'Shift Lead Evaluation',
    rewardSummary: 'Unlocks Phase 02 · Middle Class',
    promotionTargets: Object.freeze([10, 15, 20]),
  }),
  Object.freeze({
    phase: 2,
    code: 'PHASE 02',
    name: 'Middle Class',
    subtitle: 'Corporate Park · Fluorescent Cubicle Purgatory',
    finalSectorId: 'designated-gazebo',
    promoTitle: 'HR Compliance Review',
    rewardSummary: 'Unlocks Phase 03 · White-Collar',
    promotionTargets: Object.freeze([15, 20, 25]),
  }),
  Object.freeze({
    phase: 3,
    code: 'PHASE 03',
    name: 'White-Collar',
    subtitle: 'Executive Peak · Penthouse & Sovereign Luxury',
    finalSectorId: 'penthouse-helipad',
    promoTitle: 'Boardroom Coronation',
    rewardSummary: 'Unlocks Chairman of the Ash Title',
    promotionTargets: Object.freeze([20, 25, 30]),
  }),
]);

export const ENVIRONMENT_SEEDS = Object.freeze([
  {
    id: 'alleyway',
    name: 'Alleyway',
    sector: 'SECTOR 01 · EAST BRICK ALLEY',
    phase: 1,
    sector_order: 1,
    sector_quota_required: SECTOR_QUOTAS.alleyway,
    unlock_smoked_required: UNLOCK_THRESHOLDS.alleyway,
  },
  {
    id: 'restaurant',
    name: 'Behind a Restaurant',
    sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
    phase: 1,
    sector_order: 2,
    sector_quota_required: SECTOR_QUOTAS.restaurant,
    unlock_smoked_required: UNLOCK_THRESHOLDS.restaurant,
  },
  {
    id: 'parking-garage',
    name: 'Parking Garage',
    sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
    phase: 1,
    sector_order: 3,
    sector_quota_required: SECTOR_QUOTAS['parking-garage'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['parking-garage'],
  },
  {
    id: 'dumpster',
    name: 'By a Dumpster',
    sector: 'SECTOR 04 · LOADING DOCK CORRAL',
    phase: 1,
    sector_order: 4,
    sector_quota_required: SECTOR_QUOTAS.dumpster,
    unlock_smoked_required: UNLOCK_THRESHOLDS.dumpster,
  },
  {
    id: 'office-sidewalk',
    name: 'Office Sidewalk',
    sector: 'SECTOR 05 · CURBSIDE ASH URN',
    phase: 2,
    sector_order: 5,
    sector_quota_required: SECTOR_QUOTAS['office-sidewalk'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['office-sidewalk'],
  },
  {
    id: 'breakroom-patio',
    name: 'Breakroom Patio',
    sector: 'SECTOR 06 · CONCRETE PICNIC TABLE',
    phase: 2,
    sector_order: 6,
    sector_quota_required: SECTOR_QUOTAS['breakroom-patio'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['breakroom-patio'],
  },
  {
    id: 'strip-mall-median',
    name: 'Strip-Mall Median',
    sector: 'SECTOR 07 · RETENTION POND GRAVEL',
    phase: 2,
    sector_order: 7,
    sector_quota_required: SECTOR_QUOTAS['strip-mall-median'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['strip-mall-median'],
  },
  {
    id: 'designated-gazebo',
    name: 'Designated Gazebo',
    sector: 'SECTOR 08 · PLEXIGLASS SMOKING SHED',
    phase: 2,
    sector_order: 8,
    sector_quota_required: SECTOR_QUOTAS['designated-gazebo'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['designated-gazebo'],
  },
  {
    id: 'executive-balcony',
    name: 'Executive Balcony',
    sector: 'SECTOR 09 · 84TH FLOOR CORNER TERRACE',
    phase: 3,
    sector_order: 9,
    sector_quota_required: SECTOR_QUOTAS['executive-balcony'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['executive-balcony'],
  },
  {
    id: 'concert-side-stage',
    name: 'Concert Side-Stage',
    sector: 'SECTOR 10 · VIP ALL-ACCESS RISER',
    phase: 3,
    sector_order: 10,
    sector_quota_required: SECTOR_QUOTAS['concert-side-stage'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['concert-side-stage'],
  },
  {
    id: 'superyacht-aft-deck',
    name: 'Superyacht Aft Deck',
    sector: 'SECTOR 11 · MONACO HARBOR MOORING',
    phase: 3,
    sector_order: 11,
    sector_quota_required: SECTOR_QUOTAS['superyacht-aft-deck'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['superyacht-aft-deck'],
  },
  {
    id: 'penthouse-helipad',
    name: 'Penthouse Helipad',
    sector: 'SECTOR 12 · SOVEREIGN ROOFTOP PAD',
    phase: 3,
    sector_order: 12,
    sector_quota_required: SECTOR_QUOTAS['penthouse-helipad'],
    unlock_smoked_required: UNLOCK_THRESHOLDS['penthouse-helipad'],
  },
]);

/**
 * Returns the highest unlocked Campaign Phase (1, 2, or 3) based on `promotionRoundsCleared` (0..9).
 * @param {number | undefined | null} promotionRoundsCleared
 * @param {boolean} [isAdmin]
 * @returns {1 | 2 | 3}
 */
export function getUnlockedPhase(promotionRoundsCleared, isAdmin = false) {
  if (isAdmin === true) return 3;
  const safeRounds =
    typeof promotionRoundsCleared === 'number' && Number.isFinite(promotionRoundsCleared)
      ? Math.max(0, Math.min(9, Math.floor(promotionRoundsCleared)))
      : 0;
  if (safeRounds >= 6) return 3;
  if (safeRounds >= 3) return 2;
  return 1;
}

/**
 * Returns whether all 4 sectors in a Phase have met their individual sector quotas.
 * @param {1 | 2 | 3 | number} phase
 * @param {Record<string, number> | undefined | null} smokedByEnvironment
 * @param {boolean} [isAdmin]
 * @returns {boolean}
 */
export function isPhasePromotionUnlocked(phase, smokedByEnvironment, isAdmin = false) {
  if (isAdmin === true) return true;
  const phaseSectors = ENVIRONMENT_SEEDS.filter(env => env.phase === phase);
  if (phaseSectors.length === 0) return false;
  return phaseSectors.every(env => {
    const count = Number(smokedByEnvironment?.[env.id] ?? 0);
    return count >= env.sector_quota_required;
  });
}

/**
 * Evaluates whether a verified shift advances the player's checkpointed Promotion round.
 * - Requires all 4 sectors of the active Phase to have met their sector quotas PRIOR to the shift.
 * - Requires the shift to take place in that Phase's 4th sector (`dumpster`, `designated-gazebo`, or `penthouse-helipad`).
 * - Advances by at most +1 round (`promotionDelta: 0 | 1`) when `shiftSmoked >= targetSmoked`.
 * @param {{
 *   environmentId: string,
 *   shiftSmoked: number,
 *   smokedByEnvironmentBeforeShift: Record<string, number> | undefined | null,
 *   promotionRoundsClearedBeforeShift: number | undefined | null
 * }} params
 */
export function evaluatePromotionAttempt({
  environmentId,
  shiftSmoked,
  smokedByEnvironmentBeforeShift,
  promotionRoundsClearedBeforeShift,
}) {
  const currentRounds =
    typeof promotionRoundsClearedBeforeShift === 'number' &&
    Number.isFinite(promotionRoundsClearedBeforeShift)
      ? Math.max(0, Math.min(9, Math.floor(promotionRoundsClearedBeforeShift)))
      : 0;

  if (currentRounds >= 9) {
    return {
      promotionDelta: 0,
      newPromotionRoundsCleared: 9,
      unlockedPhase: 3,
      isChairman: true,
    };
  }

  const activePhaseNum = Math.floor(currentRounds / 3) + 1;
  const roundIndexInPhase = currentRounds % 3;
  const phaseMeta = CAMPAIGN_PHASES.find(p => p.phase === activePhaseNum);

  if (
    !phaseMeta ||
    environmentId !== phaseMeta.finalSectorId ||
    !isPhasePromotionUnlocked(activePhaseNum, smokedByEnvironmentBeforeShift)
  ) {
    return {
      promotionDelta: 0,
      newPromotionRoundsCleared: currentRounds,
      unlockedPhase: getUnlockedPhase(currentRounds),
      isChairman: currentRounds >= 9,
    };
  }

  const targetSmoked = phaseMeta.promotionTargets[roundIndexInPhase];
  if (Number(shiftSmoked) >= targetSmoked) {
    const nextRounds = Math.min(9, currentRounds + 1);
    return {
      promotionDelta: 1,
      newPromotionRoundsCleared: nextRounds,
      unlockedPhase: getUnlockedPhase(nextRounds),
      isChairman: nextRounds >= 9,
    };
  }

  return {
    promotionDelta: 0,
    newPromotionRoundsCleared: currentRounds,
    unlockedPhase: getUnlockedPhase(currentRounds),
    isChairman: currentRounds >= 9,
  };
}

/**
 * Dual-signature environment unlock evaluator:
 * 1) `getUnlockedEnvironments({ smokedByEnvironment, promotionRoundsCleared, isAdmin })`
 *    Evaluates sequential per-sector quotas across unlocked Phases.
 *    Within each unlocked Phase, sector 1 is always unlocked, and sector N (N=2..4)
 *    is unlocked iff every preceding sector in that Phase has `smokedByEnvironment[prev.id] >= prev.sector_quota_required`.
 * 2) `getUnlockedEnvironments(lifetimeSmoked)` (legacy numeric fallback)
 *    Evaluates Phase 1 environments against `unlock_smoked_required` (0, 5, 15, 30).
 * @param {number | { smokedByEnvironment?: Record<string, number>, promotionRoundsCleared?: number, isAdmin?: boolean } | undefined | null} input
 * @returns {string[]}
 */
export function getUnlockedEnvironments(input) {
  if (typeof input === 'number' || input === undefined || input === null) {
    const safeTotal =
      typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
    return ENVIRONMENT_SEEDS
      .filter(env => env.phase === 1 && safeTotal >= env.unlock_smoked_required)
      .map(env => env.id);
  }

  if (input && typeof input === 'object' && input.isAdmin === true) {
    return ENVIRONMENT_SEEDS.map(env => env.id);
  }

  const smokedByEnvironment =
    input && typeof input === 'object' && input.smokedByEnvironment
      ? input.smokedByEnvironment
      : {};
  const maxUnlockedPhase = getUnlockedPhase(input?.promotionRoundsCleared);

  /** @type {string[]} */
  const unlocked = [];
  for (let phase = 1; phase <= maxUnlockedPhase; phase += 1) {
    const phaseSectors = ENVIRONMENT_SEEDS
      .filter(env => env.phase === phase)
      .sort((a, b) => a.sector_order - b.sector_order);

    for (let i = 0; i < phaseSectors.length; i += 1) {
      const sector = phaseSectors[i];
      if (i === 0) {
        unlocked.push(sector.id);
      } else {
        const prevSector = phaseSectors[i - 1];
        const prevSmoked = Number(smokedByEnvironment[prevSector.id] ?? 0);
        if (prevSmoked >= prevSector.sector_quota_required) {
          unlocked.push(sector.id);
        } else {
          break;
        }
      }
    }
  }

  return unlocked;
}

export const SQLITE_PRAGMA_STATEMENTS = Object.freeze([
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  'PRAGMA synchronous = NORMAL;',
  'PRAGMA cache_size = -64000;',
  'PRAGMA temp_store = MEMORY;',
  'PRAGMA busy_timeout = 5000;',
]);

export const ENVIRONMENT_DIM_DDL = `
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
`.trim();

export const STAR_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS player_dim (
    id                       TEXT    PRIMARY KEY,
    callsign                 TEXT    NOT NULL CHECK (length(callsign) BETWEEN 2 AND 16),
    token_hash               TEXT    NOT NULL UNIQUE,
    platform                 TEXT    NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
    lifetime_smoked          INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_smoked >= 0),
    best_smoked              INTEGER NOT NULL DEFAULT 0 CHECK (best_smoked >= 0),
    shifts_completed         INTEGER NOT NULL DEFAULT 0 CHECK (shifts_completed >= 0),
    promotion_rounds_cleared INTEGER NOT NULL DEFAULT 0 CHECK (promotion_rounds_cleared BETWEEN 0 AND 9),
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
) STRICT;

${ENVIRONMENT_DIM_DDL}

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

export const UPSERT_SCHEMA_VERSION_SQL = `
INSERT INTO app_config (key, value, updated_at)
VALUES ('schema_version', ?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at
`;

export const UPSERT_ENVIRONMENT_DIM_SQL = `
INSERT INTO environment_dim (id, name, sector, phase, sector_order, sector_quota_required, unlock_smoked_required)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  sector = excluded.sector,
  phase = excluded.phase,
  sector_order = excluded.sector_order,
  sector_quota_required = excluded.sector_quota_required,
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
