import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TAGLINE_CADENCE,
  ENSURE_DEFAULT_CADENCE_SQL,
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  MARK_TAGLINES_SEEDED_SQL,
  SEED_TAGLINE_IF_INITIAL_SQL,
  SQLITE_PRAGMA_STATEMENTS,
  STAR_SCHEMA_DDL,
  TAGLINE_SEEDS,
  UPSERT_ENVIRONMENT_DIM_SQL,
  buildDateDimRow,
} from './starSchema.js';
import {
  API_SQL,
  INSPECT_QUERIES,
  buildRejectedShiftWritePlan,
  buildVerifiedShiftWritePlan,
  formatLeaderboardResponse,
  formatTaglineRow,
  normalizeInspectSummary,
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
    stmt.run(env.id, env.name, env.sector, env.unlock_smoked_required);
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
  const nowDate = options.now ? new Date(options.now) : new Date();
  const nowUnix = Math.floor(nowDate.getTime() / 1000);
  seedEnvironmentDim(db);
  seedTaglineDim(db, nowUnix);
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
  return {
    /**
     * @param {{ id: string, callsign: string, tokenHash: string, platform: string, nowUnix: number }} params
     */
    async createPlayer({ id, callsign, tokenHash, platform, nowUnix }) {
      db.prepare(API_SQL.insertPlayer).run(id, callsign, tokenHash, platform, nowUnix, nowUnix);
      return db.prepare(API_SQL.selectPlayerById).get(id) ?? null;
    },
    /**
     * @param {string} tokenHash
     */
    async getPlayerByTokenHash(tokenHash) {
      return db.prepare(API_SQL.selectPlayerByTokenHash).get(tokenHash, tokenHash) ?? null;
    },
    /**
     * @param {string} playerId
     */
    async getPlayerById(playerId) {
      return db.prepare(API_SQL.selectPlayerById).get(playerId) ?? null;
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
      return db.prepare(API_SQL.selectPlayerById).get(playerId) ?? null;
    },
    /**
     * @param {string} playerId
     */
    async deletePlayer(playerId) {
      db.exec('BEGIN IMMEDIATE');
      try {
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
      return db.prepare(API_SQL.selectPlayerById).get(params.playerId) ?? null;
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
  };
}
