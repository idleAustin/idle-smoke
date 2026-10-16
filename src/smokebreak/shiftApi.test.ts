import { describe, expect, it } from 'vitest';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import { createD1Store, ensureD1Schema } from '../../server/d1Schema.js';
import { handleApiRequest } from '../../server/shiftApi.js';
import { hashPlayerToken } from '../../server/shiftVerifier.js';
import { createApp } from '../../server/index.js';
import worker from '../../server/worker.js';

function createMemoryD1(sqliteDb: ReturnType<typeof openSqliteDb>) {
  const bindStatement = (sql: string, params: unknown[] = []) => ({
    bind(...nextParams: unknown[]) {
      return bindStatement(sql, nextParams);
    },
    async first() {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('PRAGMA') && trimmed.includes('=')) {
        sqliteDb.exec(sql);
        return null;
      }
      return (sqliteDb.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined) ?? null;
    },
    async all() {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT')) {
        const results = sqliteDb.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
        return { results };
      }
      sqliteDb.prepare(sql).run(...(params as never[]));
      return { results: [] };
    },
    async run() {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('PRAGMA') && trimmed.includes('=')) {
        sqliteDb.exec(sql);
        return { success: true };
      }
      sqliteDb.prepare(sql).run(...(params as never[]));
      return { success: true };
    },
  });

  return {
    prepare(sql: string) {
      return bindStatement(sql);
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (const stmt of statements) {
          out.push(await stmt.run());
        }
        sqliteDb.exec('COMMIT');
        return out;
      } catch (err) {
        sqliteDb.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function makeOffsets(count: number, stepMs = 40): number[] {
  return Array.from({ length: count }, (_, idx) => idx * stepMs);
}

describe('Cryptographic Player Identity & Deterministic Shift Replay API', () => {
  it('registers a player with a 256-bit secret token, stores only SHA-256 token_hash in player_dim, and authenticates /players/me', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);

      const createRes = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: JSON.stringify({ platform: 'ios' }) },
        store
      );

      expect(createRes.status).toBe(201);
      const created = createRes.body as Record<string, unknown>;
      expect(typeof created.playerId).toBe('string');
      expect(created.playerToken).toMatch(/^[a-f0-9]{64}$/);
      expect(created.callsign).toMatch(/^SHIFT-\d{4}$/);
      expect(created.platform).toBe('ios');
      expect(created.lifetimeSmoked).toBe(0);
      expect(created.bestSmoked).toBe(0);
      expect(created.shiftsCompleted).toBe(0);
      expect(created.unlockedEnvironments).toEqual(['alleyway']);

      const expectedHash = await hashPlayerToken(String(created.playerToken));
      const row = db.prepare('SELECT id, callsign, token_hash, platform FROM player_dim WHERE id = ?').get(
        String(created.playerId)
      ) as Record<string, unknown>;

      expect(row.token_hash).toBe(expectedHash);
      expect(row.token_hash).not.toBe(created.playerToken);

      const meRes = await handleApiRequest(
        {
          method: 'GET',
          pathname: '/api/v1/players/me',
          authHeader: `Bearer ${created.playerToken}`,
        },
        store
      );
      expect(meRes.status).toBe(200);
      expect(meRes.body).toEqual({
        playerId: created.playerId,
        callsign: created.callsign,
        platform: 'ios',
        lifetimeSmoked: 0,
        bestSmoked: 0,
        shiftsCompleted: 0,
        unlockedEnvironments: ['alleyway'],
      });
      expect(JSON.stringify(meRes.body)).not.toContain(expectedHash);
    } finally {
      db.close();
    }
  });

  it('requires Bearer auth on PATCH /api/v1/players/me and validates callsign rules (2-16 chars, [A-Za-z0-9 _-])', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);
      const { body: created } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: '{}' },
        store
      );
      const token = String((created as Record<string, unknown>).playerToken);

      const unauth = await handleApiRequest(
        { method: 'PATCH', pathname: '/api/v1/players/me', rawBody: JSON.stringify({ callsign: 'ACE-01' }) },
        store
      );
      expect(unauth.status).toBe(401);

      const badToken = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/players/me',
          authHeader: 'Bearer deadbeef',
          rawBody: JSON.stringify({ callsign: 'ACE-01' }),
        },
        store
      );
      expect(badToken.status).toBe(401);

      for (const invalidCallsign of ['A', 'TOO_LONG_CALLSIGN_123', 'BAD$CHAR!', '<script>']) {
        const badRes = await handleApiRequest(
          {
            method: 'PATCH',
            pathname: '/api/v1/players/me',
            authHeader: `Bearer ${token}`,
            rawBody: JSON.stringify({ callsign: invalidCallsign }),
          },
          store
        );
        expect(badRes.status).toBe(400);
      }

      const validRes = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/players/me',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ callsign: 'NIGHT SHIFT_99' }),
        },
        store
      );
      expect(validRes.status).toBe(200);
      expect((validRes.body as Record<string, unknown>).callsign).toBe('NIGHT SHIFT_99');
    } finally {
      db.close();
    }
  });

  it('replays pressOffsetsMs deterministically in <10ms, updates shift_fact and player_dim atomically, and unlocks environments at 0, 5, 15, and 30', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);
      const { body: created } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: '{}' },
        store
      );
      const token = String((created as Record<string, unknown>).playerToken);

      // Cannot start or finish in locked 'restaurant' at 0 lifetime cigarettes
      const lockedStart = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/start',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'restaurant' }),
        },
        store
      );
      expect(lockedStart.status).toBe(400);

      // Start shift 1 in 'alleyway' and smoke 5 cigarettes (60 presses) -> unlocks 'restaurant'
      const start1 = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/start',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'alleyway' }),
        },
        store
      );
      expect(start1.status).toBe(201);
      const shiftId1 = String((start1.body as Record<string, unknown>).shiftId);

      const t0 = performance.now();
      const finish1 = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            shiftId: shiftId1,
            environmentId: 'alleyway',
            pressOffsetsMs: makeOffsets(60, 100),
          }),
        },
        store
      );
      const elapsedMs = performance.now() - t0;
      expect(elapsedMs).toBeLessThan(10);
      expect(finish1.status).toBe(200);

      const body1 = finish1.body as Record<string, unknown>;
      expect(body1.verified).toBe(true);
      expect(body1.smoked).toBe(5);
      expect(body1.tapCount).toBe(60);
      expect(body1.newlyUnlockedEnvironments).toEqual(['restaurant']);
      const profile1 = body1.profile as Record<string, unknown>;
      expect(profile1.lifetimeSmoked).toBe(5);
      expect(profile1.bestSmoked).toBe(5);
      expect(profile1.shiftsCompleted).toBe(1);
      expect(profile1.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);

      // Idempotent retry of the same shiftId does not double-increment lifetimeSmoked
      const duplicateFinish1 = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            shiftId: shiftId1,
            environmentId: 'alleyway',
            pressOffsetsMs: makeOffsets(60, 100),
          }),
        },
        store
      );
      expect(duplicateFinish1.status).toBe(200);
      expect(((duplicateFinish1.body as Record<string, unknown>).profile as Record<string, unknown>).lifetimeSmoked).toBe(5);

      // Shift 2 in newly unlocked 'restaurant': 10 cigarettes (120 presses) -> lifetime 15 -> unlocks 'parking-garage'
      const finish2 = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            environmentId: 'restaurant',
            pressOffsetsMs: makeOffsets(120, 50),
          }),
        },
        store
      );
      expect(finish2.status).toBe(200);
      const body2 = finish2.body as Record<string, unknown>;
      expect(body2.smoked).toBe(10);
      expect(body2.newlyUnlockedEnvironments).toEqual(['parking-garage']);
      expect((body2.profile as Record<string, unknown>).lifetimeSmoked).toBe(15);
      expect((body2.profile as Record<string, unknown>).bestSmoked).toBe(10);
      expect((body2.profile as Record<string, unknown>).unlockedEnvironments).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
      ]);

      // Shift 3 in 'parking-garage': 15 cigarettes (180 presses) -> lifetime 30 -> unlocks 'dumpster'
      const finish3 = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            environmentId: 'parking-garage',
            pressOffsetsMs: makeOffsets(180, 50),
          }),
        },
        store
      );
      expect(finish3.status).toBe(200);
      const body3 = finish3.body as Record<string, unknown>;
      expect(body3.smoked).toBe(15);
      expect(body3.newlyUnlockedEnvironments).toEqual(['dumpster']);
      expect((body3.profile as Record<string, unknown>).lifetimeSmoked).toBe(30);
      expect((body3.profile as Record<string, unknown>).bestSmoked).toBe(15);
      expect((body3.profile as Record<string, unknown>).unlockedEnvironments).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
        'dumpster',
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects all tamper vectors with 400 or 401 (spoofed smoked count, negative/>15000ms/non-monotonic offsets, >360 taps, invalid token, >16kb payload)', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);
      const { body: created } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: '{}' },
        store
      );
      const token = String((created as Record<string, unknown>).playerToken);

      // 1. Missing or invalid Bearer token -> 401
      const noToken = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: [0, 100] }),
        },
        store
      );
      expect(noToken.status).toBe(401);

      const invalidToken = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: 'Bearer not-a-real-token',
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: [0, 100] }),
        },
        store
      );
      expect(invalidToken.status).toBe(401);

      // 2. Client-submitted { smoked: 999 } spoofing -> 400
      const spoofedSmoked = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            environmentId: 'alleyway',
            smoked: 999,
            pressOffsetsMs: makeOffsets(12, 100),
          }),
        },
        store
      );
      expect(spoofedSmoked.status).toBe(400);

      const spoofedOnlySmoked = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ smoked: 999 }),
        },
        store
      );
      expect(spoofedOnlySmoked.status).toBe(400);

      // 3. Negative tap offset -> 400
      const negativeOffset = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: [-1, 100, 200] }),
        },
        store
      );
      expect(negativeOffset.status).toBe(400);

      // 4. Offset > 15000ms -> 400
      const overTimeOffset = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: [0, 1000, 15001] }),
        },
        store
      );
      expect(overTimeOffset.status).toBe(400);

      // 5. Non-decreasing violation -> 400
      const nonMonotonic = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: [0, 500, 499] }),
        },
        store
      );
      expect(nonMonotonic.status).toBe(400);

      // 6. Macro overflow > 360 taps -> 400
      const macroOverflow = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({ environmentId: 'alleyway', pressOffsetsMs: makeOffsets(361, 10) }),
        },
        store
      );
      expect(macroOverflow.status).toBe(400);

      // 7. Unknown shiftId -> 400
      const unknownShiftIdRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: JSON.stringify({
            shiftId: '00000000-0000-4000-8000-000000000000',
            environmentId: 'alleyway',
            pressOffsetsMs: [0, 100],
          }),
        },
        store
      );
      expect(unknownShiftIdRes.status).toBe(400);

      // 8. Oversized payload > 16kb -> 400
      const oversizedPayload = JSON.stringify({
        environmentId: 'alleyway',
        pressOffsetsMs: [0, 100],
        padding: 'x'.repeat(17_000),
      });
      const oversizedRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${token}`,
          rawBody: oversizedPayload,
        },
        store
      );
      expect(oversizedRes.status).toBe(400);

      // Verify tampered shift attempts were flagged as status = 'rejected' in shift_fact
      const rejectedCount = db
        .prepare(`SELECT COUNT(*) AS count FROM shift_fact WHERE status = 'rejected'`)
        .get() as { count: number };
      expect(rejectedCount.count).toBe(4);
    } finally {
      db.close();
    }
  });

  it('returns only sanitized public leaderboard fields and runs identically across Express and Cloudflare Worker', async () => {
    const db = openSqliteDb(':memory:');
    const app = createApp(db);
    const server = await new Promise<import('node:http').Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = server.address() as import('node:net').AddressInfo;
      const expressBaseUrl = `http://127.0.0.1:${addr.port}`;

      // Test Express HTTP registration and oversized body rejection
      const expressCreateResp = await fetch(`${expressBaseUrl}/api/v1/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: 'EXPRESS-01', platform: 'web' }),
      });
      expect(expressCreateResp.status).toBe(201);
      const expressPlayer = (await expressCreateResp.json()) as Record<string, unknown>;

      const expressOversizedResp = await fetch(`${expressBaseUrl}/api/v1/shifts/finish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expressPlayer.playerToken}`,
        },
        body: JSON.stringify({
          environmentId: 'alleyway',
          pressOffsetsMs: [0, 100],
          pad: 'z'.repeat(17_000),
        }),
      });
      expect(expressOversizedResp.status).toBe(400);

      const d1 = createMemoryD1(db);
      await ensureD1Schema(d1);
      const d1Store = createD1Store(d1);

      const createReq = new Request('https://idlemullet.com/idle-smoke/api/v1/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: 'EDGE-RUNNER', platform: 'android' }),
      });
      const createResp = await worker.fetch(createReq, {
        DB: d1,
        ASSETS: { fetch: async () => new Response('not-found', { status: 404 }) },
      });
      expect(createResp.status).toBe(201);
      const player = (await createResp.json()) as Record<string, unknown>;

      const finishReq = new Request('https://idlemullet.com/idle-smoke/api/v1/shifts/finish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player.playerToken}`,
        },
        body: JSON.stringify({
          environmentId: 'alleyway',
          pressOffsetsMs: makeOffsets(36, 100),
        }),
      });
      const finishResp = await worker.fetch(finishReq, {
        DB: d1,
        ASSETS: { fetch: async () => new Response('not-found', { status: 404 }) },
      });
      expect(finishResp.status).toBe(200);
      const finished = (await finishResp.json()) as Record<string, unknown>;
      expect(finished.smoked).toBe(3);

      const lbRes = await handleApiRequest({ method: 'GET', pathname: '/api/v1/leaderboard' }, d1Store);
      expect(lbRes.status).toBe(200);
      const lb = lbRes.body as {
        entries: Array<Record<string, unknown>>;
        stats: { totalPlayers: number; totalShifts: number; totalSmoked: number };
      };
      expect(lb.stats).toEqual({
        totalPlayers: 2,
        totalShifts: 1,
        totalSmoked: 3,
      });
      expect(lb.entries).toHaveLength(1);
      expect(Object.keys(lb.entries[0]).sort()).toEqual(
        ['callsign', 'completedAt', 'environmentId', 'rank', 'smoked'].sort()
      );
      expect(lb.entries[0]).toMatchObject({
        rank: 1,
        callsign: 'EDGE-RUNNER',
        smoked: 3,
        environmentId: 'alleyway',
      });
      const serialized = JSON.stringify(lb);
      expect(serialized).not.toContain(String(player.playerId));
      expect(serialized).not.toContain(String(player.playerToken));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    }
  });
});
