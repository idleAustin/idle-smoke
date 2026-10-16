import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../server/shiftApi.js';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import {
  bootstrapPlayerSession,
  flushPendingShifts,
  getCachedPlayerProfile,
  getPendingShifts,
  resetShiftClientStateForTests,
  startShiftSession,
  submitFinishedShift,
  updatePlayerCallsign,
} from './shiftClient';
import { resolveEnvironmentImagePath } from './EnvironmentDeck';
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
      expect(rejectedRes.queued).toBe(false);
      expect(rejectedRes.profile.lifetimeSmoked).toBe(5);
      expect(getPendingShifts()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('queues finished shifts offline with optimistic counters, deduplicates by shiftId, and replays in FIFO order on reconnect', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const onlineFetch = createStoreFetch(store);
    const offlineFetch = async (): Promise<Response> => {
      throw new Error('Network unreachable');
    };

    try {
      await bootstrapPlayerSession(onlineFetch);

      // Shift 1 completed while offline: 60 drags (5 cigarettes) in alleyway -> optimistically unlocks restaurant
      const sixtyDrags = Array.from({ length: 60 }, (_, i) => i * 200);
      const offlineRes1 = await submitFinishedShift(
        {
          shiftId: 'offline-shift-1',
          environmentId: 'alleyway',
          pressOffsetsMs: sixtyDrags,
          startedAt: 1760549900,
        },
        offlineFetch
      );

      expect(offlineRes1.verified).toBe(false);
      expect(offlineRes1.queued).toBe(true);
      expect(offlineRes1.smoked).toBe(5);
      expect(offlineRes1.newlyUnlockedEnvironments).toEqual(['restaurant']);
      expect(offlineRes1.profile.lifetimeSmoked).toBe(5);
      expect(offlineRes1.profile.bestSmoked).toBe(5);
      expect(offlineRes1.profile.shiftsCompleted).toBe(1);
      expect(offlineRes1.profile.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);

      // Deduplication: retrying the same shiftId while still offline does not double-enqueue or double-increment
      const duplicateOfflineRes1 = await submitFinishedShift(
        {
          shiftId: 'offline-shift-1',
          environmentId: 'alleyway',
          pressOffsetsMs: sixtyDrags,
          startedAt: 1760549900,
        },
        offlineFetch
      );
      expect(duplicateOfflineRes1.profile.lifetimeSmoked).toBe(5);
      expect(getPendingShifts()).toHaveLength(1);
      expect(getPendingShifts()[0]).toEqual({
        shiftId: 'offline-shift-1',
        environmentId: 'alleyway',
        pressOffsetsMs: sixtyDrags,
        startedAt: 1760549900,
      });

      // Shift 2 completed while still offline in newly unlocked 'restaurant': 24 drags (2 cigarettes)
      const twentyFourDrags = Array.from({ length: 24 }, (_, i) => i * 200);
      const offlineRes2 = await submitFinishedShift(
        {
          shiftId: 'offline-shift-2',
          environmentId: 'restaurant',
          pressOffsetsMs: twentyFourDrags,
          startedAt: 1760549950,
        },
        offlineFetch
      );
      expect(offlineRes2.queued).toBe(true);
      expect(offlineRes2.smoked).toBe(2);
      expect(offlineRes2.profile.lifetimeSmoked).toBe(7);
      expect(offlineRes2.profile.bestSmoked).toBe(5);
      expect(offlineRes2.profile.shiftsCompleted).toBe(2);
      expect(getPendingShifts()).toHaveLength(2);

      // Launching while still offline preserves optimistic cached profile and pending queue
      const stillOfflineBootstrap = await bootstrapPlayerSession(offlineFetch);
      expect(stillOfflineBootstrap.profile.lifetimeSmoked).toBe(7);
      expect(getPendingShifts()).toHaveLength(2);

      // Reconnect: flushPendingShifts replays Shift 1 then Shift 2 in FIFO order and reconciles with server
      const flushed = await flushPendingShifts(onlineFetch);
      expect(flushed.flushedCount).toBe(2);
      expect(flushed.remainingCount).toBe(0);
      expect(getPendingShifts()).toEqual([]);
      expect(flushed.profile.lifetimeSmoked).toBe(7);
      expect(flushed.profile.bestSmoked).toBe(5);
      expect(flushed.profile.shiftsCompleted).toBe(2);
      expect(flushed.profile.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);
      expect(flushed.leaderboard.entries).toHaveLength(2);

      // Shift 3 offline (96 drags = 8 butts -> lifetime 15 -> unlocks parking-garage), then Shift 4 online in parking-garage (12 drags = 1 butt)
      const ninetySixDrags = Array.from({ length: 96 }, (_, i) => i * 100);
      const offlineRes3 = await submitFinishedShift(
        {
          shiftId: 'offline-shift-3',
          environmentId: 'restaurant',
          pressOffsetsMs: ninetySixDrags,
          startedAt: 1760549980,
        },
        offlineFetch
      );
      expect(offlineRes3.queued).toBe(true);
      expect(offlineRes3.profile.unlockedEnvironments).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
      ]);

      // Completing Shift 4 when back online flushes Shift 3 first so parking-garage is unlocked on server
      const twelveDrags = Array.from({ length: 12 }, (_, i) => i * 200);
      const onlineRes4 = await submitFinishedShift(
        {
          shiftId: 'online-shift-4',
          environmentId: 'parking-garage',
          pressOffsetsMs: twelveDrags,
          startedAt: 1760549995,
        },
        onlineFetch
      );
      expect(onlineRes4.verified).toBe(true);
      expect(onlineRes4.queued).toBe(false);
      expect(getPendingShifts()).toEqual([]);
      expect(onlineRes4.profile.lifetimeSmoked).toBe(16);
      expect(onlineRes4.profile.bestSmoked).toBe(8);
      expect(onlineRes4.profile.shiftsCompleted).toBe(4);
      expect(onlineRes4.profile.unlockedEnvironments).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
      ]);
    } finally {
      db.close();
    }
  });

  it('resolves environment backdrop image paths cleanly across root, subpath, and Capacitor base URLs', () => {
    expect(resolveEnvironmentImagePath('environments/alleyway.jpg', '/')).toBe('/environments/alleyway.jpg');
    expect(resolveEnvironmentImagePath('environments/alleyway.jpg', '/idle-smoke-break/')).toBe(
      '/idle-smoke-break/environments/alleyway.jpg'
    );
    expect(resolveEnvironmentImagePath('/environments/restaurant.jpg', '/idle-smoke-break')).toBe(
      '/idle-smoke-break/environments/restaurant.jpg'
    );
    expect(resolveEnvironmentImagePath('environments/dumpster.jpg', 'capacitor://localhost/')).toBe(
      'capacitor://localhost/environments/dumpster.jpg'
    );
    expect(resolveEnvironmentImagePath('environments/parking-garage.jpg', 'capacitor://localhost')).toBe(
      'capacitor://localhost/environments/parking-garage.jpg'
    );
  });
});



