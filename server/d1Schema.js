import {
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  INSPECT_QUERIES,
  STAR_SCHEMA_DDL,
  UPSERT_ENVIRONMENT_DIM_SQL,
  buildDateDimRow,
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
