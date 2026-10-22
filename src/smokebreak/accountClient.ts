// Account management, password/OAuth sign-in, session sign-out, account deletion, and taglines CMS client.

import { getPlatform } from '../platform';
import { type OperatorAvatarConfig } from './OperatorAvatar';
import { bootstrapPlayerSession, ensureAuthenticatedPlayer } from './shiftClient';
import {
  clearClientSessionStorage,
  getCachedPlayerProfile,
  getStoredToken,
  hydrateNativeStorage,
  normalizeProfile,
  resolveApiPath,
  setCachedLeaderboard,
  setCachedProfile,
  setStoredToken,
  type FetchLike,
  type LeaderboardResponse,
  type PlayerProfile,
  type TaglineCadence,
  type TaglineCollection,
  type TaglineItem,
} from './shiftStorage';

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = (await res.json()) as unknown;
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Failed to update callsign (HTTP ${res.status})`
    );
  }

  const updated = normalizeProfile({ ...currentProfile, ...data });
  setCachedProfile(updated);
  return updated;
}

export async function updatePlayerAvatarConfig(
  avatarConfig: OperatorAvatarConfig | null,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<PlayerProfile> {
  const { token, profile: currentProfile, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (token && reachable) {
    try {
      const res = await fetchImpl(resolveApiPath('/api/v1/players/me'), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ avatarConfig }),
      });

      const data = await parseJsonSafe(res);
      if (res.ok) {
        const updated = normalizeProfile({ ...currentProfile, ...data });
        setCachedProfile(updated);
        return updated;
      }
    } catch {
      // Fall back to local cached profile update when offline
    }
  }

  const localUpdated = normalizeProfile({ ...currentProfile, avatarConfig });
  setCachedProfile(localUpdated);
  return localUpdated;
}

export async function loginWithPassword(
  callsign: string,
  password: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  mode: 'login' | 'register' = 'login'
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
      mode,
      platform: getPlatform(),
    }),
  });

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Failed to sign in (HTTP ${res.status})`
    );
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

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `OAuth sign-in failed (HTTP ${res.status})`
    );
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
  clearClientSessionStorage();

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

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Failed to delete account (HTTP ${res.status})`
    );
  }

  const deletedCallsign =
    typeof data.callsign === 'string' ? data.callsign : currentProfile.callsign;
  if (data.leaderboard) {
    setCachedLeaderboard(data.leaderboard as LeaderboardResponse);
  }

  clearClientSessionStorage();

  const { profile, leaderboard } = await bootstrapPlayerSession(fetchImpl);
  return { deletedCallsign, profile, leaderboard };
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
    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      return {
        ok: false,
        error: String(payload.error ?? `Admin authorization required (HTTP ${res.status})`),
      };
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
    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      return {
        ok: false,
        error: String(payload.error ?? `Failed to add taglines (HTTP ${res.status})`),
      };
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
    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      return {
        ok: false,
        error: String(payload.error ?? `Failed to update tagline (HTTP ${res.status})`),
      };
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
    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      return {
        ok: false,
        error: String(payload.error ?? `Failed to delete tagline (HTTP ${res.status})`),
      };
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
