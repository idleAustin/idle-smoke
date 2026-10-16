import { normalizeStartedAtUnix, verifyShiftReplay } from '../../server/shiftVerifier.js';
import {
  type EnvironmentId,
  getUnlockedEnvironments,
  projectShiftProgression,
} from './smokeBreak';

type PlatformId = 'web' | 'ios' | 'android';

export interface PlayerProfile {
  playerId: string;
  callsign: string;
  platform: PlatformId;
  lifetimeSmoked: number;
  bestSmoked: number;
  shiftsCompleted: number;
  unlockedEnvironments: EnvironmentId[];
}

export interface LeaderboardEntry {
  rank: number;
  callsign: string;
  smoked: number;
  environmentId: EnvironmentId;
  completedAt: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  stats: {
    totalPlayers: number;
    totalShifts: number;
    totalSmoked: number;
  };
}

export interface StartedShiftSession {
  shiftId: string;
  environmentId: EnvironmentId;
  startedAt: number;
}

export interface PendingShift {
  shiftId: string;
  environmentId: EnvironmentId;
  pressOffsetsMs: number[];
  startedAt: number;
}

export interface ShiftFinishResult {
  shiftId: string;
  verified: boolean;
  queued: boolean;
  smoked: number;
  progress: number;
  tapCount: number;
  durationMs: number;
  newlyUnlockedEnvironments: EnvironmentId[];
  profile: PlayerProfile;
  leaderboard: LeaderboardResponse;
}

const TOKEN_STORAGE_KEY = 'smokebreak.playerToken';
const PROFILE_STORAGE_KEY = 'smokebreak.playerProfile';
const PENDING_SHIFTS_STORAGE_KEY = 'smokebreak.pendingShifts';

const DEFAULT_PROFILE: PlayerProfile = {
  playerId: 'local-preview',
  callsign: 'SHIFT-0000',
  platform: 'web',
  lifetimeSmoked: 0,
  bestSmoked: 0,
  shiftsCompleted: 0,
  unlockedEnvironments: ['alleyway'],
};

const EMPTY_LEADERBOARD: LeaderboardResponse = {
  entries: [],
  stats: { totalPlayers: 0, totalShifts: 0, totalSmoked: 0 },
};

let memoryToken: string | null = null;
let memoryProfile: PlayerProfile | null = null;
let memoryLeaderboard: LeaderboardResponse = EMPTY_LEADERBOARD;
let memoryPendingShifts: PendingShift[] | null = null;
let activeFlushPromise: Promise<{
  flushedCount: number;
  remainingCount: number;
  profile: PlayerProfile;
  leaderboard: LeaderboardResponse;
}> | null = null;

function readStorageItem(key: string): string | null {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return null;
}

function writeStorageItem(key: string, value: string): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage write errors
  }
}

function removeStorageItem(key: string): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage removal errors
  }
}

function getStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  const fromStorage = readStorageItem(TOKEN_STORAGE_KEY);
  if (fromStorage) {
    memoryToken = fromStorage;
    return fromStorage;
  }
  return null;
}

function setStoredToken(token: string): void {
  memoryToken = token;
  writeStorageItem(TOKEN_STORAGE_KEY, token);
}

function clearStoredToken(): void {
  memoryToken = null;
  removeStorageItem(TOKEN_STORAGE_KEY);
}

function normalizePlatformId(value: unknown): PlatformId {
  return value === 'ios' || value === 'android' ? value : 'web';
}

function normalizeProfile(raw: Record<string, unknown>): PlayerProfile {
  const lifetimeSmoked = Number(raw.lifetimeSmoked ?? 0);
  const unlockedRaw = Array.isArray(raw.unlockedEnvironments)
    ? (raw.unlockedEnvironments as EnvironmentId[])
    : getUnlockedEnvironments(lifetimeSmoked);
  return {
    playerId: String(raw.playerId ?? DEFAULT_PROFILE.playerId),
    callsign: String(raw.callsign ?? DEFAULT_PROFILE.callsign),
    platform: normalizePlatformId(raw.platform),
    lifetimeSmoked,
    bestSmoked: Number(raw.bestSmoked ?? 0),
    shiftsCompleted: Number(raw.shiftsCompleted ?? 0),
    unlockedEnvironments: unlockedRaw.length > 0 ? unlockedRaw : ['alleyway'],
  };
}

