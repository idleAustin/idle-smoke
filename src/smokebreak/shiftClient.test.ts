import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../server/shiftApi.js';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import {
  deletePlayerAccount,
  loginWithPassword,
  signOutPlayerSession,
  updatePlayerAvatarConfig,
  updatePlayerCallsign,
} from './accountClient';
import {
  bootstrapPlayerSession,
  flushPendingShifts,
  startShiftSession,
  submitFinishedShift,
} from './shiftClient';
import {
  getCachedPlayerProfile,
  getPendingShifts,
  resetShiftClientStateForTests,
} from './shiftStorage';
import { resolveEnvironmentImagePath } from './EnvironmentDeck';
import { freshShiftSession, recordShiftDrag } from './smokeBreak';
import { createSmokeSession, joinSmokeSessionByCode } from './smokeSessionClient';

function createStoreFetch(
  store: ReturnType<typeof createSqliteStore>,
  env?: Record<string, unknown>
) {
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
      { nowUnix: 1760550000, ...(env ? { env } : {}) }
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

  it('starts a shift session, submits pressOffsetsMs with shiftId, unlocks restaurant at 5 butts, and verifies 61+ butts (>360 drags) without capping', async () => {
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

      // High-volume >360 drags (364 drags = 61 cigarettes) recorded by recordShiftDrag are verified and increment progression accurately
      let highVolumeSession = freshShiftSession();
      for (let i = 0; i < 364; i++) {
        highVolumeSession = recordShiftDrag(highVolumeSession, i * 10);
      }
      expect(highVolumeSession.pressOffsetsMs).toHaveLength(364);
      expect(highVolumeSession.state.smoked).toBe(61);

      const highVolumeRes = await submitFinishedShift(
        {
          environmentId: 'restaurant',
          pressOffsetsMs: highVolumeSession.pressOffsetsMs,
        },
        fetchMock
      );
      expect(highVolumeRes.verified).toBe(true);
      expect(highVolumeRes.queued).toBe(false);
      expect(highVolumeRes.smoked).toBe(61);
      expect(highVolumeRes.profile.lifetimeSmoked).toBe(66);
      expect(highVolumeRes.profile.bestSmoked).toBe(61);
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

  it('syncs player progression and unlocked sectors across devices via loginWithPassword and rejects wrong passwords', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const fetchMock = createStoreFetch(store);

    try {
      // Device 1: Guest smokes 5 cigarettes (unlocking 'restaurant'), then registers callsign + password
      const device1Boot = await bootstrapPlayerSession(fetchMock);
      const sixtyDrags = Array.from({ length: 60 }, (_, i) => i * 200);
      await submitFinishedShift(
        {
          environmentId: 'alleyway',
          pressOffsetsMs: sixtyDrags,
        },
        fetchMock
      );

      // Attempting to sign in before creating the account throws Account not found
      await expect(loginWithPassword('NIGHT-OWL', 'secret-pass', fetchMock, 'login')).rejects.toThrow(
        /Account not found/i
      );

      const claimed = await loginWithPassword('NIGHT-OWL', 'secret-pass', fetchMock, 'register');
      expect(claimed.playerId).toBe(device1Boot.profile.playerId);
      expect(claimed.callsign).toBe('NIGHT-OWL');
      expect(claimed.lifetimeSmoked).toBe(5);
      expect(claimed.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);

      // Simulate Device 2 (fresh storage): starts as a new anonymous guest with 0 butts
      resetShiftClientStateForTests();
      const device2Guest = await bootstrapPlayerSession(fetchMock);
      expect(device2Guest.profile.playerId).not.toBe(device1Boot.profile.playerId);
      expect(device2Guest.profile.lifetimeSmoked).toBe(0);

      // Wrong password on Device 2 throws error and keeps guest profile
      await expect(loginWithPassword('NIGHT-OWL', 'wrong-pass', fetchMock)).rejects.toThrow(
        /Invalid callsign or password/i
      );

      // Correct password on Device 2 switches stored token & profile to NIGHT-OWL
      const synced = await loginWithPassword('NIGHT-OWL', 'secret-pass', fetchMock);
      expect(synced.playerId).toBe(device1Boot.profile.playerId);
      expect(synced.callsign).toBe('NIGHT-OWL');
      expect(synced.lifetimeSmoked).toBe(5);
      expect(synced.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);
      expect(getCachedPlayerProfile().playerId).toBe(device1Boot.profile.playerId);

      // Subsequent bootstrap on Device 2 stays logged in as NIGHT-OWL
      const reloaded = await bootstrapPlayerSession(fetchMock);
      expect(reloaded.profile.playerId).toBe(device1Boot.profile.playerId);
      expect(reloaded.profile.lifetimeSmoked).toBe(5);
    } finally {
      db.close();
    }
  });

  it('signs out of the current device via signOutPlayerSession (preserving cloud account) and permanently deletes the account via deletePlayerAccount', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const fetchMock = createStoreFetch(store);

    try {
      await bootstrapPlayerSession(fetchMock);
      const sixtyDrags = Array.from({ length: 60 }, (_, i) => i * 200);
      await submitFinishedShift(
        { environmentId: 'alleyway', pressOffsetsMs: sixtyDrags },
        fetchMock
      );
      const linked = await loginWithPassword('ASH-KING', 'my-secret', fetchMock, 'register');
      expect(linked.callsign).toBe('ASH-KING');
      expect(linked.authProvider).toBe('password');
      expect(linked.lifetimeSmoked).toBe(5);

      // Sign out on this device -> creates a fresh guest identity while keeping ASH-KING intact in D1/SQLite
      const signedOut = await signOutPlayerSession(fetchMock);
      expect(signedOut.profile.playerId).not.toBe(linked.playerId);
      expect(signedOut.profile.callsign).toMatch(/^SHIFT-\d{4}$/);
      expect(signedOut.profile.lifetimeSmoked).toBe(0);
      expect(signedOut.leaderboard.entries).toHaveLength(1);

      // Log back into ASH-KING -> restores 5 butts and ASH-KING profile
      const restored = await loginWithPassword('ASH-KING', 'my-secret', fetchMock);
      expect(restored.playerId).toBe(linked.playerId);
      expect(restored.lifetimeSmoked).toBe(5);

      // Permanently delete ASH-KING -> purges cloud account & leaderboard shifts and boots a fresh guest
      const deleted = await deletePlayerAccount(fetchMock);
      expect(deleted.deletedCallsign).toBe('ASH-KING');
      expect(deleted.profile.playerId).not.toBe(linked.playerId);
      expect(deleted.profile.lifetimeSmoked).toBe(0);
      expect(deleted.leaderboard.entries).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('normalizes smokedByEnvironment, promotionRoundsCleared, unlockedPhase, and isChairman when clearing Phase 3 Round 3 via submitFinishedShift', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    try {
      const store = createSqliteStore(db);
      const fetchMock = createStoreFetch(store);
      const boot = await bootstrapPlayerSession(fetchMock);

      // Seed player with all 12 sector quotas met and promotion_rounds_cleared = 8
      db.prepare('UPDATE player_dim SET promotion_rounds_cleared = 8 WHERE id = ?').run(
        boot.profile.playerId
      );
      const quotas: Array<[string, number]> = [
        ['alleyway', 5],
        ['restaurant', 10],
        ['parking-garage', 15],
        ['dumpster', 20],
        ['office-sidewalk', 25],
        ['breakroom-patio', 30],
        ['strip-mall-median', 35],
        ['designated-gazebo', 40],
        ['executive-balcony', 50],
        ['concert-side-stage', 60],
        ['superyacht-aft-deck', 75],
        ['penthouse-helipad', 100],
      ];
      for (const [envId, count] of quotas) {
        db.prepare(
          `INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
           VALUES (?, ?, ?, 20261015, 'web', ?, 120, 14000, 'verified', 1700000000, 1700000015)`
        ).run(`seed-${envId}`, boot.profile.playerId, envId, count);
      }

      // Refresh profile -> unlockedPhase = 3, isChairman = false, all 12 sectors unlocked
      const refreshed = await bootstrapPlayerSession(fetchMock);
      expect(refreshed.profile.promotionRoundsCleared).toBe(8);
      expect(refreshed.profile.unlockedPhase).toBe(3);
      expect(refreshed.profile.isChairman).toBe(false);
      expect(refreshed.profile.unlockedEnvironments).toHaveLength(12);

      // Submit 30 butts (240 presses: 120 + 80 + 40) in penthouse-helipad -> clears Round 9 -> Chairman!
      const thirtyButtsOffsets = Array.from({ length: 240 }, (_, idx) => idx * 30);
      const finish = await submitFinishedShift(
        { environmentId: 'penthouse-helipad', pressOffsetsMs: thirtyButtsOffsets },
        fetchMock
      );
      expect(finish.verified).toBe(true);
      expect(finish.smoked).toBe(30);
      expect(finish.profile.promotionRoundsCleared).toBe(9);
      expect(finish.profile.unlockedPhase).toBe(3);
      expect(finish.profile.isChairman).toBe(true);
      expect(finish.profile.smokedByEnvironment['penthouse-helipad']).toBe(130);
    } finally {
      db.close();
    }
  });

  it('flushes a multi-shift offline batch where an earlier shift clears the 4th sector quota and subsequent queued shifts clear Rounds 1-3 of the Promotion gauntlet into Phase 2', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    try {
      const store = createSqliteStore(db);
      const onlineFetch = createStoreFetch(store);
      const offlineFetch = async (): Promise<Response> => {
        throw new Error('Network unreachable');
      };

      const boot = await bootstrapPlayerSession(onlineFetch);
      // Seed Sectors 01-03 quotas met so dumpster (SEC-04) is unlocked with 0/20 butts
      for (const [envId, count] of [
        ['alleyway', 5],
        ['restaurant', 10],
        ['parking-garage', 15],
      ] as const) {
        db.prepare(
          `INSERT INTO shift_fact (id, player_id, environment_id, date_key, platform, smoked, tap_count, duration_ms, status, started_at, completed_at)
           VALUES (?, ?, ?, 20261015, 'web', ?, 120, 14000, 'verified', 1700000000, 1700000015)`
        ).run(`pre-${envId}`, boot.profile.playerId, envId, count);
      }
      await bootstrapPlayerSession(onlineFetch);

      const makeDrags = (n: number) => Array.from({ length: n }, (_, i) => i * 25);

      // Offline Shift 1: 20 butts (200 drags) in dumpster -> meets dumpster 20-butt quota (promotionRoundsCleared stays 0)
      const qQuota = await submitFinishedShift(
        { shiftId: 'off-promo-0', environmentId: 'dumpster', pressOffsetsMs: makeDrags(200), startedAt: 1760549900 },
        offlineFetch
      );
      expect(qQuota.queued).toBe(true);
      expect(qQuota.profile.smokedByEnvironment.dumpster).toBe(20);
      expect(qQuota.profile.promotionRoundsCleared).toBe(0);

      // Offline Shift 2: Round 1 (10 butts = 120 drags) -> promotionRoundsCleared = 1
      const qR1 = await submitFinishedShift(
        { shiftId: 'off-promo-1', environmentId: 'dumpster', pressOffsetsMs: makeDrags(120), startedAt: 1760549920 },
        offlineFetch
      );
      expect(qR1.profile.promotionRoundsCleared).toBe(1);

      // Offline Shift 3: Round 2 (15 butts = 160 drags) -> promotionRoundsCleared = 2
      const qR2 = await submitFinishedShift(
        { shiftId: 'off-promo-2', environmentId: 'dumpster', pressOffsetsMs: makeDrags(160), startedAt: 1760549940 },
        offlineFetch
      );
      expect(qR2.profile.promotionRoundsCleared).toBe(2);

      // Offline Shift 4: Round 3 (20 butts = 200 drags) -> promotionRoundsCleared = 3, unlocks office-sidewalk (Phase 2)
      const qR3 = await submitFinishedShift(
        { shiftId: 'off-promo-3', environmentId: 'dumpster', pressOffsetsMs: makeDrags(200), startedAt: 1760549960 },
        offlineFetch
      );
      expect(qR3.profile.promotionRoundsCleared).toBe(3);
      expect(qR3.profile.unlockedPhase).toBe(2);
      expect(qR3.newlyUnlockedEnvironments).toEqual(['office-sidewalk']);

      // Offline Shift 5: 25 butts (220 drags) in newly unlocked office-sidewalk -> unlocks breakroom-patio
      const qPhase2 = await submitFinishedShift(
        { shiftId: 'off-phase2-1', environmentId: 'office-sidewalk', pressOffsetsMs: makeDrags(220), startedAt: 1760549980 },
        offlineFetch
      );
      expect(qPhase2.profile.unlockedEnvironments).toContain('breakroom-patio');
      expect(getPendingShifts()).toHaveLength(5);

      // Reconnect and flush all 5 queued shifts in FIFO order -> server verifies all 5 without 403 environment_locked
      const flushed = await flushPendingShifts(onlineFetch);
      expect(flushed.flushedCount).toBe(5);
      expect(flushed.remainingCount).toBe(0);
      expect(flushed.profile.promotionRoundsCleared).toBe(3);
      expect(flushed.profile.unlockedPhase).toBe(2);
      expect(flushed.profile.smokedByEnvironment.dumpster).toBe(65);
      expect(flushed.profile.smokedByEnvironment['office-sidewalk']).toBe(25);
      expect(flushed.profile.unlockedEnvironments).toEqual([
        'alleyway',
        'restaurant',
        'parking-garage',
        'dumpster',
        'office-sidewalk',
        'breakroom-patio',
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects with a clean Error message (not a JSON syntax error) when loginWithPassword receives a 500 HTML response', async () => {
    resetShiftClientStateForTests();
    const html500Fetch = async (): Promise<Response> =>
      new Response('<!DOCTYPE html><title>Worker threw exception</title>', {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });

    let caughtError: Error | undefined;
    try {
      await loginWithPassword('test1', 'password123', html500Fetch, 'register');
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError?.message).toMatch(/Failed to sign in|Server error|500/i);
    expect(caughtError?.message).not.toMatch(/Unexpected token '<'|is not valid JSON/i);
  });

  it('persists custom avatarConfig in SQLite across devices via loginWithPassword and exposes it to other players in leaderboard.entries and smokeSession.participants', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const fetchMock = createStoreFetch(store);

    try {
      // Device 1: Register NEON-PUFF, save custom avatarConfig, finish a shift, and host a Smoke Session
      await bootstrapPlayerSession(fetchMock);
      const registered = await loginWithPassword('NEON-PUFF', 'secret-pass', fetchMock, 'register');
      const customAvatar = {
        skinIdx: 4,
        headgearIdx: 5,
        eyesIdx: 2,
        beardIdx: 3,
        smokeIdx: 2,
        collarIdx: 1,
        bgIdx: 4,
      };

      const updatedProfile = await updatePlayerAvatarConfig(customAvatar, fetchMock);
      expect(updatedProfile.avatarConfig).toEqual(customAvatar);

      const dbRow = db
        .prepare('SELECT avatar_config FROM player_dim WHERE id = ?')
        .get(registered.playerId) as { avatar_config: string | null };
      expect(JSON.parse(dbRow.avatar_config ?? 'null')).toEqual(customAvatar);

      const thirtySixDrags = Array.from({ length: 36 }, (_, i) => i * 200);
      await submitFinishedShift(
        { environmentId: 'alleyway', pressOffsetsMs: thirtySixDrags },
        fetchMock
      );
      const hostedSession = await createSmokeSession('alleyway', fetchMock);
      expect(hostedSession.participants[0]?.avatarConfig).toEqual(customAvatar);

      // Device 2: Fresh session logs in as NEON-PUFF and receives persisted avatarConfig
      resetShiftClientStateForTests();
      const device2Login = await loginWithPassword('NEON-PUFF', 'secret-pass', fetchMock, 'login');
      expect(device2Login.playerId).toBe(registered.playerId);
      expect(device2Login.avatarConfig).toEqual(customAvatar);

      // Another user (Player 2) fetches leaderboard and joins Smoke Session -> sees NEON-PUFF's avatarConfig
      resetShiftClientStateForTests();
      const player2Boot = await bootstrapPlayerSession(fetchMock);
      expect(player2Boot.profile.playerId).not.toBe(registered.playerId);
      const lbEntry = player2Boot.leaderboard.entries.find(e => e.callsign === 'NEON-PUFF');
      expect(lbEntry?.avatarConfig).toEqual(customAvatar);

      const joinedSession = await joinSmokeSessionByCode(hostedSession.code, fetchMock);
      const hostParticipant = joinedSession.participants.find(p => p.callsign === 'NEON-PUFF');
      expect(hostParticipant?.avatarConfig).toEqual(customAvatar);
    } finally {
      db.close();
    }
  });

  it('rejects non-admin useAdminScorpion: true on PATCH /api/v1/players/me with 403 while allowing Admin accounts', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-15T12:00:00Z') });
    const store = createSqliteStore(db);
    const ephemeralPasscode = globalThis.crypto.randomUUID();
    const ephemeralAdminEmail = `operator-${globalThis.crypto.randomUUID().slice(0, 8)}@example.test`;
    const env = { ADMIN_EMAILS: ephemeralAdminEmail, ADMIN_PASSCODE: ephemeralPasscode };
    const fetchMock = createStoreFetch(store, env);

    try {
      const { body: guestCreated } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: '{}' },
        store,
        { env }
      );
      const guestToken = String((guestCreated as Record<string, unknown>).playerToken);

      const scorpionConfig = {
        skinIdx: 1,
        headgearIdx: 2,
        eyesIdx: 0,
        beardIdx: 1,
        smokeIdx: 0,
        collarIdx: 2,
        bgIdx: 1,
        useAdminScorpion: true,
      };

      const nonAdminRes = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/players/me',
          authHeader: `Bearer ${guestToken}`,
          rawBody: JSON.stringify({ avatarConfig: scorpionConfig }),
        },
        store,
        { env }
      );
      expect(nonAdminRes.status).toBe(403);
      expect(String((nonAdminRes.body as Record<string, unknown>).error)).toMatch(/Admin Scorpion/i);

      // Sign in as Admin account and save useAdminScorpion: true
      const adminProfile = await loginWithPassword(
        ephemeralAdminEmail,
        ephemeralPasscode,
        fetchMock,
        'login'
      );
      expect(adminProfile.isAdmin).toBe(true);

      const savedAdmin = await updatePlayerAvatarConfig(scorpionConfig, fetchMock);
      expect(savedAdmin.avatarConfig).toEqual(scorpionConfig);
    } finally {
      db.close();
    }
  });
});


