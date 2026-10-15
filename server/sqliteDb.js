import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENVIRONMENT_SEEDS,
  INSERT_DATE_DIM_SQL,
  INSPECT_QUERIES,
  SQLITE_PRAGMA_STATEMENTS,
  STAR_SCHEMA_DDL,
  UPSERT_ENVIRONMENT_DIM_SQL,
  buildDateDimRow,
  normalizeInspectSummary,
} from './starSchema.js';

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
  seedEnvironmentDim(db);
  ensureDateDim(db, options.now ?? new Date());
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
