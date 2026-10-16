import { type EnvironmentId, getUnlockedEnvironments } from './smokeBreak';

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

export interface ShiftFinishResult {
  shiftId: string;
  verified: boolean;
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
  removeStorageItem(TOKEN_STORAGE_KEY);
  removeStorageItem(PROFILE_STORAGE_KEY);
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

async function ensureAuthenticatedPlayer(fetchImpl: FetchLike): Promise<{ token: string | null; profile: PlayerProfile }> {
  const existingToken = getStoredToken();
  if (existingToken) {
    try {
      const meRes = await fetchImpl('/api/v1/players/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${existingToken}` },
      });
      if (meRes.ok) {
        const raw = (await meRes.json()) as Record<string, unknown>;
        const profile = normalizeProfile(raw);
        setCachedProfile(profile);
        return { token: existingToken, profile };
      }
    } catch {
      return { token: existingToken, profile: getCachedPlayerProfile() };
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
      const token = typeof raw.playerToken === 'string' ? raw.playerToken : existingToken;
      if (token) setStoredToken(token);
      const profile = normalizeProfile(raw);
      setCachedProfile(profile);
      return { token: token ?? null, profile };
    }
  } catch {
    // Fallback to cached/default profile when unreachable
  }

  return { token: existingToken, profile: getCachedPlayerProfile() };
}

export async function bootstrapPlayerSession(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<{ profile: PlayerProfile; leaderboard: LeaderboardResponse }> {
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
  const { token, profile } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token) return null;

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
  params: { shiftId?: string; environmentId: EnvironmentId; pressOffsetsMs: readonly number[] },
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<ShiftFinishResult> {
  const { token, profile: currentProfile } = await ensureAuthenticatedPlayer(fetchImpl);
  const unlockedBefore = currentProfile.unlockedEnvironments;
  const effectiveEnvironmentId = resolveShiftEnvironment(params.environmentId, unlockedBefore);

  if (token) {
    try {
      const payload: Record<string, unknown> = {
        environmentId: effectiveEnvironmentId,
        pressOffsetsMs: [...params.pressOffsetsMs],
        platform: currentProfile.platform,
      };
      if (params.shiftId) {
        payload.shiftId = params.shiftId;
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
          shiftId: String(data.shiftId ?? params.shiftId ?? 'verified-shift'),
          verified: Boolean(data.verified ?? true),
          smoked: Number(data.smoked ?? 0),
          progress: Number(data.progress ?? 0),
          tapCount: Number(data.tapCount ?? params.pressOffsetsMs.length),
          durationMs: Number(data.durationMs ?? 0),
          newlyUnlockedEnvironments: newlyUnlocked,
          profile: updatedProfile,
          leaderboard,
        };
      }
    } catch {
      // Unreachable network handled in Ticket 04 offline queue
    }
  }

  return {
    shiftId: params.shiftId ?? 'unverified-shift',
    verified: false,
    smoked: 0,
    progress: 0,
    tapCount: params.pressOffsetsMs.length,
    durationMs: 0,
    newlyUnlockedEnvironments: [],
    profile: currentProfile,
    leaderboard: memoryLeaderboard,
  };
}
