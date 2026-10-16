import {
  API_SQL,
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  INSPECT_QUERIES,
  STAR_SCHEMA_DDL,
  UPSERT_ENVIRONMENT_DIM_SQL,
  buildDateDimRow,
  buildRejectedShiftWritePlan,
  buildVerifiedShiftWritePlan,
  formatLeaderboardResponse,
  normalizeInspectSummary,
} from './starSchema.js';

const D1_DDL_STATEMENTS = STAR_SCHEMA_DDL
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);

export async function ensureD1Schema(d1, date = new Date()) {
  const dateRow = buildDateDimRow(date);
  const statements = [
    d1.prepare('PRAGMA foreign_keys = ON'),
    ...D1_DDL_STATEMENTS.map(sql => d1.prepare(sql)),
    ...ENVIRONMENT_SEEDS.map(env =>
      d1
        .prepare(UPSERT_ENVIRONMENT_DIM_SQL)
        .bind(env.id, env.name, env.sector, env.unlock_smoked_required)
    ),
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
      return (await d1.prepare(API_SQL.selectPlayerByTokenHash).bind(tokenHash).first()) ?? null;
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
  };
}
