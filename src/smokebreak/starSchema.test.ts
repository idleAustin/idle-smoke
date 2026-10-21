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
  getUnlockedEnvironments,
} from '../../server/starSchema.js';
import { formatInspectReport } from '../../server/storeQueries.js';
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

  it('seeds environment_dim with all 12 sectors across 3 Phases and populates date_dim idempotently', () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T18:30:00Z') });
    try {
      const envs = db
        .prepare(
          'SELECT id, name, sector, phase, sector_order, sector_quota_required, unlock_smoked_required FROM environment_dim ORDER BY sector_order ASC'
        )
        .all();

      expect(envs).toEqual([
        {
          id: 'alleyway',
          name: 'Alleyway',
          sector: 'SECTOR 01 · EAST BRICK ALLEY',
          phase: 1,
          sector_order: 1,
          sector_quota_required: 5,
          unlock_smoked_required: 0,
        },
        {
          id: 'restaurant',
          name: 'Behind a Restaurant',
          sector: 'SECTOR 02 · KITCHEN SERVICE EXIT',
          phase: 1,
          sector_order: 2,
          sector_quota_required: 10,
          unlock_smoked_required: 5,
        },
        {
          id: 'parking-garage',
          name: 'Parking Garage',
          sector: 'SECTOR 03 · SUB-LEVEL B2 DECK',
          phase: 1,
          sector_order: 3,
          sector_quota_required: 15,
          unlock_smoked_required: 15,
        },
        {
          id: 'dumpster',
          name: 'By a Dumpster',
          sector: 'SECTOR 04 · LOADING DOCK CORRAL',
          phase: 1,
          sector_order: 4,
          sector_quota_required: 20,
          unlock_smoked_required: 30,
        },
        {
          id: 'office-sidewalk',
          name: 'Office Sidewalk',
          sector: 'SECTOR 05 · CURBSIDE ASH URN',
          phase: 2,
          sector_order: 5,
          sector_quota_required: 25,
          unlock_smoked_required: 50,
        },
        {
          id: 'breakroom-patio',
          name: 'Breakroom Patio',
          sector: 'SECTOR 06 · CONCRETE PICNIC TABLE',
          phase: 2,
          sector_order: 6,
          sector_quota_required: 30,
          unlock_smoked_required: 75,
        },
        {
          id: 'strip-mall-median',
          name: 'Strip-Mall Median',
          sector: 'SECTOR 07 · RETENTION POND GRAVEL',
          phase: 2,
          sector_order: 7,
          sector_quota_required: 35,
          unlock_smoked_required: 105,
        },
        {
          id: 'designated-gazebo',
          name: 'Designated Gazebo',
          sector: 'SECTOR 08 · PLEXIGLASS SMOKING SHED',
          phase: 2,
          sector_order: 8,
          sector_quota_required: 40,
          unlock_smoked_required: 140,
        },
        {
          id: 'executive-balcony',
          name: 'Executive Balcony',
          sector: 'SECTOR 09 · 84TH FLOOR CORNER TERRACE',
          phase: 3,
          sector_order: 9,
          sector_quota_required: 50,
          unlock_smoked_required: 180,
        },
        {
          id: 'concert-side-stage',
          name: 'Concert Side-Stage',
          sector: 'SECTOR 10 · VIP ALL-ACCESS RISER',
          phase: 3,
          sector_order: 10,
          sector_quota_required: 60,
          unlock_smoked_required: 230,
        },
        {
          id: 'superyacht-aft-deck',
          name: 'Superyacht Aft Deck',
          sector: 'SECTOR 11 · MONACO HARBOR MOORING',
          phase: 3,
          sector_order: 11,
          sector_quota_required: 75,
          unlock_smoked_required: 290,
        },
        {
          id: 'penthouse-helipad',
          name: 'Penthouse Helipad',
          sector: 'SECTOR 12 · SOVEREIGN ROOFTOP PAD',
          phase: 3,
          sector_order: 12,
          sector_quota_required: 100,
          unlock_smoked_required: 365,
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

      expect(UNLOCK_THRESHOLDS).toMatchObject({
        alleyway: 0,
        restaurant: 5,
        'parking-garage': 15,
        dumpster: 30,
        'office-sidewalk': 50,
        'penthouse-helipad': 365,
      });
      // Legacy numeric fallback signature
      expect(getUnlockedEnvironments(0)).toEqual(['alleyway']);
      expect(getUnlockedEnvironments(5)).toEqual(['alleyway', 'restaurant']);
      expect(getUnlockedEnvironments(15)).toEqual(['alleyway', 'restaurant', 'parking-garage']);
      expect(getUnlockedEnvironments(30)).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
        'dumpster',
      ]);

      // Sequential per-sector quota + promotionRoundsCleared object signature
      expect(
        getUnlockedEnvironments({
          smokedByEnvironment: { alleyway: 30 },
          promotionRoundsCleared: 0,
        })
      ).toEqual(['alleyway', 'restaurant']);
      expect(
        getUnlockedEnvironments({
          smokedByEnvironment: { alleyway: 5, restaurant: 10, 'parking-garage': 15, dumpster: 20 },
          promotionRoundsCleared: 2,
        })
      ).toEqual(['alleyway', 'restaurant', 'parking-garage', 'dumpster']);
      expect(
        getUnlockedEnvironments({
          smokedByEnvironment: { alleyway: 5, restaurant: 10, 'parking-garage': 15, dumpster: 20 },
          promotionRoundsCleared: 3,
        })
      ).toEqual(['alleyway', 'restaurant', 'parking-garage', 'dumpster', 'office-sidewalk']);
      expect(
        getUnlockedEnvironments({
          smokedByEnvironment: {
            alleyway: 5,
            restaurant: 10,
            'parking-garage': 15,
            dumpster: 20,
            'office-sidewalk': 25,
            'breakroom-patio': 30,
            'strip-mall-median': 35,
            'designated-gazebo': 40,
            'executive-balcony': 50,
            'concert-side-stage': 60,
            'superyacht-aft-deck': 75,
          },
          promotionRoundsCleared: 6,
        })
      ).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
        'dumpster',
        'office-sidewalk',
        'breakroom-patio',
        'strip-mall-median',
        'designated-gazebo',
        'executive-balcony',
        'concert-side-stage',
        'superyacht-aft-deck',
        'penthouse-helipad',
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

      // CHECK constraint: promotion_rounds_cleared must be BETWEEN 0 AND 9
      expect(() =>
        db
          .prepare(
            `INSERT INTO player_dim (id, callsign, token_hash, platform, promotion_rounds_cleared, created_at, updated_at)
             VALUES ('p-bad-promo', 'SHIFT-0002', 'hash2', 'web', 10, 1700000000, 1700000000)`
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

  it('uses composite covering indexes for leaderboard, player history, per-sector aggregation, and best player queries via EXPLAIN QUERY PLAN', () => {
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

      const perSectorPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT environment_id, COALESCE(SUM(smoked), 0) AS total_smoked
           FROM shift_fact
           WHERE player_id = 'p1' AND status = 'verified'
           GROUP BY environment_id`
        )
        .all()
        .map(r => String(r.detail))
        .join(' ');
      expect(perSectorPlan).toContain('USING COVERING INDEX idx_shift_fact_player_env_smoked');

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
      expect(summary.environments).toHaveLength(12);
      expect(row.date_key).toBe(20261016);
    } finally {
      sqlite.close();
    }
  });

  it('migrates an existing pre-v3 SQLite database non-destructively to schema_version = 3 while preserving player_dim and shift_fact rows', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { createSqliteStore } = await import('../../server/sqliteDb.js');
    const { formatPlayerProfile } = await import('../../server/storeQueries.js');
    const tempDir = mkdtempSync(path.join(tmpdir(), 'idle-smoke-v2-mig-'));
    const dbFile = path.join(tempDir, 'legacy.sqlite');

    // Create a legacy v2 database with only 4 environments and no promotion_rounds_cleared column
    const legacyDb = new DatabaseSync(dbFile);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE player_dim (
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
      CREATE TABLE environment_dim (
          id                     TEXT    PRIMARY KEY CHECK (id IN ('alleyway', 'restaurant', 'parking-garage', 'dumpster')),
          name                   TEXT    NOT NULL,
          sector                 TEXT    NOT NULL,
          unlock_smoked_required INTEGER NOT NULL CHECK (unlock_smoked_required >= 0)
      ) STRICT;
      CREATE TABLE date_dim (
          date_key     INTEGER PRIMARY KEY,
          iso_date     TEXT    NOT NULL UNIQUE,
          year         INTEGER NOT NULL,
          month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
          day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
          day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6)
      ) STRICT;
      CREATE TABLE shift_fact (
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
      INSERT INTO environment_dim (id, name, sector, unlock_smoked_required) VALUES
        ('alleyway', 'Alleyway', 'SECTOR 01 · EAST BRICK ALLEY', 0),
        ('restaurant', 'Behind a Restaurant', 'SECTOR 02 · KITCHEN SERVICE EXIT', 5),
        ('parking-garage', 'Parking Garage', 'SECTOR 03 · SUB-LEVEL B2 DECK', 15),
        ('dumpster', 'By a Dumpster', 'SECTOR 04 · LOADING DOCK CORRAL', 30);
      INSERT INTO date_dim (date_key, iso_date, year, month, day_of_month, day_of_week)
        VALUES (20261015, '2026-10-15', 2026, 10, 15, 4);
      INSERT INTO player_dim (id, callsign, token_hash, platform, lifetime_smoked, best_smoked, shifts_completed, created_at, updated_at)
        VALUES
          ('p-vet', 'VET-SMOKER', 'hash-vet', 'web', 15, 10, 2, 1700000000, 1700000050),
          ('p-legacy-no-shifts', 'OLD-TIMER', 'hash-old', 'web', 7, 7, 1, 1700000000, 1700000050);
      INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
        VALUES
          ('s-vet-1', 'p-vet', 'alleyway', 20261015, 'web', 5, 60, 14000, 'verified', 1700000000, 1700000015),
          ('s-vet-2', 'p-vet', 'restaurant', 20261015, 'web', 10, 120, 14500, 'verified', 1700000020, 1700000035);
    `);

    // 1) Verify Cloudflare D1 transactional batch migration (ensureD1Schema) on a raw v2 DB with active shift_fact foreign keys
    const { createD1Store } = await import('../../server/d1Schema.js');
    const d1Transactional = {
      prepare(sql: string) {
        let boundArgs: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return this;
          },
          async first() {
            const trimmed = sql.trim().toUpperCase();
            if (trimmed.startsWith('PRAGMA') && trimmed.includes('=')) {
              legacyDb.exec(sql);
              return null;
            }
            return legacyDb.prepare(sql).get(...(boundArgs as string[])) ?? null;
          },
          async all() {
            const trimmed = sql.trim().toUpperCase();
            if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
              return { results: legacyDb.prepare(sql).all(...(boundArgs as string[])) };
            }
            legacyDb.prepare(sql).run(...(boundArgs as string[]));
            return { results: [] };
          },
          async run() {
            const trimmed = sql.trim().toUpperCase();
            if (trimmed.startsWith('PRAGMA') && trimmed.includes('=')) {
              legacyDb.exec(sql);
              return { success: true };
            }
            legacyDb.prepare(sql).run(...(boundArgs as string[]));
            return { success: true };
          },
        };
      },
      async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        legacyDb.exec('BEGIN IMMEDIATE');
        try {
          const out = [];
          for (const stmt of statements) {
            out.push(await stmt.run());
          }
          legacyDb.exec('COMMIT');
          return out;
        } catch (err) {
          legacyDb.exec('ROLLBACK');
          throw err;
        }
      },
    };
    await ensureD1Schema(d1Transactional, new Date('2026-10-15T12:00:00Z'));
    const d1Store = createD1Store(d1Transactional);
    const d1LegacyRow = await d1Store.getPlayerById('p-legacy-no-shifts');
    const d1LegacyProfile = formatPlayerProfile(d1LegacyRow!);
    expect(d1LegacyProfile.smokedByEnvironment.alleyway).toBe(7);
    expect(d1LegacyProfile.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);
    legacyDb.close();

    // 2) Re-open with openSqliteDb and verify idempotent SQLite v3 migration
    const migratedDb = openSqliteDb(dbFile, { now: new Date('2026-10-15T12:00:00Z') });
    try {
      const versionRow = migratedDb
        .prepare("SELECT value FROM app_config WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;
      expect(versionRow?.value).toBe('3');

      const envCount = migratedDb
        .prepare('SELECT COUNT(*) AS count FROM environment_dim')
        .get() as { count: number };
      expect(envCount.count).toBe(12);

      const store = createSqliteStore(migratedDb);
      const vetRow = await store.getPlayerById('p-vet');
      expect(vetRow).not.toBeNull();
      const profile = formatPlayerProfile(vetRow!);
      expect(profile.callsign).toBe('VET-SMOKER');
      expect(profile.lifetimeSmoked).toBe(15);
      expect(profile.promotionRoundsCleared).toBe(0);
      expect(profile.smokedByEnvironment).toMatchObject({
        alleyway: 5,
        restaurant: 10,
        'parking-garage': 0,
      });
      expect(profile.unlockedEnvironments).toEqual(['alleyway', 'restaurant', 'parking-garage']);
    } finally {
      migratedDb.close();
      rmSync(tempDir, { recursive: true, force: true });
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
      expect(output).toContain('penthouse-helipad');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('evaluates 3-round checkpointed Promotion advancement across Phases 1, 2, and 3 without regression on failed attempts', async () => {
    const { evaluatePromotionAttempt, isPhasePromotionUnlocked } = await import(
      '../../server/starSchema.js'
    );

    const phase1Sectors = { alleyway: 5, restaurant: 10, 'parking-garage': 15, dumpster: 20 };
    expect(isPhasePromotionUnlocked(1, { ...phase1Sectors, dumpster: 19 })).toBe(false);
    expect(isPhasePromotionUnlocked(1, phase1Sectors)).toBe(true);

    // Quota-clearing shift in dumpster (before shift dumpster had 10 < 20) does NOT advance Promotion Round 1
    expect(
      evaluatePromotionAttempt({
        environmentId: 'dumpster',
        shiftSmoked: 12,
        smokedByEnvironmentBeforeShift: { ...phase1Sectors, dumpster: 10 },
        promotionRoundsClearedBeforeShift: 0,
      })
    ).toEqual({
      promotionDelta: 0,
      newPromotionRoundsCleared: 0,
      unlockedPhase: 1,
      isChairman: false,
    });

    // Once all 4 Phase 1 quotas are met, Round 1 (10), Round 2 (15), Round 3 (20) advance one round at a time
    expect(
      evaluatePromotionAttempt({
        environmentId: 'dumpster',
        shiftSmoked: 10,
        smokedByEnvironmentBeforeShift: phase1Sectors,
        promotionRoundsClearedBeforeShift: 0,
      })
    ).toEqual({
      promotionDelta: 1,
      newPromotionRoundsCleared: 1,
      unlockedPhase: 1,
      isChairman: false,
    });

    // Failing Round 2 (14 < 15) keeps promotionRoundsCleared at 1 (checkpointed)
    expect(
      evaluatePromotionAttempt({
        environmentId: 'dumpster',
        shiftSmoked: 14,
        smokedByEnvironmentBeforeShift: phase1Sectors,
        promotionRoundsClearedBeforeShift: 1,
      })
    ).toEqual({
      promotionDelta: 0,
      newPromotionRoundsCleared: 1,
      unlockedPhase: 1,
      isChairman: false,
    });

    // Clearing Round 3 (20 >= 20) unlocks Phase 2 (promotionRoundsCleared = 3)
    expect(
      evaluatePromotionAttempt({
        environmentId: 'dumpster',
        shiftSmoked: 20,
        smokedByEnvironmentBeforeShift: phase1Sectors,
        promotionRoundsClearedBeforeShift: 2,
      })
    ).toEqual({
      promotionDelta: 1,
      newPromotionRoundsCleared: 3,
      unlockedPhase: 2,
      isChairman: false,
    });

    // Clearing Phase 3 Round 3 (30 >= 30 in penthouse-helipad) unlocks Chairman (promotionRoundsCleared = 9)
    const allSectorsCleared = {
      ...phase1Sectors,
      'office-sidewalk': 25,
      'breakroom-patio': 30,
      'strip-mall-median': 35,
      'designated-gazebo': 40,
      'executive-balcony': 50,
      'concert-side-stage': 60,
      'superyacht-aft-deck': 75,
      'penthouse-helipad': 100,
    };
    expect(
      evaluatePromotionAttempt({
        environmentId: 'penthouse-helipad',
        shiftSmoked: 30,
        smokedByEnvironmentBeforeShift: allSectorsCleared,
        promotionRoundsClearedBeforeShift: 8,
      })
    ).toEqual({
      promotionDelta: 1,
      newPromotionRoundsCleared: 9,
      unlockedPhase: 3,
      isChairman: true,
    });
  });
});

