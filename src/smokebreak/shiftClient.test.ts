import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../server/shiftApi.js';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import {
  bootstrapPlayerSession,
  getCachedPlayerProfile,
  resetShiftClientStateForTests,
  startShiftSession,
  submitFinishedShift,
  updatePlayerCallsign,
} from './shiftClient';
import { freshShiftSession, recordShiftDrag } from './smokeBreak';

function createStoreFetch(store: ReturnType<typeof createSqliteStore>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const pathname = new URL(url, 'http://127.0.0.1:4173').pathname;
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const result = await handleApiRequest(
      {
        method: init?.method ?? 'GET',
        pathname,
        authHeader: headers.get('authorization'),
        rawBody,
        clientIp: '127.0.0.1',
      },
      store,
      { nowUnix: 1760550000 }
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('shiftClient frontend progression & leaderboard client', () => {
  it('bootstraps a new player identity, reuses Bearer token on reload, and updates callsign badge', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const fetchMock = createStoreFetch(store);

    try {
      const initial = await bootstrapPlayerSession(fetchMock);
      expect(initial.profile.callsign).toMatch(/^SHIFT-\d{4}$/);
      expect(initial.profile.lifetimeSmoked).toBe(0);
      expect(initial.profile.unlockedEnvironments).toEqual(['alleyway']);
      expect(initial.leaderboard.entries).toEqual([]);

      // Subsequent bootstrap reuses the stored token via GET /api/v1/players/me
      const second = await bootstrapPlayerSession(fetchMock);
      expect(second.profile.playerId).toBe(initial.profile.playerId);

      // Update employee callsign badge
      const updated = await updatePlayerCallsign('FORKLIFT-99', fetchMock);
      expect(updated.callsign).toBe('FORKLIFT-99');
      expect(getCachedPlayerProfile().callsign).toBe('FORKLIFT-99');
    } finally {
      db.close();
    }
  });

  it('starts a shift session, submits pressOffsetsMs with shiftId, unlocks restaurant at 5 butts, and rejects >360 macro taps', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const fetchMock = createStoreFetch(store);

    try {
      await bootstrapPlayerSession(fetchMock);

      // Previewing 'parking-garage' when lifetimeSmoked === 0 starts and submits against unlocked 'alleyway'
      const started = await startShiftSession({ environmentId: 'parking-garage' }, fetchMock);
      expect(started).toMatchObject({
        environmentId: 'alleyway',
      });

      const sixtyDrags = Array.from({ length: 60 }, (_, i) => i * 200);
      const finishRes = await submitFinishedShift(
        {
          shiftId: started?.shiftId,
          environmentId: 'parking-garage',
          pressOffsetsMs: sixtyDrags,
        },
        fetchMock
      );

      expect(finishRes.verified).toBe(true);
      expect(finishRes.shiftId).toBe(started?.shiftId);
      expect(finishRes.smoked).toBe(5);
      expect(finishRes.newlyUnlockedEnvironments).toEqual(['restaurant']);
      expect(finishRes.profile.lifetimeSmoked).toBe(5);
      expect(finishRes.profile.bestSmoked).toBe(5);
      expect(finishRes.profile.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);
      expect(finishRes.leaderboard.entries).toHaveLength(1);
      expect(finishRes.leaderboard.entries[0]).toMatchObject({
        rank: 1,
        smoked: 5,
        environmentId: 'alleyway',
      });

      // Macro >360 drags recorded by recordShiftDrag are rejected by server and do not increment progression
      let macroSession = freshShiftSession();
      for (let i = 0; i < 365; i++) {
        macroSession = recordShiftDrag(macroSession, i * 10);
      }
      expect(macroSession.pressOffsetsMs).toHaveLength(365);

      const rejectedRes = await submitFinishedShift(
        {
          environmentId: 'restaurant',
          pressOffsetsMs: macroSession.pressOffsetsMs,
        },
        fetchMock
      );
      expect(rejectedRes.verified).toBe(false);
      expect(rejectedRes.profile.lifetimeSmoked).toBe(5);
    } finally {
      db.close();
    }
  });
});


