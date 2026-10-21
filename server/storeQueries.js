// Shared SQL queries, shift write-plan builders, and row formatters for SQLite and Cloudflare D1 stores.
import {
  ENVIRONMENT_SEEDS,
  buildDateDimRow,
  getUnlockedEnvironments,
  getUnlockedPhase,
} from './starSchema.js';

export const SMOKE_SESSION_TTL_SECONDS = 600;

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
    INSERT INTO player_dim (id, callsign, token_hash, platform, lifetime_smoked, best_smoked, shifts_completed, promotion_rounds_cleared, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
  `,
  selectPlayerByTokenHash: `
    SELECT
      id, callsign, platform, lifetime_smoked, best_smoked, shifts_completed, promotion_rounds_cleared, created_at, updated_at,
      (SELECT provider FROM player_auth WHERE player_id = player_dim.id AND provider IN ('apple', 'google', 'password') ORDER BY updated_at DESC LIMIT 1) AS auth_provider,
      (SELECT email FROM player_auth WHERE player_id = player_dim.id AND email IS NOT NULL ORDER BY updated_at DESC LIMIT 1) AS auth_email
    FROM player_dim
    WHERE token_hash = ?
    UNION ALL
    SELECT
      p.id, p.callsign, p.platform, p.lifetime_smoked, p.best_smoked, p.shifts_completed, p.promotion_rounds_cleared, p.created_at, p.updated_at,
      (SELECT provider FROM player_auth WHERE player_id = p.id AND provider IN ('apple', 'google', 'password') ORDER BY updated_at DESC LIMIT 1) AS auth_provider,
      (SELECT email FROM player_auth WHERE player_id = p.id AND email IS NOT NULL ORDER BY updated_at DESC LIMIT 1) AS auth_email
    FROM player_auth a
    INNER JOIN player_dim p ON p.id = a.player_id
    WHERE a.provider = 'session' AND a.provider_sub = ?
    LIMIT 1
  `,
  selectPlayerById: `
    SELECT
      id, callsign, platform, lifetime_smoked, best_smoked, shifts_completed, promotion_rounds_cleared, created_at, updated_at,
      (SELECT provider FROM player_auth WHERE player_id = player_dim.id AND provider IN ('apple', 'google', 'password') ORDER BY updated_at DESC LIMIT 1) AS auth_provider,
      (SELECT email FROM player_auth WHERE player_id = player_dim.id AND email IS NOT NULL ORDER BY updated_at DESC LIMIT 1) AS auth_email
    FROM player_dim
    WHERE id = ?
  `,
  selectPlayerSmokedByEnvironment: `
    SELECT environment_id, COALESCE(SUM(smoked), 0) AS total_smoked
    FROM shift_fact
    WHERE player_id = ? AND status = 'verified'
    GROUP BY environment_id
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
  deletePlayerShifts: `
    DELETE FROM shift_fact
    WHERE player_id = ?
  `,
  deletePlayerAuth: `
    DELETE FROM player_auth
    WHERE player_id = ?
  `,
  deletePlayerDim: `
    DELETE FROM player_dim
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
      promotion_rounds_cleared = MIN(9, promotion_rounds_cleared + ?),
      updated_at = ?
    WHERE id = ?
  `,
  selectTaglineCadence: `
    SELECT value FROM app_config WHERE key = 'tagline_cadence'
  `,
  upsertTaglineCadence: `
    INSERT INTO app_config (key, value, updated_at)
    VALUES ('tagline_cadence', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  selectActiveTaglines: `
    SELECT id, joke_text, is_active, created_at
    FROM tagline_dim
    WHERE is_active = 1
    ORDER BY id ASC
  `,
  selectAllTaglines: `
    SELECT id, joke_text, is_active, created_at
    FROM tagline_dim
    ORDER BY id DESC
  `,
  insertTagline: `
    INSERT INTO tagline_dim (joke_text, is_active, created_at)
    VALUES (?, 1, ?)
    ON CONFLICT(joke_text) DO UPDATE SET is_active = 1
  `,
  updateTaglineById: `
    UPDATE tagline_dim
    SET joke_text = COALESCE(?, joke_text),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `,
  deleteTaglineById: `
    DELETE FROM tagline_dim
    WHERE id = ?
  `,
  deletePlayerSmokeSessionParticipants: `
    DELETE FROM smoke_session_participant
    WHERE player_id = ?
  `,
  deletePlayerSmokeSessions: `
    DELETE FROM smoke_session
    WHERE host_player_id = ?
  `,
  selectActiveSessionCodes: `
    SELECT DISTINCT code
    FROM smoke_session
    WHERE status IN ('waiting', 'active') AND created_at >= ?
  `,
  insertSmokeSession: `
    INSERT INTO smoke_session (id, code, host_player_id, environment_id, status, created_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, 'waiting', ?, NULL, NULL)
  `,
  upsertSmokeSessionParticipant: `
    INSERT INTO smoke_session_participant (session_id, player_id, joined_at, shift_id, smoked, tap_count, duration_ms, completed_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT(session_id, player_id) DO NOTHING
  `,
  selectSmokeSessionById: `
    SELECT id, code, host_player_id, environment_id, status, created_at, started_at, completed_at
    FROM smoke_session
    WHERE id = ?
  `,
  selectSmokeSessionByCode: `
    SELECT id, code, host_player_id, environment_id, status, created_at, started_at, completed_at
    FROM smoke_session
    WHERE code = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 1
  `,
  selectSmokeSessionParticipants: `
    SELECT
      sp.session_id,
      sp.player_id,
      p.callsign,
      sp.joined_at,
      sp.shift_id,
      sp.smoked,
      sp.tap_count,
      sp.duration_ms,
      sp.completed_at
    FROM smoke_session_participant sp
    INNER JOIN player_dim p ON p.id = sp.player_id
    WHERE sp.session_id = ?
    ORDER BY sp.joined_at ASC
  `,
  startSmokeSession: `
    UPDATE smoke_session
    SET status = 'active', started_at = ?
    WHERE id = ? AND host_player_id = ? AND status = 'waiting'
  `,
  recordSmokeSessionParticipantShift: `
    UPDATE smoke_session_participant
    SET shift_id = ?, smoked = ?, tap_count = ?, duration_ms = ?, completed_at = ?
    WHERE session_id = ? AND player_id = ?
  `,
  completeSmokeSessionIfAllDone: `
    UPDATE smoke_session
    SET status = 'completed', completed_at = ?
    WHERE id = ?
      AND status != 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM smoke_session_participant
        WHERE session_id = smoke_session.id AND completed_at IS NULL
      )
  `,
});

/**
 * Shared SQL & parameter plan for recording a verified shift across SQLite and D1.
 * @param {{ shiftId: string, hasExistingStartedRow: boolean, playerId: string, environmentId: string, platform: string, smoked: number, tapCount: number, durationMs: number, startedAt: number, completedAt: number, promotionDelta?: 0 | 1 | number }} params
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
  const safePromotionDelta = params.promotionDelta === 1 ? 1 : 0;
  const playerArgs = [
    params.smoked,
    params.smoked,
    safePromotionDelta,
    params.completedAt,
    params.playerId,
  ];
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
 * @param {unknown} email
 * @param {unknown} [rawAdminEmails]
 */
export function isEmailInAdminList(email, rawAdminEmails) {
  if (!email || typeof email !== 'string') return false;
  if (typeof rawAdminEmails !== 'string' || rawAdminEmails.trim().length === 0) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  const list = rawAdminEmails
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(normalized);
}

/**
 * Normalizes an array of `{ environment_id, total_smoked }` rows or an object map
 * into a complete 12-sector `{ [environmentId]: count }` dictionary.
 * @param {Array<Record<string, unknown>> | Record<string, unknown> | null | undefined} input
 * @param {number} [fallbackLifetimeSmoked]
 * @returns {Record<string, number>}
 */
export function buildSmokedByEnvironmentMap(input, fallbackLifetimeSmoked = 0) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const env of ENVIRONMENT_SEEDS) {
    out[env.id] = 0;
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      const envId = String(row?.environment_id ?? '');
      if (envId in out) {
        const count = Number(row?.total_smoked ?? 0);
        out[envId] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      }
    }
  } else if (input && typeof input === 'object') {
    for (const env of ENVIRONMENT_SEEDS) {
      const count = Number(/** @type {Record<string, unknown>} */ (input)[env.id] ?? 0);
      out[envIdOrFallback(env.id)] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    }
  }
  if (
    Number.isFinite(fallbackLifetimeSmoked) &&
    fallbackLifetimeSmoked > 0 &&
    Object.values(out).every(v => v === 0)
  ) {
    out.alleyway = Math.floor(fallbackLifetimeSmoked);
  }
  return out;
}

/** @param {string} id */
function envIdOrFallback(id) {
  return id;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} [rawAdminEmails]
 */
export function formatPlayerProfile(row, rawAdminEmails) {
  const lifetimeSmoked = Number(row.lifetime_smoked ?? 0);
  const rawPromo = Number(row.promotion_rounds_cleared ?? 0);
  const promotionRoundsCleared = Number.isFinite(rawPromo)
    ? Math.max(0, Math.min(9, Math.floor(rawPromo)))
    : 0;
  const rawSmokedByEnv = row.smoked_by_environment ?? row.smokedByEnvironment;
  const smokedByEnvironment = buildSmokedByEnvironmentMap(
    /** @type {Record<string, unknown> | Array<Record<string, unknown>> | undefined} */ (rawSmokedByEnv),
    lifetimeSmoked
  );
  const unlockedPhase = getUnlockedPhase(promotionRoundsCleared);
  const isChairman = promotionRoundsCleared >= 9;
  const unlockedEnvironments = rawSmokedByEnv
    ? getUnlockedEnvironments({ smokedByEnvironment, promotionRoundsCleared })
    : getUnlockedEnvironments(lifetimeSmoked);
  const authProvider = row.auth_provider ? String(row.auth_provider) : undefined;
  const authEmail = row.auth_email ? String(row.auth_email) : undefined;
  const isAdmin =
    Boolean(authProvider) && isEmailInAdminList(authEmail, rawAdminEmails);
  return {
    playerId: String(row.id),
    callsign: String(row.callsign),
    platform: String(row.platform ?? 'web'),
    lifetimeSmoked,
    bestSmoked: Number(row.best_smoked ?? 0),
    shiftsCompleted: Number(row.shifts_completed ?? 0),
    smokedByEnvironment,
    promotionRoundsCleared,
    unlockedPhase,
    isChairman,
    unlockedEnvironments,
    ...(authProvider ? { authProvider } : {}),
    ...(authEmail ? { authEmail } : {}),
    ...(isAdmin ? { isAdmin: true } : {}),
  };
}

/**
 * @param {Record<string, unknown>} row
 */
export function formatTaglineRow(row) {
  return {
    id: Number(row.id),
    jokeText: String(row.joke_text),
    isActive: Number(row.is_active) === 1,
    createdAt: Number(row.created_at ?? 0),
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

/**
 * Formats a smoke_session row and its joined participant rows into a ranked SmokeSession payload.
 * @param {Record<string, unknown> | null | undefined} sessionRow
 * @param {Array<Record<string, unknown>>} [participantRows]
 */
export function formatSmokeSession(sessionRow, participantRows = []) {
  if (!sessionRow) return null;
  const hostPlayerId = String(sessionRow.host_player_id);
  const mapped = participantRows.map(r => {
    const finished = r.completed_at !== null && r.completed_at !== undefined;
    return {
      playerId: String(r.player_id),
      callsign: String(r.callsign),
      isHost: String(r.player_id) === hostPlayerId,
      joinedAt: Number(r.joined_at ?? 0),
      finished,
      smoked: r.smoked !== null && r.smoked !== undefined ? Number(r.smoked) : null,
      tapCount: r.tap_count !== null && r.tap_count !== undefined ? Number(r.tap_count) : null,
      durationMs: r.duration_ms !== null && r.duration_ms !== undefined ? Number(r.duration_ms) : null,
      completedAt: finished ? Number(r.completed_at) : null,
    };
  });

  mapped.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) {
      const smokedDiff = (b.smoked ?? 0) - (a.smoked ?? 0);
      if (smokedDiff !== 0) return smokedDiff;
      const tapDiff = (b.tapCount ?? 0) - (a.tapCount ?? 0);
      if (tapDiff !== 0) return tapDiff;
      const completedDiff = (a.completedAt ?? 0) - (b.completedAt ?? 0);
      if (completedDiff !== 0) return completedDiff;
    }
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return a.callsign.localeCompare(b.callsign);
  });

  return {
    sessionId: String(sessionRow.id),
    code: String(sessionRow.code),
    hostPlayerId,
    environmentId: String(sessionRow.environment_id),
    status: String(sessionRow.status),
    createdAt: Number(sessionRow.created_at ?? 0),
    startedAt:
      sessionRow.started_at !== null && sessionRow.started_at !== undefined
        ? Number(sessionRow.started_at)
        : null,
    completedAt:
      sessionRow.completed_at !== null && sessionRow.completed_at !== undefined
        ? Number(sessionRow.completed_at)
        : null,
    participants: mapped.map((p, idx) => ({ ...p, rank: idx + 1 })),
  };
}
