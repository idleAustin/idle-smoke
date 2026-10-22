// Client-side types, platform storage hydration, profile/leaderboard caches, and offline shift queue persistence.

import { normalizeStartedAtUnix, verifyShiftReplay } from '../../server/shiftVerifier.js';
import { buildSmokedByEnvironmentMap, parseAvatarConfig } from '../../server/storeQueries.js';
import { getPlatform, type PlatformId } from '../platform';
import { platformStorage } from '../platform/storage';
import { saveAvatarTraits, type OperatorAvatarConfig } from './OperatorAvatar';
import {
  type EnvironmentId,
  getUnlockedEnvironments,
  getUnlockedPhase,
  projectShiftProgression,
} from './smokeBreak';
import { type SmokeSession } from './smokeSessionClient';

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
  smokedByEnvironment: Record<EnvironmentId, number>;
  promotionRoundsCleared: number;
  unlockedPhase: 1 | 2 | 3;
  isChairman: boolean;
  unlockedEnvironments: EnvironmentId[];
  avatarConfig?: OperatorAvatarConfig | null;
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
  avatarConfig?: OperatorAvatarConfig | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  stats: { totalPlayers: number; totalShifts: number; totalSmoked: number };
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
  smokeSession?: SmokeSession | null;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface FlushPendingSummary {
  flushedCount: number;
  remainingCount: number;
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
  smokedByEnvironment: buildSmokedByEnvironmentMap(null) as Record<EnvironmentId, number>,
  promotionRoundsCleared: 0,
  unlockedPhase: 1,
  isChairman: false,
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
let activeFlushPromise: Promise<FlushPendingSummary> | null = null;

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

export async function hydrateNativeStorage(): Promise<void> {
  const [token, profile, pending] = await Promise.all([
    platformStorage.get(TOKEN_STORAGE_KEY),
    platformStorage.get(PROFILE_STORAGE_KEY),
    platformStorage.get(PENDING_SHIFTS_STORAGE_KEY),
  ]);
  if (token && !memoryToken) memoryToken = token;
  if (profile && !memoryProfile) {
    try {
      memoryProfile = normalizeProfile(JSON.parse(profile) as Record<string, unknown>);
    } catch {
      // Ignore corrupt profile JSON
    }
  }
  if (pending && (memoryPendingShifts === null || memoryPendingShifts.length === 0)) {
    const parsed = parsePendingShiftsJson(pending);
    if (parsed !== null) memoryPendingShifts = parsed;
  }
}

export function getStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  const fromStorage = platformStorage.getSync(TOKEN_STORAGE_KEY);
  if (fromStorage) {
    memoryToken = fromStorage;
    return fromStorage;
  }
  return null;
}

