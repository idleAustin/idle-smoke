import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TAGLINE_CADENCE,
  ENSURE_DEFAULT_CADENCE_SQL,
  ENVIRONMENT_DIM_DDL,
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  MARK_TAGLINES_SEEDED_SQL,
  SCHEMA_VERSION,
  SEED_TAGLINE_IF_INITIAL_SQL,
  SQLITE_PRAGMA_STATEMENTS,
  STAR_SCHEMA_DDL,
  TAGLINE_SEEDS,
  UPSERT_ENVIRONMENT_DIM_SQL,
  UPSERT_SCHEMA_VERSION_SQL,
  buildDateDimRow,
} from './starSchema.js';
import {
  API_SQL,
  INSPECT_QUERIES,
  buildRejectedShiftWritePlan,
  buildSmokedByEnvironmentMap,
  buildVerifiedShiftWritePlan,
  formatLeaderboardResponse,
  formatSmokeSession,
  formatTaglineRow,
  normalizeInspectSummary,
  parseAvatarConfig,
} from './storeQueries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_SQLITE_PATH = path.join(__dirname, '..', 'data', 'smokebreak.sqlite');

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Date | number | string} [date]
 */
export function ensureDateDim(db, date = new Date()) {
  const row = buildDateDimRow(date);
  db.prepare(INSERT_DATE_DIM_SQL).run(
    row.date_key,
    row.iso_date,
    row.year,
    row.month,
    row.day_of_month,
    row.day_of_week
  );
  return row.date_key;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function seedEnvironmentDim(db) {
  const stmt = db.prepare(UPSERT_ENVIRONMENT_DIM_SQL);
  for (const env of ENVIRONMENT_SEEDS) {
    stmt.run(
      env.id,
      env.name,
      env.sector,
      env.phase,
      env.sector_order,
      env.sector_quota_required,
      env.unlock_smoked_required
    );
  }
}

/**
 * Non-destructively migrates pre-v3 SQLite tables (`player_dim` and `environment_dim`)
 * to Star Schema v3 while preserving all `player_dim` and `shift_fact` rows.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function migrateSqliteToV3(db) {
  const playerCols = db.prepare('PRAGMA table_info(player_dim)').all();
  if (
    playerCols.length > 0 &&
    !playerCols.some(col => String(col.name) === 'promotion_rounds_cleared')
  ) {
    db.exec(
      'ALTER TABLE player_dim ADD COLUMN promotion_rounds_cleared INTEGER NOT NULL DEFAULT 0 CHECK (promotion_rounds_cleared BETWEEN 0 AND 9);'
    );
  }
  if (
    playerCols.length > 0 &&
    !playerCols.some(col => String(col.name) === 'avatar_config')
  ) {
    db.exec('ALTER TABLE player_dim ADD COLUMN avatar_config TEXT;');
  }

  const envCols = db.prepare('PRAGMA table_info(environment_dim)').all();
  if (
    envCols.length > 0 &&
    !envCols.some(col => String(col.name) === 'sector_quota_required')
  ) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec('PRAGMA defer_foreign_keys = ON;');
      db.exec('DROP TABLE IF EXISTS environment_dim;');
      db.exec(ENVIRONMENT_DIM_DDL);
      seedEnvironmentDim(db);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} nowUnix
 */
function seedTaglineDim(db, nowUnix) {
  db.prepare(ENSURE_DEFAULT_CADENCE_SQL).run(nowUnix);
  const seedStmt = db.prepare(SEED_TAGLINE_IF_INITIAL_SQL);
  for (const jokeText of TAGLINE_SEEDS) {
    seedStmt.run(jokeText, nowUnix);
  }
  db.prepare(MARK_TAGLINES_SEEDED_SQL).run(nowUnix);
}

/**
 * @param {string} [dbPath]
 * @param {{ now?: Date | number | string }} [options]
 */
export function openSqliteDb(dbPath = process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_PATH, options = {}) {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  for (const pragma of SQLITE_PRAGMA_STATEMENTS) {
    db.exec(pragma);
  }
  db.exec(STAR_SCHEMA_DDL);
  migrateSqliteToV3(db);
  const nowDate = options.now ? new Date(options.now) : new Date();
  const nowUnix = Math.floor(nowDate.getTime() / 1000);
  seedEnvironmentDim(db);
  seedTaglineDim(db, nowUnix);
  db.prepare(UPSERT_SCHEMA_VERSION_SQL).run(SCHEMA_VERSION, nowUnix);
  ensureDateDim(db, nowDate);
  return db;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function getAppliedPragmas(db) {
  const foreign_keys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys);
  const journal_mode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toLowerCase();
  const synchronous = Number(db.prepare('PRAGMA synchronous').get()?.synchronous);
  const cache_size = Number(db.prepare('PRAGMA cache_size').get()?.cache_size);
  const temp_store = Number(db.prepare('PRAGMA temp_store').get()?.temp_store);
  const busy_timeout = Number(db.prepare('PRAGMA busy_timeout').get()?.timeout);

  return {
    foreign_keys,
    journal_mode,
    synchronous,
    cache_size,
    temp_store,
    busy_timeout,
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function inspectSqliteDb(db) {
  const playerRow = db.prepare(INSPECT_QUERIES.playerCount).get();
  const shiftRow = db.prepare(INSPECT_QUERIES.verifiedShiftTotals).get();
  const envRows = db.prepare(INSPECT_QUERIES.environmentBreakdown).all();
  const leaderboardRows = db.prepare(INSPECT_QUERIES.topLeaderboard).all();

  return normalizeInspectSummary(playerRow, shiftRow, envRows, leaderboardRows);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createSqliteStore(db) {
  /**
   * @param {Record<string, unknown> | undefined | null} row
   */
  function hydratePlayerRow(row) {
    if (!row) return null;
    const envRows = db
      .prepare(API_SQL.selectPlayerSmokedByEnvironment)
      .all(String(row.id));
    return {
      ...row,
      smoked_by_environment: buildSmokedByEnvironmentMap(envRows),
    };
  }

  return {
    /**
     * @param {{ id: string, callsign: string, tokenHash: string, platform: string, nowUnix: number }} params
     */
    async createPlayer({ id, callsign, tokenHash, platform, nowUnix }) {
      db.prepare(API_SQL.insertPlayer).run(id, callsign, tokenHash, platform, nowUnix, nowUnix);
      return hydratePlayerRow(db.prepare(API_SQL.selectPlayerById).get(id) ?? null);
    },
    /**
     * @param {string} tokenHash
     */
    async getPlayerByTokenHash(tokenHash) {
      return hydratePlayerRow(
        db.prepare(API_SQL.selectPlayerByTokenHash).get(tokenHash, tokenHash) ?? null
      );
    },
    /**
     * @param {string} playerId
     */
    async getPlayerById(playerId) {
      return hydratePlayerRow(db.prepare(API_SQL.selectPlayerById).get(playerId) ?? null);
    },
    /**
     * @param {string} provider
     * @param {string} providerSub
     */
    async getAuthIdentity(provider, providerSub) {
      return db.prepare(API_SQL.selectAuthIdentity).get(provider, providerSub) ?? null;
    },
    /**
     * @param {{ provider: string, providerSub: string, playerId: string, secretHash?: string | null, email?: string | null, nowUnix: number }} params
     */
    async upsertAuthIdentity({ provider, providerSub, playerId, secretHash = null, email = null, nowUnix }) {
      db.prepare(API_SQL.upsertAuthIdentity).run(
        provider,
        providerSub,
        playerId,
        secretHash,
        email,
        nowUnix,
        nowUnix
      );
    },
    /**
     * @param {string} playerId
     * @param {string} callsign
     * @param {number} nowUnix
     */
    async updatePlayerCallsign(playerId, callsign, nowUnix) {
      db.prepare(API_SQL.updatePlayerCallsign).run(callsign, nowUnix, playerId);
      return hydratePlayerRow(db.prepare(API_SQL.selectPlayerById).get(playerId) ?? null);
    },
    /**
     * @param {string} playerId
     * @param {string | Record<string, unknown> | null} avatarConfigJson
     * @param {number} nowUnix
     */
    async updatePlayerAvatarConfig(playerId, avatarConfigJson, nowUnix) {
      const serialized =
        typeof avatarConfigJson === 'string'
          ? avatarConfigJson
          : avatarConfigJson && typeof avatarConfigJson === 'object'
            ? JSON.stringify(parseAvatarConfig(avatarConfigJson))
            : null;
      db.prepare(API_SQL.updatePlayerAvatarConfig).run(serialized, nowUnix, playerId);
      return this.getPlayerById(playerId);
    },
    /**
     * @param {string} playerId
     */
    async deletePlayer(playerId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(API_SQL.deletePlayerSmokeSessionParticipants).run(playerId);
        db.prepare(API_SQL.deletePlayerSmokeSessions).run(playerId);
        db.prepare(API_SQL.deletePlayerShifts).run(playerId);
        db.prepare(API_SQL.deletePlayerAuth).run(playerId);
        db.prepare(API_SQL.deletePlayerDim).run(playerId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    /**
     * @param {{ shiftId: string, playerId: string, environmentId: string, platform: string, nowUnix: number }} params
     */
    async createStartedShift({ shiftId, playerId, environmentId, platform, nowUnix }) {
      const dateKey = ensureDateDim(db, new Date(nowUnix * 1000));
      db.prepare(API_SQL.insertStartedShift).run(shiftId, playerId, environmentId, dateKey, platform, nowUnix);
    },
    /**
     * @param {string} shiftId
     */
    async getShiftById(shiftId) {
      return db.prepare(API_SQL.selectShiftById).get(shiftId) ?? null;
    },
    /**
     * @param {Parameters<typeof buildRejectedShiftWritePlan>[0]} params
     */
    async recordRejectedShift(params) {
      const plan = buildRejectedShiftWritePlan(params);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(INSERT_DATE_DIM_SQL).run(...plan.dateArgs);
        db.prepare(plan.shiftSql).run(...plan.shiftArgs);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    /**
     * @param {Parameters<typeof buildVerifiedShiftWritePlan>[0]} params
     */
    async recordVerifiedShift(params) {
      const plan = buildVerifiedShiftWritePlan(params);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(INSERT_DATE_DIM_SQL).run(...plan.dateArgs);
        db.prepare(plan.shiftSql).run(...plan.shiftArgs);
        db.prepare(API_SQL.updatePlayerAfterShift).run(...plan.playerArgs);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return hydratePlayerRow(db.prepare(API_SQL.selectPlayerById).get(params.playerId) ?? null);
    },
    async getLeaderboard() {
      return formatLeaderboardResponse(inspectSqliteDb(db));
    },
    async getActiveTaglines() {
      const cadenceRow = db.prepare(API_SQL.selectTaglineCadence).get();
      const cadence = String(cadenceRow?.value ?? DEFAULT_TAGLINE_CADENCE);
      const rows = db.prepare(API_SQL.selectActiveTaglines).all();
      return {
        cadence,
        taglines: rows.map(formatTaglineRow),
      };
    },
    async getAllTaglines() {
      const cadenceRow = db.prepare(API_SQL.selectTaglineCadence).get();
      const cadence = String(cadenceRow?.value ?? DEFAULT_TAGLINE_CADENCE);
      const rows = db.prepare(API_SQL.selectAllTaglines).all();
      return {
        cadence,
        taglines: rows.map(formatTaglineRow),
      };
    },
    /**
     * @param {string[]} jokeTexts
     * @param {number} nowUnix
     */
    async addTaglines(jokeTexts, nowUnix) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const stmt = db.prepare(API_SQL.insertTagline);
        for (const text of jokeTexts) {
          stmt.run(text, nowUnix);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return this.getAllTaglines();
    },
    /**
     * @param {{ id: number, jokeText?: string | null, isActive?: boolean | null }} params
     */
    async updateTagline({ id, jokeText = null, isActive = null }) {
      const activeInt = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null;
      db.prepare(API_SQL.updateTaglineById).run(jokeText, activeInt, id);
      return this.getAllTaglines();
    },
    /**
     * @param {number} id
     */
    async deleteTagline(id) {
      db.prepare(API_SQL.deleteTaglineById).run(id);
      return this.getAllTaglines();
    },
    /**
     * @param {string} cadence
     * @param {number} nowUnix
     */
    async setTaglineCadence(cadence, nowUnix) {
      db.prepare(API_SQL.upsertTaglineCadence).run(cadence, nowUnix);
      return this.getAllTaglines();
    },
    /**
     * @param {number} minCreatedAtUnix
     */
    async getActiveSessionCodes(minCreatedAtUnix) {
      const rows = db.prepare(API_SQL.selectActiveSessionCodes).all(minCreatedAtUnix);
      return rows.map(r => String(r.code));
    },
    /**
     * @param {string} sessionId
     */
    async getSmokeSessionById(sessionId) {
      const sessionRow = db.prepare(API_SQL.selectSmokeSessionById).get(sessionId);
      if (!sessionRow) return null;
      const participants = db.prepare(API_SQL.selectSmokeSessionParticipants).all(sessionId);
      return formatSmokeSession(sessionRow, participants);
    },
    /**
     * @param {string} code
     * @param {number} minCreatedAtUnix
     */
    async getSmokeSessionByCode(code, minCreatedAtUnix) {
      const sessionRow = db.prepare(API_SQL.selectSmokeSessionByCode).get(code, minCreatedAtUnix);
      if (!sessionRow) return null;
      const participants = db
        .prepare(API_SQL.selectSmokeSessionParticipants)
        .all(String(sessionRow.id));
      return formatSmokeSession(sessionRow, participants);
    },
    /**
     * @param {{ sessionId: string, code: string, hostPlayerId: string, environmentId: string, nowUnix: number }} params
     */
    async createSmokeSession({ sessionId, code, hostPlayerId, environmentId, nowUnix }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(API_SQL.insertSmokeSession).run(
          sessionId,
          code,
          hostPlayerId,
          environmentId,
          nowUnix
        );
        db.prepare(API_SQL.upsertSmokeSessionParticipant).run(sessionId, hostPlayerId, nowUnix);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return this.getSmokeSessionById(sessionId);
    },
    /**
     * @param {{ sessionId: string, playerId: string, nowUnix: number }} params
     */
    async joinSmokeSession({ sessionId, playerId, nowUnix }) {
      db.prepare(API_SQL.upsertSmokeSessionParticipant).run(sessionId, playerId, nowUnix);
      return this.getSmokeSessionById(sessionId);
    },
    /**
     * @param {{ sessionId: string, hostPlayerId: string, nowUnix: number }} params
     */
    async startSmokeSession({ sessionId, hostPlayerId, nowUnix }) {
      db.prepare(API_SQL.startSmokeSession).run(nowUnix, sessionId, hostPlayerId);
      return this.getSmokeSessionById(sessionId);
    },
    /**
     * @param {{ sessionId: string, playerId: string, shiftId: string, smoked: number, tapCount: number, durationMs: number, completedAt: number }} params
     */
    async recordSmokeSessionShift({
      sessionId,
      playerId,
      shiftId,
      smoked,
      tapCount,
      durationMs,
      completedAt,
    }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(API_SQL.recordSmokeSessionParticipantShift).run(
          shiftId,
          smoked,
          tapCount,
          durationMs,
          completedAt,
          sessionId,
          playerId
        );
        db.prepare(API_SQL.completeSmokeSessionIfAllDone).run(completedAt, sessionId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return this.getSmokeSessionById(sessionId);
    },
  };
}
