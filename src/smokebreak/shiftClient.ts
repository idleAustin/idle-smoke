import { normalizeStartedAtUnix, verifyShiftReplay } from '../../server/shiftVerifier.js';
import { getPlatform, type PlatformId } from '../platform';
import { platformStorage } from '../platform/storage';
import {
  type EnvironmentId,
  getUnlockedEnvironments,
  projectShiftProgression,
} from './smokeBreak';

export type AuthProviderId = 'apple' | 'google' | 'password' | 'guest';

export type TaglineCadence = '60s' | '5m' | '15m' | '1h' | 'daily' | 'per_shift';

export interface TaglineItem {
  id: number;
  jokeText: string;
  isActive: boolean;
  createdAt: number;
}

export interface TaglineCollection {
  cadence: TaglineCadence;
  taglines: TaglineItem[];
}

export interface PlayerProfile {
  playerId: string;
  callsign: string;
  platform: PlatformId;
  lifetimeSmoked: number;
  bestSmoked: number;
  shiftsCompleted: number;
  unlockedEnvironments: EnvironmentId[];
  authProvider?: AuthProviderId;
  authEmail?: string;
  isAdmin?: boolean;
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

function parsePendingShiftsJson(raw: string): PendingShift[] | null {
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
      return valid;
    }
  } catch {
    // Ignore corrupt pending queue JSON
  }
  return null;
}

async function hydrateNativeStorage(): Promise<void> {
  const [token, profile, pending] = await Promise.all([
    platformStorage.get(TOKEN_STORAGE_KEY),
    platformStorage.get(PROFILE_STORAGE_KEY),
    platformStorage.get(PENDING_SHIFTS_STORAGE_KEY),
  ]);
  if (token && !memoryToken) {
    memoryToken = token;
  }
  if (profile && !memoryProfile) {
    try {
      memoryProfile = normalizeProfile(JSON.parse(profile) as Record<string, unknown>);
    } catch {
      // Ignore corrupt profile JSON
    }
  }
  if (pending && (memoryPendingShifts === null || memoryPendingShifts.length === 0)) {
    const parsed = parsePendingShiftsJson(pending);
    if (parsed !== null) {
      memoryPendingShifts = parsed;
    }
  }
}

function getStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  const fromStorage = platformStorage.getSync(TOKEN_STORAGE_KEY);
  if (fromStorage) {
    memoryToken = fromStorage;
    return fromStorage;
  }
  return null;
}

function setStoredToken(token: string): void {
  memoryToken = token;
  platformStorage.setSync(TOKEN_STORAGE_KEY, token);
}

function clearStoredToken(): void {
  memoryToken = null;
  platformStorage.removeSync(TOKEN_STORAGE_KEY);
}

function normalizePlatformId(value: unknown): PlatformId {
  return value === 'ios' || value === 'android' ? value : getPlatform();
}

function normalizeProfile(raw: Record<string, unknown>): PlayerProfile {
  const lifetimeSmoked = Number(raw.lifetimeSmoked ?? 0);
  const unlockedRaw = Array.isArray(raw.unlockedEnvironments)
    ? (raw.unlockedEnvironments as EnvironmentId[])
    : getUnlockedEnvironments(lifetimeSmoked);
  const providerRaw = raw.authProvider;
  const authProvider: AuthProviderId | undefined =
    providerRaw === 'apple' || providerRaw === 'google' || providerRaw === 'password'
      ? providerRaw
      : undefined;
  const authEmail =
    typeof raw.authEmail === 'string' && raw.authEmail.length > 0 ? raw.authEmail : undefined;
  const isAdmin = raw.isAdmin === true;
  return {
    playerId: String(raw.playerId ?? DEFAULT_PROFILE.playerId),
    callsign: String(raw.callsign ?? DEFAULT_PROFILE.callsign),
    platform: normalizePlatformId(raw.platform),
    lifetimeSmoked,
    bestSmoked: Number(raw.bestSmoked ?? 0),
    shiftsCompleted: Number(raw.shiftsCompleted ?? 0),
    unlockedEnvironments: unlockedRaw.length > 0 ? unlockedRaw : ['alleyway'],
    ...(authProvider ? { authProvider } : {}),
    ...(authEmail ? { authEmail } : {}),
    ...(isAdmin ? { isAdmin: true } : {}),
  };
}

