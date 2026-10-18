import {
  DEFAULT_TAGLINE_CADENCE,
  ENSURE_DEFAULT_CADENCE_SQL,
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  MARK_TAGLINES_SEEDED_SQL,
  SEED_TAGLINE_IF_INITIAL_SQL,
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

const D1_DDL_STATEMENTS = STAR_SCHEMA_DDL
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);

export async function ensureD1Schema(d1, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const nowUnix = Math.floor(d.getTime() / 1000);
  const dateRow = buildDateDimRow(d);
  const statements = [
    d1.prepare('PRAGMA foreign_keys = ON'),
    ...D1_DDL_STATEMENTS.map(sql => d1.prepare(sql)),
    ...ENVIRONMENT_SEEDS.map(env =>
      d1
        .prepare(UPSERT_ENVIRONMENT_DIM_SQL)
        .bind(env.id, env.name, env.sector, env.unlock_smoked_required)
    ),
    d1.prepare(ENSURE_DEFAULT_CADENCE_SQL).bind(nowUnix),
    ...TAGLINE_SEEDS.map(jokeText =>
      d1.prepare(SEED_TAGLINE_IF_INITIAL_SQL).bind(jokeText, nowUnix)
    ),
    d1.prepare(MARK_TAGLINES_SEEDED_SQL).bind(nowUnix),
    d1
      .prepare(INSERT_DATE_DIM_SQL)
      .bind(
        dateRow.date_key,
        dateRow.iso_date,
        dateRow.year,
        dateRow.month,
        dateRow.day_of_month,
        dateRow.day_of_week
      ),
  ];

  await d1.batch(statements);
  return dateRow.date_key;
}

export async function inspectD1Db(d1) {
  const playerRow = await d1.prepare(INSPECT_QUERIES.playerCount).first();
  const shiftRow = await d1.prepare(INSPECT_QUERIES.verifiedShiftTotals).first();
  const { results: envRows = [] } = await d1.prepare(INSPECT_QUERIES.environmentBreakdown).all();
  const { results: leaderboardRows = [] } = await d1.prepare(INSPECT_QUERIES.topLeaderboard).all();

  return normalizeInspectSummary(playerRow, shiftRow, envRows, leaderboardRows);
}

