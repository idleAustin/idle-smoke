// Shift session lifecycle client: player bootstrap, offline queue flushing, shift start, and finished shift submission.

import { verifyShiftReplay } from '../../server/shiftVerifier.js';
import { getPlatform } from '../platform';
import {
  clearStoredToken, createRejectedShiftResult, enqueueOfflineShift,
  getActiveFlushPromise, getCachedLeaderboard, getCachedPlayerProfile, getStoredToken,
  hydrateNativeStorage, normalizeProfile, readPendingShiftsFromStorage,
  resolveApiPath, resolveShiftEnvironment, resolveStartedAtUnix,
  setActiveFlushPromise, setCachedLeaderboard, setCachedProfile, setStoredToken,
  writePendingShiftsToStorage,
  type FetchLike, type LeaderboardResponse, type PlayerProfile,
  type ShiftFinishResult, type StartedShiftSession,
} from './shiftStorage';
import { type EnvironmentId } from './smokeBreak';
import { normalizeSmokeSession } from './smokeSessionClient';

async function fetchLeaderboard(fetchImpl: FetchLike): Promise<LeaderboardResponse> {
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/leaderboard'), { method: 'GET' });
    if (res.ok) {
      const data = (await res.json()) as LeaderboardResponse;
      setCachedLeaderboard(data);
      return data;
    }
  } catch {
    // Return cached leaderboard when unreachable
  }
  return getCachedLeaderboard();
}