function setCachedProfile(profile: PlayerProfile): void {
  memoryProfile = profile;
  platformStorage.setSync(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function resolveStartedAtUnix(value: unknown): number {
  const result = normalizeStartedAtUnix(value);
  return result.ok ? result.startedAt : Math.floor(Date.now() / 1000);
}

function readPendingShiftsFromStorage(): PendingShift[] {
  if (memoryPendingShifts !== null) {
    return memoryPendingShifts;
  }
  const raw = platformStorage.getSync(PENDING_SHIFTS_STORAGE_KEY);
  if (raw) {
    const parsed = parsePendingShiftsJson(raw);
    if (parsed !== null) {
      memoryPendingShifts = parsed;
      return parsed;
    }
  }
  memoryPendingShifts = [];
  return memoryPendingShifts;
}

function writePendingShiftsToStorage(queue: PendingShift[]): void {
  memoryPendingShifts = queue;
  platformStorage.setSync(PENDING_SHIFTS_STORAGE_KEY, JSON.stringify(queue));
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
  const raw = platformStorage.getSync(PROFILE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      memoryProfile = normalizeProfile(parsed);
      return memoryProfile;
    } catch {
      // Ignore corrupt cached JSON
    }
  }
  return { ...DEFAULT_PROFILE, platform: getPlatform() };
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
  platformStorage.removeSync(TOKEN_STORAGE_KEY);
  platformStorage.removeSync(PROFILE_STORAGE_KEY);
  platformStorage.removeSync(PENDING_SHIFTS_STORAGE_KEY);
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function resolveApiPath(apiPath: string): string {
  const rawBase =
    typeof import.meta !== 'undefined' && typeof import.meta.env?.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (!normalizedBase || normalizedBase === '/' || normalizedBase.startsWith('capacitor://')) {
    return normalizedPath;
  }
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchLeaderboard(fetchImpl: FetchLike): Promise<LeaderboardResponse> {
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/leaderboard'), { method: 'GET' });
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
    await hydrateNativeStorage();
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
        const res = await fetchImpl(resolveApiPath('/api/v1/shifts/finish'), {
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

export async function updatePlayerCallsign(
  callsign: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<PlayerProfile> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token) {
    throw new Error('Player session is not authenticated');
  }

  const res = await fetchImpl(resolveApiPath('/api/v1/players/me'), {
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

export async function loginWithPassword(
  callsign: string,
  password: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<PlayerProfile> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchImpl(resolveApiPath('/api/v1/auth/login'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      callsign,
      password,
      platform: getPlatform(),
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to sign in');
  }

  if (typeof data.playerToken === 'string' && data.playerToken.length > 0) {
    setStoredToken(data.playerToken);
  }
  const updated = normalizeProfile({ ...currentProfile, ...data });
  setCachedProfile(updated);
  return updated;
}

export async function loginWithOAuth(
  params: {
    provider: 'apple' | 'google';
    idToken: string;
    callsign?: string;
  },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<PlayerProfile> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchImpl(resolveApiPath('/api/v1/auth/oauth'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider: params.provider,
      idToken: params.idToken,
      ...(params.callsign ? { callsign: params.callsign } : {}),
      platform: getPlatform(),
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'OAuth sign-in failed');
  }

  if (typeof data.playerToken === 'string' && data.playerToken.length > 0) {
    setStoredToken(data.playerToken);
  }
  const updated = normalizeProfile({ ...currentProfile, ...data });
  setCachedProfile(updated);
  return updated;
}

export async function signOutPlayerSession(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{
  previousCallsign: string;
  profile: PlayerProfile;
  leaderboard: LeaderboardResponse;
}> {
  await hydrateNativeStorage();
  const previousCallsign = getCachedPlayerProfile().callsign;
  clearStoredToken();
  memoryProfile = null;
  memoryPendingShifts = [];
  platformStorage.removeSync(PROFILE_STORAGE_KEY);
  platformStorage.removeSync(PENDING_SHIFTS_STORAGE_KEY);

  const { profile, leaderboard } = await bootstrapPlayerSession(fetchImpl);
  return { previousCallsign, profile, leaderboard };
}

export async function deletePlayerAccount(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{
  deletedCallsign: string;
  profile: PlayerProfile;
  leaderboard: LeaderboardResponse;
}> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token) {
    throw new Error('Player session is not authenticated');
  }

  const res = await fetchImpl(resolveApiPath('/api/v1/players/me'), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to delete account');
  }

  const deletedCallsign =
    typeof data.callsign === 'string' ? data.callsign : currentProfile.callsign;
  if (data.leaderboard) {
    memoryLeaderboard = data.leaderboard as LeaderboardResponse;
  }

  clearStoredToken();
  memoryProfile = null;
  memoryPendingShifts = [];
  platformStorage.removeSync(PROFILE_STORAGE_KEY);
  platformStorage.removeSync(PENDING_SHIFTS_STORAGE_KEY);

  const { profile, leaderboard } = await bootstrapPlayerSession(fetchImpl);
  return { deletedCallsign, profile, leaderboard };
}

export async function startShiftSession(
  params: { environmentId: EnvironmentId },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<StartedShiftSession | null> {
  await hydrateNativeStorage();
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
    const res = await fetchImpl(resolveApiPath('/api/v1/shifts/start'), {
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
  await hydrateNativeStorage();

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

      const res = await fetchImpl(resolveApiPath('/api/v1/shifts/finish'), {
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

export const FALLBACK_TAGLINES: readonly TaglineItem[] = [
  { id: 1, jokeText: "you're always allotted 15 minutes for a smoke break.", isActive: true, createdAt: 0 },
  { id: 2, jokeText: "the productivity metrics are made up and the shift clock doesn't matter.", isActive: true, createdAt: 0 },
  { id: 3, jokeText: 'OSHA is just a four-letter word we mutter by the dumpster.', isActive: true, createdAt: 0 },
  { id: 4, jokeText: "your supervisor still thinks you're looking for a pallet jack.", isActive: true, createdAt: 0 },
  { id: 5, jokeText: 'every drag counts as cardiovascular training on the company health plan.', isActive: true, createdAt: 0 },
  { id: 6, jokeText: 'the cherry burns faster than your quarterly performance review.', isActive: true, createdAt: 0 },
  { id: 7, jokeText: 'second-hand smoke is the only team-building exercise that actually works.', isActive: true, createdAt: 0 },
  { id: 8, jokeText: "the forklift battery isn't the only thing getting smoked behind Bay 4.", isActive: true, createdAt: 0 },
  { id: 9, jokeText: 'HR calls it time theft, but we call it spiritual alignment.', isActive: true, createdAt: 0 },
  { id: 10, jokeText: 'the ashtray has more structural integrity than upper management.', isActive: true, createdAt: 0 },
  { id: 11, jokeText: 'clocking back in is strictly a suggestion, not a lifestyle.', isActive: true, createdAt: 0 },
  { id: 12, jokeText: "the loading dock breeze is the closest thing you'll get to PTO.", isActive: true, createdAt: 0 },
];

/**
 * Formats a tagline joke as "Where <joke>" without duplicating a leading "where ".
 */
export function formatWhereTagline(jokeText: string): string {
  const stripped = jokeText.trim().replace(/^where\s+/i, '');
  return `Where ${stripped}`;
}

function buildAdminHeaders(adminPasscode?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (adminPasscode && adminPasscode.trim()) {
    headers['X-Admin-Passcode'] = adminPasscode.trim();
  }
  return headers;
}

export async function fetchActiveTaglines(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<TaglineCollection> {
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/taglines'));
    if (res.ok) {
      const data = (await res.json()) as Partial<TaglineCollection>;
      const taglines = Array.isArray(data.taglines) && data.taglines.length > 0
        ? data.taglines
        : [...FALLBACK_TAGLINES];
      return {
        cadence: data.cadence ?? '60s',
        taglines,
      };
    }
  } catch {
    // Fallback to embedded seed taglines when offline
  }
  return {
    cadence: '60s',
    taglines: [...FALLBACK_TAGLINES],
  };
}

export async function fetchAdminTaglines(
  adminPasscode?: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ ok: true; data: TaglineCollection } | { ok: false; error: string }> {
  await hydrateNativeStorage();
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/admin/taglines'), {
      method: 'GET',
      headers: buildAdminHeaders(adminPasscode),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(payload.error ?? 'Admin authorization required') };
    }
    return {
      ok: true,
      data: {
        cadence: (payload.cadence as TaglineCadence) ?? '60s',
        taglines: Array.isArray(payload.taglines) ? (payload.taglines as TaglineItem[]) : [],
      },
    };
  } catch {
    return { ok: false, error: 'Unable to reach server for Admin Taglines' };
  }
}

export async function addAdminTaglines(
  jokeText: string,
  adminPasscode?: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ ok: true; data: TaglineCollection; addedCount: number } | { ok: false; error: string }> {
  await hydrateNativeStorage();
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/admin/taglines'), {
      method: 'POST',
      headers: buildAdminHeaders(adminPasscode),
      body: JSON.stringify({ jokeText }),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(payload.error ?? 'Failed to add taglines') };
    }
    return {
      ok: true,
      addedCount: Number(payload.addedCount ?? 1),
      data: {
        cadence: (payload.cadence as TaglineCadence) ?? '60s',
        taglines: Array.isArray(payload.taglines) ? (payload.taglines as TaglineItem[]) : [],
      },
    };
  } catch {
    return { ok: false, error: 'Unable to reach server to add taglines' };
  }
}

export async function updateAdminTagline(
  params: { id?: number; jokeText?: string; isActive?: boolean; cadence?: TaglineCadence },
  adminPasscode?: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ ok: true; data: TaglineCollection } | { ok: false; error: string }> {
  await hydrateNativeStorage();
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/admin/taglines'), {
      method: 'PATCH',
      headers: buildAdminHeaders(adminPasscode),
      body: JSON.stringify(params),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(payload.error ?? 'Failed to update tagline') };
    }
    return {
      ok: true,
      data: {
        cadence: (payload.cadence as TaglineCadence) ?? '60s',
        taglines: Array.isArray(payload.taglines) ? (payload.taglines as TaglineItem[]) : [],
      },
    };
  } catch {
    return { ok: false, error: 'Unable to reach server to update tagline' };
  }
}

export async function deleteAdminTagline(
  id: number,
  adminPasscode?: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ ok: true; data: TaglineCollection } | { ok: false; error: string }> {
  await hydrateNativeStorage();
  try {
    const res = await fetchImpl(resolveApiPath('/api/v1/admin/taglines'), {
      method: 'DELETE',
      headers: buildAdminHeaders(adminPasscode),
      body: JSON.stringify({ id }),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(payload.error ?? 'Failed to delete tagline') };
    }
    return {
      ok: true,
      data: {
        cadence: (payload.cadence as TaglineCadence) ?? '60s',
        taglines: Array.isArray(payload.taglines) ? (payload.taglines as TaglineItem[]) : [],
      },
    };
  } catch {
    return { ok: false, error: 'Unable to reach server to delete tagline' };
  }
}
