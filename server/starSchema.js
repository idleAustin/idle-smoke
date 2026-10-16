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

export const INSPECT_QUERIES = Object.freeze({
  playerCount: 'SELECT COUNT(*) AS count FROM player_dim',
  verifiedShiftTotals: `
    SELECT COUNT(*) AS shift_count, COALESCE(SUM(smoked), 0) AS total_smoked
    FROM shift_fact
    WHERE status = 'verified'
  `,
  environmentBreakdown: `
    SELECT
      e.id,
      e.name,
      e.sector,
      e.unlock_smoked_required AS unlockSmokedRequired,
      COUNT(s.id) AS verifiedShifts,
      COALESCE(SUM(s.smoked), 0) AS totalSmoked
    FROM environment_dim e
    LEFT JOIN shift_fact s
      ON s.environment_id = e.id AND s.status = 'verified'
    GROUP BY e.id, e.name, e.sector, e.unlock_smoked_required
    ORDER BY e.unlock_smoked_required ASC
  `,
  topLeaderboard: `
    SELECT
      p.callsign,
      s.smoked,
      s.environment_id AS environmentId,
      s.completed_at AS completedAt
    FROM shift_fact s
    INNER JOIN player_dim p ON p.id = s.player_id
    WHERE s.status = 'verified'
    ORDER BY s.smoked DESC, s.completed_at ASC
    LIMIT 10
  `,
});

/**
 * @param {Record<string, unknown> | null | undefined} playerRow
 * @param {Record<string, unknown> | null | undefined} shiftRow
 * @param {Array<Record<string, unknown>>} envRows
 * @param {Array<Record<string, unknown>>} leaderboardRows
 */
export function normalizeInspectSummary(playerRow, shiftRow, envRows, leaderboardRows) {
  return {
    totals: {
      totalPlayers: Number(playerRow?.count ?? 0),
      totalVerifiedShifts: Number(shiftRow?.shift_count ?? 0),
      totalSmoked: Number(shiftRow?.total_smoked ?? 0),
    },
    environments: envRows.map(r => ({
      id: String(r.id),
      name: String(r.name),
      sector: String(r.sector),
      unlockSmokedRequired: Number(r.unlockSmokedRequired),
      verifiedShifts: Number(r.verifiedShifts),
      totalSmoked: Number(r.totalSmoked),
    })),
    leaderboard: leaderboardRows.map((r, idx) => ({
      rank: idx + 1,
      callsign: String(r.callsign),
      smoked: Number(r.smoked),
      environmentId: String(r.environmentId),
      completedAt: Number(r.completedAt ?? 0),
    })),
  };
}

export function formatInspectReport(summary) {
  const { totals, environments, leaderboard } = summary;
  const lines = [
    '============================================================',
    ' IDLE SMOKE BREAK — STAR SCHEMA TELEMETRY & LEADERBOARD',
    '============================================================',
    ` Total Players         : ${totals.totalPlayers}`,
    ` Verified Shifts       : ${totals.totalVerifiedShifts}`,
    ` Total Butts Smoked    : ${totals.totalSmoked}`,
    '',
    '--- Break Environment Breakdown (environment_dim) ----------',
  ];

  for (const env of environments) {
    const idCol = env.id.padEnd(16, ' ');
    const nameCol = env.name.padEnd(22, ' ');
    const unlockCol = `unlock@${String(env.unlockSmokedRequired).padStart(2, ' ')}`;
    lines.push(
      ` ${idCol} | ${nameCol} | ${unlockCol} | shifts: ${env.verifiedShifts} | smoked: ${env.totalSmoked}`
    );
  }

  lines.push('', '--- Global Top 10 Leaderboard (shift_fact) -----------------');
  if (leaderboard.length === 0) {
    lines.push(' (No verified shifts recorded yet)');
  } else {
    for (const row of leaderboard) {
      const rankCol = `#${row.rank}`.padEnd(4, ' ');
      const callsignCol = row.callsign.padEnd(16, ' ');
      const envCol = row.environmentId.padEnd(15, ' ');
      lines.push(` ${rankCol} ${callsignCol} | ${row.smoked} butts | ${envCol} | ${row.completedAt}`);
    }
  }
  lines.push('============================================================');
  return lines.join('\n');
}