export function setStoredToken(token: string): void {
  memoryToken = token;
  platformStorage.setSync(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  memoryToken = null;
  platformStorage.removeSync(TOKEN_STORAGE_KEY);
}

export function clearClientSessionStorage(): void {
  clearStoredToken();
  memoryProfile = null;
  memoryPendingShifts = [];
  platformStorage.removeSync(PROFILE_STORAGE_KEY);
  platformStorage.removeSync(PENDING_SHIFTS_STORAGE_KEY);
}

function normalizePlatformId(value: unknown): PlatformId {
  return value === 'ios' || value === 'android' ? value : getPlatform();
}

function syncProfileAvatarToLocalCache(profile: PlayerProfile): void {
  if (profile.avatarConfig === undefined) return;
  saveAvatarTraits(
    profile.callsign,
    profile.avatarConfig,
    profile.avatarConfig !== null
      ? Boolean(profile.avatarConfig.useAdminScorpion)
      : Boolean(profile.isAdmin)
  );
}

export function normalizeProfile(raw: Record<string, unknown>): PlayerProfile {
  const isAdmin = raw.isAdmin === true;
  const lifetimeSmoked = Number(raw.lifetimeSmoked ?? 0);
  const rawPromo = Number(raw.promotionRoundsCleared ?? raw.promotion_rounds_cleared ?? 0);
  const promotionRoundsCleared = isAdmin
    ? 9
    : Number.isFinite(rawPromo)
      ? Math.max(0, Math.min(9, Math.floor(rawPromo)))
      : 0;
  const rawSmokedByEnv = raw.smokedByEnvironment ?? raw.smoked_by_environment;
  const smokedByEnvironment = buildSmokedByEnvironmentMap(
    rawSmokedByEnv as Record<string, unknown> | undefined,
    lifetimeSmoked
  ) as Record<EnvironmentId, number>;
  const unlockedPhase = isAdmin ? 3 : getUnlockedPhase(promotionRoundsCleared);
  const isChairman = isAdmin || promotionRoundsCleared >= 9;
  const unlockedRaw = isAdmin
    ? (getUnlockedEnvironments({
        smokedByEnvironment,
        promotionRoundsCleared: 9,
        isAdmin: true,
      }) as EnvironmentId[])
    : Array.isArray(raw.unlockedEnvironments)
      ? (raw.unlockedEnvironments as EnvironmentId[])
      : rawSmokedByEnv
        ? (getUnlockedEnvironments({ smokedByEnvironment, promotionRoundsCleared }) as EnvironmentId[])
        : (getUnlockedEnvironments(lifetimeSmoked) as EnvironmentId[]);
  const providerRaw = raw.authProvider;
  const authProvider: AuthProviderId | undefined =
    providerRaw === 'apple' || providerRaw === 'google' || providerRaw === 'password'
      ? providerRaw
      : undefined;
  const authEmail =
    typeof raw.authEmail === 'string' && raw.authEmail.length > 0 ? raw.authEmail : undefined;
  const rawAvatar = raw.avatarConfig !== undefined ? raw.avatarConfig : raw.avatar_config;
  const avatarConfig =
    rawAvatar === undefined
      ? undefined
      : (parseAvatarConfig(rawAvatar, isAdmin) as OperatorAvatarConfig | null);
  return {
    playerId: String(raw.playerId ?? DEFAULT_PROFILE.playerId),
    callsign: String(raw.callsign ?? DEFAULT_PROFILE.callsign),
    platform: normalizePlatformId(raw.platform),
    lifetimeSmoked,
    bestSmoked: Number(raw.bestSmoked ?? 0),
    shiftsCompleted: Number(raw.shiftsCompleted ?? 0),
    smokedByEnvironment,
    promotionRoundsCleared,
    unlockedPhase,
    isChairman,
    unlockedEnvironments: unlockedRaw.length > 0 ? unlockedRaw : ['alleyway'],
    ...(avatarConfig !== undefined ? { avatarConfig } : {}),
    ...(authProvider ? { authProvider } : {}),
    ...(authEmail ? { authEmail } : {}),
    ...(isAdmin ? { isAdmin: true } : {}),
  };
}

export function setCachedProfile(profile: PlayerProfile): void {
  memoryProfile = profile;
  platformStorage.setSync(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  syncProfileAvatarToLocalCache(profile);
}

export function getCachedPlayerProfile(): PlayerProfile {
  if (memoryProfile) return memoryProfile;
  const raw = platformStorage.getSync(PROFILE_STORAGE_KEY);
  if (raw) {
    try {
      memoryProfile = normalizeProfile(JSON.parse(raw) as Record<string, unknown>);
      syncProfileAvatarToLocalCache(memoryProfile);
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

export function setCachedLeaderboard(leaderboard: LeaderboardResponse): void {
  memoryLeaderboard = {
    ...leaderboard,
    entries: Array.isArray(leaderboard.entries)
      ? leaderboard.entries.map(entry => ({
          ...entry,
          avatarConfig:
            entry.avatarConfig !== undefined
              ? (parseAvatarConfig(entry.avatarConfig) as OperatorAvatarConfig | null)
              : null,
        }))
      : [],
  };
}

export function getActiveFlushPromise(): Promise<FlushPendingSummary> | null {
  return activeFlushPromise;
}

export function setActiveFlushPromise(promise: Promise<FlushPendingSummary> | null): void {
  activeFlushPromise = promise;
}

export function resolveStartedAtUnix(value: unknown): number {
  const result = normalizeStartedAtUnix(value);
  return result.ok ? result.startedAt : Math.floor(Date.now() / 1000);
}

export function readPendingShiftsFromStorage(): PendingShift[] {
  if (memoryPendingShifts !== null) return memoryPendingShifts;
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

export function writePendingShiftsToStorage(queue: PendingShift[]): void {
  memoryPendingShifts = queue;
  platformStorage.setSync(PENDING_SHIFTS_STORAGE_KEY, JSON.stringify(queue));
}

export function getPendingShifts(): PendingShift[] {
  return readPendingShiftsFromStorage().map(item => ({
    ...item,
    pressOffsetsMs: [...item.pressOffsetsMs],
  }));
}

export function createRejectedShiftResult(
  shiftId: string,
  tapCount: number,
  profile: PlayerProfile
): ShiftFinishResult {
  return {
    shiftId, verified: false, queued: false, smoked: 0, progress: 0,
    tapCount, durationMs: 0, newlyUnlockedEnvironments: [],
    profile, leaderboard: memoryLeaderboard,
  };
}

export function enqueueOfflineShift(params: {
  shiftId: string;
  requestedEnvironmentId: EnvironmentId;
  pressOffsetsMs: readonly number[];
  startedAt: number;
  baseProfile: PlayerProfile;
}): ShiftFinishResult {
  const replay = verifyShiftReplay(params.pressOffsetsMs);
  if (!replay.ok) {
    return createRejectedShiftResult(params.shiftId, params.pressOffsetsMs.length, params.baseProfile);
  }

  const effectiveEnvironmentId = resolveShiftEnvironment(
    params.requestedEnvironmentId,
    params.baseProfile.unlockedEnvironments
  );
  const queue = readPendingShiftsFromStorage();
  if (queue.some(item => item.shiftId === params.shiftId)) {
    return {
      shiftId: params.shiftId, verified: false, queued: true,
      smoked: replay.smoked, progress: replay.progress,
      tapCount: replay.tapCount, durationMs: replay.durationMs,
      newlyUnlockedEnvironments: [], profile: getCachedPlayerProfile(),
      leaderboard: memoryLeaderboard,
    };
  }

  writePendingShiftsToStorage([
    ...queue,
    {
      shiftId: params.shiftId,
      environmentId: effectiveEnvironmentId,
      pressOffsetsMs: [...params.pressOffsetsMs],
      startedAt: params.startedAt,
    },
  ]);

  const projected = projectShiftProgression(
    params.baseProfile.lifetimeSmoked,
    params.baseProfile.bestSmoked,
    params.baseProfile.unlockedEnvironments,
    replay.smoked,
    {
      environmentId: effectiveEnvironmentId,
      smokedByEnvironment: params.baseProfile.smokedByEnvironment,
      promotionRoundsCleared: params.baseProfile.promotionRoundsCleared,
      isAdmin: params.baseProfile.isAdmin,
    }
  );
  const optimisticProfile: PlayerProfile = {
    ...params.baseProfile,
    lifetimeSmoked: projected.lifetimeSmoked,
    bestSmoked: projected.bestSmoked,
    shiftsCompleted: params.baseProfile.shiftsCompleted + 1,
    smokedByEnvironment: projected.smokedByEnvironment ?? params.baseProfile.smokedByEnvironment,
    promotionRoundsCleared:
      projected.promotionRoundsCleared ?? params.baseProfile.promotionRoundsCleared,
    unlockedPhase: projected.unlockedPhase ?? params.baseProfile.unlockedPhase,
    isChairman: projected.isChairman ?? params.baseProfile.isChairman,
    unlockedEnvironments: projected.unlockedEnvironments,
  };
  setCachedProfile(optimisticProfile);

  return {
    shiftId: params.shiftId, verified: false, queued: true,
    smoked: replay.smoked, progress: replay.progress,
    tapCount: replay.tapCount, durationMs: replay.durationMs,
    newlyUnlockedEnvironments: projected.newlyUnlockedEnvironments,
    profile: optimisticProfile, leaderboard: memoryLeaderboard,
  };
}

export function resolveShiftEnvironment(
  requestedId: EnvironmentId,
  unlockedEnvironments: readonly EnvironmentId[]
): EnvironmentId {
  return unlockedEnvironments.includes(requestedId) ? requestedId : 'alleyway';
}

export function resolveApiPath(apiPath: string): string {
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
