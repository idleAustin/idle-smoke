import { execFileSync } from 'node:child_process';
import { DEFAULT_SQLITE_PATH, inspectSqliteDb, openSqliteDb } from '../server/sqliteDb.js';
import {
  INSPECT_QUERIES,
  formatInspectReport,
  normalizeInspectSummary,
} from '../server/starSchema.js';

const args = new Set(process.argv.slice(2));

if (args.has('--d1-init')) {
  const locationFlag = args.has('--remote') ? '--remote' : '--local';
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'idle-smoke-break-db', locationFlag, '--yes', '--file=server/schema.sql'],
    { stdio: 'inherit' }
  );
  process.exit(0);
}

if (args.has('--d1-local') || args.has('--d1-remote')) {
  const locationFlag = args.has('--d1-remote') ? '--remote' : '--local';
  const batchQuery = [
    INSPECT_QUERIES.playerCount,
    INSPECT_QUERIES.verifiedShiftTotals,
    INSPECT_QUERIES.environmentBreakdown,
    INSPECT_QUERIES.topLeaderboard,
  ].join(';\n');

  const rawJson = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'idle-smoke-break-db', locationFlag, '--json', `--command=${batchQuery}`],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(rawJson);
  const playerRow = parsed[0]?.results?.[0] ?? null;
  const shiftRow = parsed[1]?.results?.[0] ?? null;
  const envRows = parsed[2]?.results ?? [];
  const leaderboardRows = parsed[3]?.results ?? [];
  const summary = normalizeInspectSummary(playerRow, shiftRow, envRows, leaderboardRows);

  if (args.has('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatInspectReport(summary));
  }
  process.exit(0);
}

const dbPath = process.env.SQLITE_DB_PATH || DEFAULT_SQLITE_PATH;
const db = openSqliteDb(dbPath);
try {
  const summary = inspectSqliteDb(db);
  if (args.has('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatInspectReport(summary));
  }
} finally {
  db.close();
}