export function createD1Store(d1) {
  return {
    /**
     * @param {{ id: string, callsign: string, tokenHash: string, platform: string, nowUnix: number }} params
     */
    async createPlayer({ id, callsign, tokenHash, platform, nowUnix }) {
      await d1.prepare(API_SQL.insertPlayer).bind(id, callsign, tokenHash, platform, nowUnix, nowUnix).run();
      return (await d1.prepare(API_SQL.selectPlayerById).bind(id).first()) ?? null;
    },
    /**
     * @param {string} tokenHash
     */
    async getPlayerByTokenHash(tokenHash) {
      return (await d1.prepare(API_SQL.selectPlayerByTokenHash).bind(tokenHash, tokenHash).first()) ?? null;
    },
    /**
     * @param {string} playerId
     */
    async getPlayerById(playerId) {
      return (await d1.prepare(API_SQL.selectPlayerById).bind(playerId).first()) ?? null;
    },
    /**
     * @param {string} provider
     * @param {string} providerSub
     */
    async getAuthIdentity(provider, providerSub) {
      return (await d1.prepare(API_SQL.selectAuthIdentity).bind(provider, providerSub).first()) ?? null;
    },
    /**
     * @param {{ provider: string, providerSub: string, playerId: string, secretHash?: string | null, email?: string | null, nowUnix: number }} params
     */
    async upsertAuthIdentity({ provider, providerSub, playerId, secretHash = null, email = null, nowUnix }) {
      await d1
        .prepare(API_SQL.upsertAuthIdentity)
        .bind(provider, providerSub, playerId, secretHash, email, nowUnix, nowUnix)
        .run();
    },
    /**
     * @param {string} playerId
     * @param {string} callsign
     * @param {number} nowUnix
     */
    async updatePlayerCallsign(playerId, callsign, nowUnix) {
      await d1.prepare(API_SQL.updatePlayerCallsign).bind(callsign, nowUnix, playerId).run();
      return (await d1.prepare(API_SQL.selectPlayerById).bind(playerId).first()) ?? null;
    },
    /**
     * @param {string} playerId
     */
    async deletePlayer(playerId) {
      await d1.batch([
        d1.prepare(API_SQL.deletePlayerShifts).bind(playerId),
        d1.prepare(API_SQL.deletePlayerAuth).bind(playerId),
        d1.prepare(API_SQL.deletePlayerDim).bind(playerId),
      ]);
    },
    /**
     * @param {{ shiftId: string, playerId: string, environmentId: string, platform: string, nowUnix: number }} params
     */
    async createStartedShift({ shiftId, playerId, environmentId, platform, nowUnix }) {
      const dateRow = buildDateDimRow(new Date(nowUnix * 1000));
      await d1.batch([
        d1
          .prepare(INSERT_DATE_DIM_SQL)
          .bind(
            dateRow.date_key,
            dateRow.iso_date,
            dateRow.year,
            dateRow.month,
            dateRow.day_of_month,
            dateRow.day_of_week
          ),
        d1
          .prepare(API_SQL.insertStartedShift)
          .bind(shiftId, playerId, environmentId, dateRow.date_key, platform, nowUnix),
      ]);
    },
    /**
     * @param {string} shiftId
     */
    async getShiftById(shiftId) {
      return (await d1.prepare(API_SQL.selectShiftById).bind(shiftId).first()) ?? null;
    },
    /**
     * @param {Parameters<typeof buildRejectedShiftWritePlan>[0]} params
     */
    async recordRejectedShift(params) {
      const plan = buildRejectedShiftWritePlan(params);
      await d1.batch([
        d1.prepare(INSERT_DATE_DIM_SQL).bind(...plan.dateArgs),
        d1.prepare(plan.shiftSql).bind(...plan.shiftArgs),
      ]);
    },
    /**
     * @param {Parameters<typeof buildVerifiedShiftWritePlan>[0]} params
     */
    async recordVerifiedShift(params) {
      const plan = buildVerifiedShiftWritePlan(params);
      await d1.batch([
        d1.prepare(INSERT_DATE_DIM_SQL).bind(...plan.dateArgs),
        d1.prepare(plan.shiftSql).bind(...plan.shiftArgs),
        d1.prepare(API_SQL.updatePlayerAfterShift).bind(...plan.playerArgs),
      ]);
      return (await d1.prepare(API_SQL.selectPlayerById).bind(params.playerId).first()) ?? null;
    },
    async getLeaderboard() {
      return formatLeaderboardResponse(await inspectD1Db(d1));
    },
    async getActiveTaglines() {
      const cadenceRow = await d1.prepare(API_SQL.selectTaglineCadence).first();
      const cadence = String(cadenceRow?.value ?? DEFAULT_TAGLINE_CADENCE);
      const { results: rows = [] } = await d1.prepare(API_SQL.selectActiveTaglines).all();
      return {
        cadence,
        taglines: rows.map(formatTaglineRow),
      };
    },
    async getAllTaglines() {
      const cadenceRow = await d1.prepare(API_SQL.selectTaglineCadence).first();
      const cadence = String(cadenceRow?.value ?? DEFAULT_TAGLINE_CADENCE);
      const { results: rows = [] } = await d1.prepare(API_SQL.selectAllTaglines).all();
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
      if (jokeTexts.length > 0) {
        await d1.batch(
          jokeTexts.map(text => d1.prepare(API_SQL.insertTagline).bind(text, nowUnix))
        );
      }
      return this.getAllTaglines();
    },
    /**
     * @param {{ id: number, jokeText?: string | null, isActive?: boolean | null }} params
     */
    async updateTagline({ id, jokeText = null, isActive = null }) {
      const activeInt = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null;
      await d1.prepare(API_SQL.updateTaglineById).bind(jokeText, activeInt, id).run();
      return this.getAllTaglines();
    },
    /**
     * @param {number} id
     */
    async deleteTagline(id) {
      await d1.prepare(API_SQL.deleteTaglineById).bind(id).run();
      return this.getAllTaglines();
    },
    /**
     * @param {string} cadence
     * @param {number} nowUnix
     */
    async setTaglineCadence(cadence, nowUnix) {
      await d1.prepare(API_SQL.upsertTaglineCadence).bind(cadence, nowUnix).run();
      return this.getAllTaglines();
    },
  };
}