function setCachedProfile(profile: PlayerProfile): void {
  memoryProfile = profile;
  writeStorageItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function resolveStartedAtUnix(value: unknown): number {
  const result = normalizeStartedAtUnix(value);
  return result.ok ? result.startedAt : Math.floor(Date.now() / 1000);
}

function readPendingShiftsFromStorage(): PendingShift[] {
  if (memoryPendingShifts !== null) {
    return memoryPendingShifts;
  }
  const raw = readStorageItem(PENDING_SHIFTS_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid: PendingShift[] = [];
        for (const entry of parsed) {
          if (typeof entry !== 'object' || entry === null) continue;
          const record = entry as Record<string, unknown>;
          if (typeof record.shiftId !== 'string' || !Array.isArray(record.pressOffsetsMs)) continue;
          valid.push({
            shiftId: record.shiftId,
            environmentId: (record.environmentId as EnvironmentId) ?? 'alleyway',
            pressOffsetsMs: record.pressOffsetsMs.map(n => Number(n)),
            startedAt: resolveStartedAtUnix(record.startedAt),
          });
        }
        memoryPendingShifts = valid;
        return valid;
      }
    } catch {
      // Ignore corrupt pending queue JSON
    }
  }
  memoryPendingShifts = [];
  return memoryPendingShifts;
}

function writePendingShiftsToStorage(queue: PendingShift[]): void {
  memoryPendingShifts = queue;
  writeStorageItem(PENDING_SHIFTS_STORAGE_KEY, JSON.stringify(queue));
}

export function getPendingShifts(): PendingShift[] {
  return readPendingShiftsFromStorage().map(item => ({
    ...item,
    pressOffsetsMs: [...item.pressOffsetsMs],
  }));
}

function createRejectedShiftResult(
  shiftId: string,
  tapCount: number,
  profile: PlayerProfile
): ShiftFinishResult {
  return {
    shiftId,
    verified: false,
    queued: false,
    smoked: 0,
    progress: 0,
    tapCount,
    durationMs: 0,
    newlyUnlockedEnvironments: [],
    profile,
    leaderboard: memoryLeaderboard,
  };
}

function enqueueOfflineShift(params: {
  shiftId: string;
  requestedEnvironmentId: EnvironmentId;
  pressOffsetsMs: readonly number[];
  startedAt: number;
  baseProfile: PlayerProfile;
}): ShiftFinishResult {
  const replay = verifyShiftReplay(params.pressOffsetsMs);
  if (!replay.ok) {
    return createRejectedShiftResult(
      params.shiftId,
      params.pressOffsetsMs.length,
      params.baseProfile
    );
  }

  const effectiveEnvironmentId = resolveShiftEnvironment(
    params.requestedEnvironmentId,
    params.baseProfile.unlockedEnvironments
  );
  const queue = readPendingShiftsFromStorage();
  const alreadyQueued = queue.some(item => item.shiftId === params.shiftId);

  if (alreadyQueued) {
    return {
      shiftId: params.shiftId,
      verified: false,
      queued: true,
      smoked: replay.smoked,
      progress: replay.progress,
      tapCount: replay.tapCount,
      durationMs: replay.durationMs,
      newlyUnlockedEnvironments: [],
      profile: getCachedPlayerProfile(),
      leaderboard: memoryLeaderboard,
    };
  }

  const nextEntry: PendingShift = {
    shiftId: params.shiftId,
    environmentId: effectiveEnvironmentId,
    pressOffsetsMs: [...params.pressOffsetsMs],
    startedAt: params.startedAt,
  };
  writePendingShiftsToStorage([...queue, nextEntry]);

  const projected = projectShiftProgression(
    params.baseProfile.lifetimeSmoked,
    params.baseProfile.bestSmoked,
    params.baseProfile.unlockedEnvironments,
    replay.smoked
  );
  const optimisticProfile: PlayerProfile = {
    ...params.baseProfile,
    lifetimeSmoked: projected.lifetimeSmoked,
    bestSmoked: projected.bestSmoked,
    shiftsCompleted: params.baseProfile.shiftsCompleted + 1,
    unlockedEnvironments: projected.unlockedEnvironments,
  };
  setCachedProfile(optimisticProfile);

  return {
    shiftId: params.shiftId,
    verified: false,
    queued: true,
    smoked: replay.smoked,
    progress: replay.progress,
    tapCount: replay.tapCount,
    durationMs: replay.durationMs,
    newlyUnlockedEnvironments: projected.newlyUnlockedEnvironments,
    profile: optimisticProfile,
    leaderboard: memoryLeaderboard,
  };
}