export const API_SQL = Object.freeze({
  insertPlayer: `
    INSERT INTO player_dim (id, callsign, token_hash, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
  `,
  selectPlayerByTokenHash: `
    SELECT id, callsign, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at
    FROM player_dim
    WHERE token_hash = ?
    UNION ALL
    SELECT p.id, p.callsign, p.platform, p.lifetime_smoked, p.best_smoked, p.shifts_completed, p.created_at, p.updated_at
    FROM player_auth a
    INNER JOIN player_dim p ON p.id = a.player_id
    WHERE a.provider = 'session' AND a.provider_sub = ?
    LIMIT 1
  `,
  selectPlayerById: `
    SELECT id, callsign, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at
    FROM player_dim
    WHERE id = ?
  `,
  selectAuthIdentity: `
    SELECT provider, provider_sub, player_id, secret_hash, email
    FROM player_auth
    WHERE provider = ? AND provider_sub = ?
  `,
  upsertAuthIdentity: `
    INSERT INTO player_auth (provider, provider_sub, player_id, secret_hash, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_sub) DO UPDATE SET
      player_id = excluded.player_id,
      secret_hash = COALESCE(excluded.secret_hash, player_auth.secret_hash),
      email = COALESCE(excluded.email, player_auth.email),
      updated_at = excluded.updated_at
  `,
  updatePlayerCallsign: `
    UPDATE player_dim
    SET callsign = ?, updated_at = ?
    WHERE id = ?
  `,
  insertStartedShift: `
    INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'started', ?, NULL)
  `,
  selectShiftById: `
    SELECT id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at
    FROM shift_fact
    WHERE id = ?
  `,
  updateVerifiedShift: `
    UPDATE shift_fact
    SET environment_id = ?, date_key = ?, platform = ?, smoked = ?, tap_count = ?, duration_ms = ?, status = 'verified', completed_at = ?
    WHERE id = ? AND player_id = ?
  `,
  insertVerifiedShift: `
    INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
  `,
  updateRejectedShift: `
    UPDATE shift_fact
    SET status = 'rejected', completed_at = ?
    WHERE id = ? AND player_id = ?
  `,
  insertRejectedShift: `
    INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'rejected', ?, ?)
  `,
  updatePlayerAfterShift: `
    UPDATE player_dim
    SET
      lifetime_smoked = lifetime_smoked + ?,
      best_smoked = MAX(best_smoked, ?),
      shifts_completed = shifts_completed + 1,
      updated_at = ?
    WHERE id = ?
  `,
});

/**
 * Shared SQL & parameter plan for recording a verified shift across SQLite and D1.
 * @param {{ shiftId: string, hasExistingStartedRow: boolean, playerId: string, environmentId: string, platform: string, smoked: number, tapCount: number, durationMs: number, startedAt: number, completedAt: number }} params
 */
export function buildVerifiedShiftWritePlan(params) {
  const dateRow = buildDateDimRow(new Date(params.completedAt * 1000));
  const dateArgs = [
    dateRow.date_key,
    dateRow.iso_date,
    dateRow.year,
    dateRow.month,
    dateRow.day_of_month,
    dateRow.day_of_week,
  ];
  const shiftSql = params.hasExistingStartedRow ? API_SQL.updateVerifiedShift : API_SQL.insertVerifiedShift;
  const shiftArgs = params.hasExistingStartedRow
    ? [
        params.environmentId,
        dateRow.date_key,
        params.platform,
        params.smoked,
        params.tapCount,
        params.durationMs,
        params.completedAt,
        params.shiftId,
        params.playerId,
      ]
    : [
        params.shiftId,
        params.playerId,
        params.environmentId,
        dateRow.date_key,
        params.platform,
        params.smoked,
        params.tapCount,
        params.durationMs,
        params.startedAt,
        params.completedAt,
      ];
  const playerArgs = [params.smoked, params.smoked, params.completedAt, params.playerId];
  return { dateArgs, shiftSql, shiftArgs, playerArgs };
}

/**
 * Shared SQL & parameter plan for flagging a rejected shift across SQLite and D1.
 * @param {{ shiftId: string, hasExistingStartedRow: boolean, playerId: string, environmentId: string, platform: string, startedAt: number, completedAt: number }} params
 */
export function buildRejectedShiftWritePlan(params) {
  const dateRow = buildDateDimRow(new Date(params.completedAt * 1000));
  const dateArgs = [
    dateRow.date_key,
    dateRow.iso_date,
    dateRow.year,
    dateRow.month,
    dateRow.day_of_month,
    dateRow.day_of_week,
  ];
  const shiftSql = params.hasExistingStartedRow ? API_SQL.updateRejectedShift : API_SQL.insertRejectedShift;
  const shiftArgs = params.hasExistingStartedRow
    ? [params.completedAt, params.shiftId, params.playerId]
    : [
        params.shiftId,
        params.playerId,
        params.environmentId,
        dateRow.date_key,
        params.platform,
        params.startedAt,
        params.completedAt,
      ];
  return { dateArgs, shiftSql, shiftArgs };
}

/**
 * @param {Record<string, unknown>} row
 */
export function formatPlayerProfile(row) {
  const lifetimeSmoked = Number(row.lifetime_smoked ?? 0);
  return {
    playerId: String(row.id),
    callsign: String(row.callsign),
    platform: String(row.platform ?? 'web'),
    lifetimeSmoked,
    bestSmoked: Number(row.best_smoked ?? 0),
    shiftsCompleted: Number(row.shifts_completed ?? 0),
    unlockedEnvironments: getUnlockedEnvironments(lifetimeSmoked),
  };
}

/**
 * @param {ReturnType<typeof normalizeInspectSummary>} summary
 */
export function formatLeaderboardResponse(summary) {
  return {
    entries: summary.leaderboard,
    stats: {
      totalPlayers: summary.totals.totalPlayers,
      totalShifts: summary.totals.totalVerifiedShifts,
      totalSmoked: summary.totals.totalSmoked,
    },
  };
}