export async function ensureAuthenticatedPlayer(
  fetchImpl: FetchLike,
  options: { preserveOptimisticIfPending?: boolean } = {}
): Promise<{ token: string | null; profile: PlayerProfile; reachable: boolean }> {
  await hydrateNativeStorage();
  const existingToken = getStoredToken();
  const hasPending = readPendingShiftsFromStorage().length > 0;

  if (existingToken) {
    if (options.preserveOptimisticIfPending && hasPending) {
      return { token: existingToken, profile: getCachedPlayerProfile(), reachable: true };
    }
    try {
      const meRes = await fetchImpl(resolveApiPath('/api/v1/players/me'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${existingToken}` },
      });
      if (meRes.ok) {
        const raw = (await meRes.json()) as Record<string, unknown>;
        const profile = normalizeProfile(raw);
        if (!hasPending) setCachedProfile(profile);
        return {
          token: existingToken,
          profile: hasPending ? getCachedPlayerProfile() : profile,
          reachable: true,
        };
      }
      if (meRes.status === 401) {
        clearStoredToken();
      } else if (meRes.status >= 500 || meRes.status === 429) {
        return { token: existingToken, profile: getCachedPlayerProfile(), reachable: false };
      }
    } catch {
      return { token: existingToken, profile: getCachedPlayerProfile(), reachable: false };
    }
  }

  try {
    const createRes = await fetchImpl(resolveApiPath('/api/v1/players'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: getPlatform() }),
    });
    if (createRes.ok) {
      const raw = (await createRes.json()) as Record<string, unknown>;
      const token = typeof raw.playerToken === 'string' ? raw.playerToken : getStoredToken();
      if (token) setStoredToken(token);
      const profile = normalizeProfile(raw);
      if (!hasPending) setCachedProfile(profile);
      return {
        token: token ?? null,
        profile: hasPending ? getCachedPlayerProfile() : profile,
        reachable: true,
      };
    }
  } catch {
    // Fallback to cached/default profile when unreachable
  }

  return { token: getStoredToken(), profile: getCachedPlayerProfile(), reachable: false };
}

export async function flushPendingShifts(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{
  flushedCount: number;
  remainingCount: number;
  profile: PlayerProfile;
  leaderboard: LeaderboardResponse;
}> {
  const existingFlush = getActiveFlushPromise();
  if (existingFlush) return existingFlush;

  const flushPromise = (async () => {
    await hydrateNativeStorage();
    const queue = [...readPendingShiftsFromStorage()];
    if (queue.length === 0) {
      return {
        flushedCount: 0, remainingCount: 0,
        profile: getCachedPlayerProfile(), leaderboard: getCachedLeaderboard(),
      };
    }

    let auth = await ensureAuthenticatedPlayer(fetchImpl, { preserveOptimisticIfPending: true });
    if (!auth.token || !auth.reachable) {
      return {
        flushedCount: 0, remainingCount: queue.length,
        profile: getCachedPlayerProfile(), leaderboard: getCachedLeaderboard(),
      };
    }

    let flushedCount = 0;
    let droppedCount = 0;
    let latestProfile = auth.profile;

    while (queue.length > 0) {
      const item = queue[0];
      try {
        const res = await fetchImpl(resolveApiPath('/api/v1/shifts/finish'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shiftId: item.shiftId,
            environmentId: item.environmentId,
            pressOffsetsMs: item.pressOffsetsMs,
            startedAt: item.startedAt,
            platform: latestProfile.platform,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          latestProfile = normalizeProfile(
            (data.profile as Record<string, unknown>) ?? latestProfile
          );
          if (data.leaderboard) setCachedLeaderboard(data.leaderboard as LeaderboardResponse);
          queue.shift();
          writePendingShiftsToStorage(queue);
          if (queue.length === 0) setCachedProfile(latestProfile);
          flushedCount += 1;
          continue;
        }

        if (res.status === 401) {
          clearStoredToken();
          auth = await ensureAuthenticatedPlayer(fetchImpl, { preserveOptimisticIfPending: true });
          if (!auth.token || !auth.reachable) break;
          continue;
        }

        if (res.status === 400 || res.status === 403) {
          // Drop permanently invalid shift payload so it cannot block subsequent shifts
          queue.shift();
          writePendingShiftsToStorage(queue);
          droppedCount += 1;
          continue;
        }

        // 429 rate-limit or 5xx server error: preserve queue and retry later
        break;
      } catch {
        // Network error mid-flush: keep remaining items in FIFO order
        break;
      }
    }

    if (queue.length === 0) {
      if (droppedCount > 0 && flushedCount === 0) {
        const reconciled = await ensureAuthenticatedPlayer(fetchImpl);
        latestProfile = reconciled.profile;
      }
      setCachedProfile(latestProfile);
    }

    return {
      flushedCount, remainingCount: queue.length,
      profile: getCachedPlayerProfile(), leaderboard: getCachedLeaderboard(),
    };
  })().finally(() => {
    setActiveFlushPromise(null);
  });

  setActiveFlushPromise(flushPromise);
  return flushPromise;
}

export async function bootstrapPlayerSession(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ profile: PlayerProfile; leaderboard: LeaderboardResponse }> {
  await hydrateNativeStorage();
  if (readPendingShiftsFromStorage().length > 0) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount > 0) {
      return { profile: flushed.profile, leaderboard: flushed.leaderboard };
    }
  }

  const [{ profile }, leaderboard] = await Promise.all([
    ensureAuthenticatedPlayer(fetchImpl),
    fetchLeaderboard(fetchImpl),
  ]);
  return { profile, leaderboard };
}

export async function startShiftSession(
  params: { environmentId: EnvironmentId; sessionId?: string },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<StartedShiftSession | null> {
  await hydrateNativeStorage();
  if (readPendingShiftsFromStorage().length > 0) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount > 0) return null;
  }

  const { token, profile, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) return null;

  const effectiveEnvironmentId = params.sessionId
    ? params.environmentId
    : resolveShiftEnvironment(params.environmentId, profile.unlockedEnvironments);

  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/shifts/start'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environmentId: effectiveEnvironmentId,
        platform: profile.platform,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return {
        shiftId: String(data.shiftId),
        environmentId: (data.environmentId as EnvironmentId) ?? effectiveEnvironmentId,
        startedAt: Number(data.startedAt ?? 0),
      };
    }
  } catch {
    // Ignore start failure when unreachable
  }

  return null;
}

export async function submitFinishedShift(
  params: {
    shiftId?: string;
    environmentId: EnvironmentId;
    pressOffsetsMs: readonly number[];
    startedAt?: number;
    sessionId?: string;
  },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<ShiftFinishResult> {
  const shiftId = params.shiftId ?? globalThis.crypto.randomUUID();
  const startedAt = resolveStartedAtUnix(params.startedAt);
  await hydrateNativeStorage();

  // Deduplicate if this exact shiftId is already in the local pending queue
  if (readPendingShiftsFromStorage().some(item => item.shiftId === shiftId)) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount === 0) {
      const replay = verifyShiftReplay(params.pressOffsetsMs);
      return {
        shiftId, verified: replay.ok, queued: false,
        smoked: replay.ok ? replay.smoked : 0,
        progress: replay.ok ? replay.progress : 0,
        tapCount: replay.ok ? replay.tapCount : params.pressOffsetsMs.length,
        durationMs: replay.ok ? replay.durationMs : 0,
        newlyUnlockedEnvironments: [],
        profile: flushed.profile, leaderboard: flushed.leaderboard,
      };
    }
    return enqueueOfflineShift({
      shiftId, requestedEnvironmentId: params.environmentId,
      pressOffsetsMs: params.pressOffsetsMs, startedAt,
      baseProfile: getCachedPlayerProfile(),
    });
  }

  // Replay any previously queued offline shifts in FIFO order before submitting the current shift
  if (readPendingShiftsFromStorage().length > 0) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount > 0) {
      return enqueueOfflineShift({
        shiftId, requestedEnvironmentId: params.environmentId,
        pressOffsetsMs: params.pressOffsetsMs, startedAt,
        baseProfile: getCachedPlayerProfile(),
      });
    }
  }

  const { token, profile: currentProfile, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  const unlockedBefore = currentProfile.unlockedEnvironments;
  const effectiveEnvironmentId = params.sessionId
    ? params.environmentId
    : resolveShiftEnvironment(params.environmentId, unlockedBefore);

  if (token && reachable) {
    try {
      const payload: Record<string, unknown> = {
        environmentId: effectiveEnvironmentId,
        pressOffsetsMs: [...params.pressOffsetsMs],
        platform: currentProfile.platform,
        ...(params.shiftId ? { shiftId: params.shiftId } : {}),
        ...(params.startedAt !== undefined ? { startedAt } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      };

      const res = await fetchImpl(resolveApiPath('/api/v1/shifts/finish'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const updatedProfile = normalizeProfile(
          (data.profile as Record<string, unknown>) ?? currentProfile
        );
        setCachedProfile(updatedProfile);
        const leaderboard = (data.leaderboard as LeaderboardResponse) ?? getCachedLeaderboard();
        setCachedLeaderboard(leaderboard);
        const newlyUnlocked = Array.isArray(data.newlyUnlockedEnvironments)
          ? (data.newlyUnlockedEnvironments as EnvironmentId[])
          : updatedProfile.unlockedEnvironments.filter(id => !unlockedBefore.includes(id));
        const smokeSession = normalizeSmokeSession(data.smokeSession);

        return {
          shiftId: String(data.shiftId ?? shiftId),
          verified: Boolean(data.verified ?? true),
          queued: false,
          smoked: Number(data.smoked ?? 0),
          progress: Number(data.progress ?? 0),
          tapCount: Number(data.tapCount ?? params.pressOffsetsMs.length),
          durationMs: Number(data.durationMs ?? 0),
          newlyUnlockedEnvironments: newlyUnlocked,
          profile: updatedProfile,
          leaderboard,
          ...(smokeSession ? { smokeSession } : {}),
        };
      }

      if (res.status === 400 || res.status === 403) {
        return createRejectedShiftResult(shiftId, params.pressOffsetsMs.length, currentProfile);
      }
    } catch {
      // Fall through to offline queue persistence below
    }
  }

  return enqueueOfflineShift({
    shiftId, requestedEnvironmentId: params.environmentId,
    pressOffsetsMs: params.pressOffsetsMs, startedAt,
    baseProfile: currentProfile,
  });
}