export function resolveShiftEnvironment(
  requestedId: EnvironmentId,
  unlockedEnvironments: readonly EnvironmentId[]
): EnvironmentId {
  return unlockedEnvironments.includes(requestedId) ? requestedId : 'alleyway';
}

export function getCachedPlayerProfile(): PlayerProfile {
  if (memoryProfile) return memoryProfile;
  const raw = readStorageItem(PROFILE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      memoryProfile = normalizeProfile(parsed);
      return memoryProfile;
    } catch {
      // Ignore corrupt cached JSON
    }
  }
  return DEFAULT_PROFILE;
}

export function getCachedLeaderboard(): LeaderboardResponse {
  return memoryLeaderboard;
}

export function resetShiftClientStateForTests(): void {
  memoryToken = null;
  memoryProfile = null;
  memoryLeaderboard = EMPTY_LEADERBOARD;
  memoryPendingShifts = null;
  activeFlushPromise = null;
  removeStorageItem(TOKEN_STORAGE_KEY);
  removeStorageItem(PROFILE_STORAGE_KEY);
  removeStorageItem(PENDING_SHIFTS_STORAGE_KEY);
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchLeaderboard(fetchImpl: FetchLike): Promise<LeaderboardResponse> {
  try {
    const res = await fetchImpl('/api/v1/leaderboard', { method: 'GET' });
    if (res.ok) {
      const data = (await res.json()) as LeaderboardResponse;
      memoryLeaderboard = data;
      return data;
    }
  } catch {
    // Return cached leaderboard when unreachable
  }
  return memoryLeaderboard;
}

async function ensureAuthenticatedPlayer(
  fetchImpl: FetchLike,
  options: { preserveOptimisticIfPending?: boolean } = {}
): Promise<{ token: string | null; profile: PlayerProfile; reachable: boolean }> {
  const existingToken = getStoredToken();
  const hasPending = readPendingShiftsFromStorage().length > 0;

  if (existingToken) {
    if (options.preserveOptimisticIfPending && hasPending) {
      return { token: existingToken, profile: getCachedPlayerProfile(), reachable: true };
    }
    try {
      const meRes = await fetchImpl('/api/v1/players/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${existingToken}` },
      });
      if (meRes.ok) {
        const raw = (await meRes.json()) as Record<string, unknown>;
        const profile = normalizeProfile(raw);
        if (!hasPending) {
          setCachedProfile(profile);
        }
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
    const createRes = await fetchImpl('/api/v1/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'web' satisfies PlatformId }),
    });
    if (createRes.ok) {
      const raw = (await createRes.json()) as Record<string, unknown>;
      const token = typeof raw.playerToken === 'string' ? raw.playerToken : getStoredToken();
      if (token) setStoredToken(token);
      const profile = normalizeProfile(raw);
      if (!hasPending) {
        setCachedProfile(profile);
      }
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
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    const queue = [...readPendingShiftsFromStorage()];
    if (queue.length === 0) {
      return {
        flushedCount: 0,
        remainingCount: 0,
        profile: getCachedPlayerProfile(),
        leaderboard: memoryLeaderboard,
      };
    }

    let auth = await ensureAuthenticatedPlayer(fetchImpl, { preserveOptimisticIfPending: true });
    if (!auth.token || !auth.reachable) {
      return {
        flushedCount: 0,
        remainingCount: queue.length,
        profile: getCachedPlayerProfile(),
        leaderboard: memoryLeaderboard,
      };
    }

    let flushedCount = 0;
    let droppedCount = 0;
    let latestProfile = auth.profile;

    while (queue.length > 0) {
      const item = queue[0];
      try {
        const res = await fetchImpl('/api/v1/shifts/finish', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
          },
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
          if (data.leaderboard) {
            memoryLeaderboard = data.leaderboard as LeaderboardResponse;
          }
          queue.shift();
          writePendingShiftsToStorage(queue);
          if (queue.length === 0) {
            setCachedProfile(latestProfile);
          }
          flushedCount += 1;
          continue;
        }

        if (res.status === 401) {
          clearStoredToken();
          auth = await ensureAuthenticatedPlayer(fetchImpl, { preserveOptimisticIfPending: true });
          if (!auth.token || !auth.reachable) {
            break;
          }
          continue;
        }

        if (res.status === 400) {
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
      flushedCount,
      remainingCount: queue.length,
      profile: getCachedPlayerProfile(),
      leaderboard: memoryLeaderboard,
    };
  })().finally(() => {
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}

export async function bootstrapPlayerSession(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ profile: PlayerProfile; leaderboard: LeaderboardResponse }> {
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

export async function updatePlayerCallsign(
  callsign: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<PlayerProfile> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token) {
    throw new Error('Player session is not authenticated');
  }

  const res = await fetchImpl('/api/v1/players/me', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ callsign }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update callsign');
  }

  const updated = normalizeProfile({ ...currentProfile, ...data });
  setCachedProfile(updated);
  return updated;
}

export async function startShiftSession(
  params: { environmentId: EnvironmentId },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<StartedShiftSession | null> {
  if (readPendingShiftsFromStorage().length > 0) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount > 0) {
      return null;
    }
  }

  const { token, profile, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) return null;

  const effectiveEnvironmentId = resolveShiftEnvironment(
    params.environmentId,
    profile.unlockedEnvironments
  );

  try {
    const res = await fetchImpl('/api/v1/shifts/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        environmentId: effectiveEnvironmentId,
        platform: profile.platform,
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
  },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<ShiftFinishResult> {
  const shiftId = params.shiftId ?? globalThis.crypto.randomUUID();
  const startedAt = resolveStartedAtUnix(params.startedAt);

  // Deduplicate if this exact shiftId is already in the local pending queue
  if (readPendingShiftsFromStorage().some(item => item.shiftId === shiftId)) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount === 0) {
      const replay = verifyShiftReplay(params.pressOffsetsMs);
      return {
        shiftId,
        verified: replay.ok,
        queued: false,
        smoked: replay.ok ? replay.smoked : 0,
        progress: replay.ok ? replay.progress : 0,
        tapCount: replay.ok ? replay.tapCount : params.pressOffsetsMs.length,
        durationMs: replay.ok ? replay.durationMs : 0,
        newlyUnlockedEnvironments: [],
        profile: flushed.profile,
        leaderboard: flushed.leaderboard,
      };
    }
    return enqueueOfflineShift({
      shiftId,
      requestedEnvironmentId: params.environmentId,
      pressOffsetsMs: params.pressOffsetsMs,
      startedAt,
      baseProfile: getCachedPlayerProfile(),
    });
  }

  // Replay any previously queued offline shifts in FIFO order before submitting the current shift
  if (readPendingShiftsFromStorage().length > 0) {
    const flushed = await flushPendingShifts(fetchImpl);
    if (flushed.remainingCount > 0) {
      return enqueueOfflineShift({
        shiftId,
        requestedEnvironmentId: params.environmentId,
        pressOffsetsMs: params.pressOffsetsMs,
        startedAt,
        baseProfile: getCachedPlayerProfile(),
      });
    }
  }

  const { token, profile: currentProfile, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  const unlockedBefore = currentProfile.unlockedEnvironments;
  const effectiveEnvironmentId = resolveShiftEnvironment(params.environmentId, unlockedBefore);

  if (token && reachable) {
    try {
      const payload: Record<string, unknown> = {
        environmentId: effectiveEnvironmentId,
        pressOffsetsMs: [...params.pressOffsetsMs],
        platform: currentProfile.platform,
      };
      if (params.shiftId) {
        payload.shiftId = params.shiftId;
      }
      if (params.startedAt !== undefined) {
        payload.startedAt = startedAt;
      }

      const res = await fetchImpl('/api/v1/shifts/finish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const updatedProfile = normalizeProfile(
          (data.profile as Record<string, unknown>) ?? currentProfile
        );
        setCachedProfile(updatedProfile);
        const leaderboard = (data.leaderboard as LeaderboardResponse) ?? memoryLeaderboard;
        memoryLeaderboard = leaderboard;
        const newlyUnlocked = Array.isArray(data.newlyUnlockedEnvironments)
          ? (data.newlyUnlockedEnvironments as EnvironmentId[])
          : updatedProfile.unlockedEnvironments.filter(id => !unlockedBefore.includes(id));

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
        };
      }

      if (res.status === 400) {
        return createRejectedShiftResult(shiftId, params.pressOffsetsMs.length, currentProfile);
      }
    } catch {
      // Fall through to offline queue persistence below
    }
  }

  return enqueueOfflineShift({
    shiftId,
    requestedEnvironmentId: params.environmentId,
    pressOffsetsMs: params.pressOffsetsMs,
    startedAt,
    baseProfile: currentProfile,
  });
}
