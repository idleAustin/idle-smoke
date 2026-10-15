import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureDateDim,
  getAppliedPragmas,
  inspectSqliteDb,
  openSqliteDb,
} from '../../server/sqliteDb.js';
import {
  UNLOCK_THRESHOLDS,
  buildDateDimRow,
  formatInspectReport,
  getUnlockedEnvironments,
} from '../../server/starSchema.js';
import { ensureD1Schema, inspectD1Db } from '../../server/d1Schema.js';

describe('SQLite Star Schema & DB Inspector', () => {
  it('applies required PRAGMA block (including WAL on file-backed DB) and creates all four STRICT Star Schema tables', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'idle-smoke-db-'));
    const dbFile = path.join(tempDir, 'test.sqlite');
    const db = openSqliteDb(dbFile, { now: new Date('2026-10-15T12:00:00Z') });

    try {
      const pragmas = getAppliedPragmas(db);
      expect(pragmas).toEqual({
        foreign_keys: 1,
        journal_mode: 'wal',
        synchronous: 1, // NORMAL
        cache_size: -64000,
        temp_store: 2, // MEMORY
        busy_timeout: 5000,
      });

      const tables = db
        .prepare(
          `SELECT name, strict FROM pragma_table_list
           WHERE schema = 'main' AND name IN ('player_dim', 'environment_dim', 'date_dim', 'shift_fact')
           ORDER BY name ASC`
        )
        .all();

      expect(tables).toEqual([
        { name: 'date_dim', strict: 1 },
        { name: 'environment_dim', strict: 1 },
        { name: 'player_dim', strict: 1 },
        { name: 'shift_fact', strict: 1 },
      ]);
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('seeds environment_dim with the 4 break spots (0, 5, 15, 30) and populates date_dim idempotently', () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T18:30:00Z') });
    try {
      const envs = db
        .prepare(
          'SELECT id, name, sector, unlock_smoked_required FROM environment_dim ORDER BY unlock_smoked_required ASC'
        )
        .all();

      expect(envs).toEqual([
        {
          id: 'alleyway',
          name: 'Alleyway',
          sector: 'SECTOR 01 · EAST BRICK ALLEY',
          unlock_smoked_required: 0,
        },
        {
          id: 'restaurant',
          name: 'Behind a Restaurant',
          sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
          unlock_smoked_required: 5,
        },
        {
          id: 'parking-garage',
          name: 'Parking Garage',
          sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
          unlock_smoked_required: 15,
        },
        {
          id: 'dumpster',
          name: 'By a Dumpster',
          sector: 'SECTOR 04 · LOADING DOCK CORRAL',
          unlock_smoked_required: 30,
        },
      ]);

      // Calling ensureDateDim repeatedly for the same date is idempotent
      const key1 = ensureDateDim(db, new Date('2026-10-15T01:00:00Z'));
      const key2 = ensureDateDim(db, new Date('2026-10-15T23:59:59Z'));
      expect(key1).toBe(20261015);
      expect(key2).toBe(20261015);

      const dates = db.prepare('SELECT * FROM date_dim').all();
      expect(dates).toEqual([
        {
          date_key: 20261015,
          iso_date: '2026-10-15',
          year: 2026,
          month: 10,
          day_of_month: 15,
          day_of_week: 4, // Thursday
        },
      ]);

      expect(UNLOCK_THRESHOLDS).toEqual({
        alleyway: 0,
        restaurant: 5,
        'parking-garage': 15,
        dumpster: 30,
      });
      expect(getUnlockedEnvironments(0)).toEqual(['alleyway']);
      expect(getUnlockedEnvironments(5)).toEqual(['alleyway', 'restaurant']);
      expect(getUnlockedEnvironments(15)).toEqual(['alleyway', 'restaurant', 'parking-garage']);
      expect(getUnlockedEnvironments(30)).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
        'dumpster',
      ]);
    } finally {
      db.close();
    }
  });

  it('enforces STRICT column types, CHECK constraints, and explicit foreign keys', () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    try {
      // STRICT type check: string in INTEGER column must fail
      expect(() =>
        db
          .prepare(
            `INSERT INTO player_dim (id, callsign, token_hash, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at)
             VALUES ('p1', 'SHIFT-0001', 'hash1', 'web', 'not-an-integer', 0, 0, 1700000000, 1700000000)`
          )
          .run()
      ).toThrow(/cannot store TEXT value in INTEGER column/i);

      // CHECK constraint: invalid platform or short callsign must fail
      expect(() =>
        db
          .prepare(
            `INSERT INTO player_dim (id, callsign, token_hash, platform, created_at, updated_at)
             VALUES ('p1', 'A', 'hash1', 'web', 1700000000, 1700000000)`
          )
          .run()
      ).toThrow(/CHECK constraint failed/i);

      // Foreign key constraint: shift_fact referencing non-existent player_id must fail
      expect(() =>
        db
          .prepare(
            `INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at)
             VALUES ('s1', 'missing-player', 'alleyway', 20261015, 'web', 2, 24, 12000, 'verified', 1700000000)`
          )
          .run()
      ).toThrow(/FOREIGN KEY constraint failed/i);

      // Insert valid player and shift, then verify ON DELETE RESTRICT on environment_dim
      db.prepare(
        `INSERT INTO player_dim (id, callsign, token_hash, platform, created_at, updated_at)
         VALUES ('p1', 'SHIFT-1001', 'hash-1001', 'web', 1700000000, 1700000000)`
      ).run();
      db.prepare(
        `INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
         VALUES ('s1', 'p1', 'alleyway', 20261015, 'web', 3, 36, 14500, 'verified', 1700000000, 1700000015)`
      ).run();

      expect(() =>
        db.prepare(`DELETE FROM environment_dim WHERE id = 'alleyway'`).run()
      ).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      db.close();
    }
  });

  it('uses composite covering indexes for leaderboard, player history, and best player queries via EXPLAIN QUERY PLAN', () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    try {
      const leaderboardPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, player_id, smoked, environment_id, completed_at
           FROM shift_fact
           WHERE status = 'verified'
           ORDER BY smoked DESC, completed_at ASC
           LIMIT 10`
        )
        .all()
        .map(r => String(r.detail))
        .join(' ');
      expect(leaderboardPlan).toContain('USING COVERING INDEX idx_shift_fact_leaderboard');

      const playerHistoryPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, smoked, completed_at
           FROM shift_fact
           WHERE player_id = 'p1'
           ORDER BY completed_at DESC
           LIMIT 10`
        )
        .all()
        .map(r => String(r.detail))
        .join(' ');
      expect(playerHistoryPlan).toContain('USING COVERING INDEX idx_shift_fact_player');

      const bestPlayerPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, callsign, best_smoked, lifetime_smoked
           FROM player_dim
           ORDER BY best_smoked DESC, lifetime_smoked DESC
           LIMIT 10`
        )
        .all()
        .map(r => String(r.detail))
        .join(' ');
      expect(bestPlayerPlan).toContain('USING COVERING INDEX idx_player_dim_best');
    } finally {
      db.close();
    }
  });

  it('summarizes players, verified shifts, environment breakdown, and top leaderboard rows for db:inspect', () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    try {
      db.prepare(
        `INSERT INTO player_dim (id, callsign, token_hash, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at)
         VALUES
           ('p1', 'SHIFT-7788', 'h1', 'ios', 7, 5, 2, 1700000000, 1700000050),
           ('p2', 'DOCK-BOSS', 'h2', 'web', 4, 4, 1, 1700000010, 1700000030)`
      ).run();

      db.prepare(
        `INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
         VALUES
           ('s1', 'p1', 'alleyway', 20261015, 'ios', 2, 24, 14000, 'verified', 1700000000, 1700000015),
           ('s2', 'p1', 'restaurant', 20261015, 'ios', 5, 60, 14800, 'verified', 1700000030, 1700000045),
           ('s3', 'p2', 'alleyway', 20261015, 'web', 4, 48, 14200, 'verified', 1700000015, 1700000030),
           ('s4', 'p2', 'alleyway', 20261015, 'web', 99, 999, 15000, 'rejected', 1700000060, 1700000075)`
      ).run();

      const summary = inspectSqliteDb(db);
      expect(summary.totals).toEqual({
        totalPlayers: 2,
        totalVerifiedShifts: 3,
        totalSmoked: 11,
      });

      const alleywayStats = summary.environments.find(e => e.id === 'alleyway');
      const restaurantStats = summary.environments.find(e => e.id === 'restaurant');
      expect(alleywayStats).toMatchObject({ verifiedShifts: 2, totalSmoked: 6 });
      expect(restaurantStats).toMatchObject({ verifiedShifts: 1, totalSmoked: 5 });

      expect(summary.leaderboard).toEqual([
        {
          rank: 1,
          callsign: 'SHIFT-7788',
          smoked: 5,
          environmentId: 'restaurant',
          completedAt: 1700000045,
        },
        {
          rank: 2,
          callsign: 'DOCK-BOSS',
          smoked: 4,
          environmentId: 'alleyway',
          completedAt: 1700000030,
        },
        {
          rank: 3,
          callsign: 'SHIFT-7788',
          smoked: 2,
          environmentId: 'alleyway',
          completedAt: 1700000015,
        },
      ]);

      const formatted = formatInspectReport(summary);
      expect(formatted).toContain('Total Players         : 2');
      expect(formatted).toContain('Verified Shifts       : 3');
      expect(formatted).toContain('Total Butts Smoked    : 11');
      expect(formatted).toContain('#1   SHIFT-7788       | 5 butts | restaurant');
    } finally {
      db.close();
    }
  });

  it('initializes and inspects a Cloudflare D1-compatible binding using ensureD1Schema and inspectD1Db', async () => {
    const sqlite = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    // Minimal D1 binding shim wrapping node:sqlite to verify D1 batch/prepare contract
    const d1Shim = {
      prepare(sql: string) {
        let boundArgs: unknown[] = [];
        return {
          sql,
          get args() {
            return boundArgs;
          },
          bind(...args: unknown[]) {
            boundArgs = args;
            return this;
          },
          async first() {
            return sqlite.prepare(sql).get(...(boundArgs as string[])) ?? null;
          },
          async all() {
            return { results: sqlite.prepare(sql).all(...(boundArgs as string[])) };
          },
          async run() {
            sqlite.prepare(sql).run(...(boundArgs as string[]));
            return { success: true };
          },
        };
      },
      async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        const out = [];
        for (const stmt of statements) {
          out.push(await stmt.run());
        }
        return out;
      },
    };

    try {
      const row = buildDateDimRow(new Date('2026-10-16T05:00:00Z'));
      await ensureD1Schema(d1Shim, new Date('2026-10-16T05:00:00Z'));
      const summary = await inspectD1Db(d1Shim);
      expect(summary.environments).toHaveLength(4);
      expect(row.date_key).toBe(20261016);
    } finally {
      sqlite.close();
    }
  });

  it('executes scripts/db-inspect.mjs CLI and prints formatted Star Schema metrics', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'idle-smoke-cli-'));
    const dbFile = path.join(tempDir, 'cli.sqlite');
    const db = openSqliteDb(dbFile, { now: new Date('2026-10-15T12:00:00Z') });
    db.close();

    try {
      const output = execFileSync('node', ['scripts/db-inspect.mjs'], {
        env: { ...process.env, SQLITE_DB_PATH: dbFile },
        encoding: 'utf8',
      });
      expect(output).toContain('IDLE SMOKE BREAK — STAR SCHEMA TELEMETRY & LEADERBOARD');
      expect(output).toContain('alleyway');
      expect(output).toContain('restaurant');
      expect(output).toContain('parking-garage');
      expect(output).toContain('dumpster');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
