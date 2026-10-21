// Client API helpers and normalizers for 2-digit code Smoke Sessions (create, join, poll, and start).

import { ensureAuthenticatedPlayer } from './shiftClient';
import { resolveApiPath, type FetchLike } from './shiftStorage';
import { type EnvironmentId } from './smokeBreak';

type SmokeSessionStatus = 'waiting' | 'active' | 'completed';

interface SmokeSessionParticipant {
  rank: number;
  playerId: string;
  callsign: string;
  isHost: boolean;
  joinedAt: number;
  finished: boolean;
  smoked: number | null;
  tapCount: number | null;
  durationMs: number | null;
  completedAt: number | null;
}

export interface SmokeSession {
  sessionId: string;
  code: string;
  hostPlayerId: string;
  environmentId: EnvironmentId;
  status: SmokeSessionStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  participants: SmokeSessionParticipant[];
}

export function normalizeSmokeSession(raw: unknown): SmokeSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== 'string' || typeof r.code !== 'string') return null;
  const rawParticipants = Array.isArray(r.participants) ? r.participants : [];
  const participants: SmokeSessionParticipant[] = rawParticipants
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .map((p, idx) => ({
      rank: Number(p.rank ?? idx + 1),
      playerId: String(p.playerId ?? ''),
      callsign: String(p.callsign ?? 'CREW'),
      isHost: Boolean(p.isHost),
      joinedAt: Number(p.joinedAt ?? 0),
      finished: Boolean(p.finished),
      smoked: p.smoked !== null && p.smoked !== undefined ? Number(p.smoked) : null,
      tapCount: p.tapCount !== null && p.tapCount !== undefined ? Number(p.tapCount) : null,
      durationMs: p.durationMs !== null && p.durationMs !== undefined ? Number(p.durationMs) : null,
      completedAt: p.completedAt !== null && p.completedAt !== undefined ? Number(p.completedAt) : null,
    }));

  const statusRaw = r.status;
  const status: SmokeSessionStatus =
    statusRaw === 'active' || statusRaw === 'completed' ? statusRaw : 'waiting';

  return {
    sessionId: r.sessionId,
    code: r.code,
    hostPlayerId: String(r.hostPlayerId ?? ''),
    environmentId: (r.environmentId as EnvironmentId) ?? 'alleyway',
    status,
    createdAt: Number(r.createdAt ?? 0),
    startedAt: r.startedAt !== null && r.startedAt !== undefined ? Number(r.startedAt) : null,
    completedAt: r.completedAt !== null && r.completedAt !== undefined ? Number(r.completedAt) : null,
    participants,
  };
}

export async function createSmokeSession(
  environmentId: EnvironmentId,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<SmokeSession> {
  const { token, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) {
    throw new Error('Must be online to host a Smoke Session.');
  }
  const res = await fetchImpl(resolveApiPath('/api/v1/sessions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to start Smoke Session');
  }
  const session = normalizeSmokeSession(data.session);
  if (!session) throw new Error('Invalid Smoke Session response');
  return session;
}

export async function joinSmokeSessionByCode(
  code: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<SmokeSession> {
  const normalizedCode = code.trim();
  if (!/^\d{2}$/.test(normalizedCode)) {
    throw new Error('Enter a valid 2-digit session code (00–99).');
  }
  const { token, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) {
    throw new Error('Must be online to join a Smoke Session.');
  }
  const res = await fetchImpl(resolveApiPath('/api/v1/sessions/join'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: normalizedCode }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Could not join Smoke Session');
  }
  const session = normalizeSmokeSession(data.session);
  if (!session) throw new Error('Invalid Smoke Session response');
  return session;
}

export async function fetchSmokeSession(
  idOrCode: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<SmokeSession | null> {
  const { token, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) return null;
  try {
    const res = await fetchImpl(
      resolveApiPath(`/api/v1/sessions/${encodeURIComponent(idOrCode)}`),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return normalizeSmokeSession(data.session);
  } catch {
    return null;
  }
}

export async function startSmokeSessionById(
  sessionId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<SmokeSession> {
  const { token, reachable } = await ensureAuthenticatedPlayer(fetchImpl);
  if (!token || !reachable) {
    throw new Error('Must be online to start the Smoke Session.');
  }
  const res = await fetchImpl(
    resolveApiPath(`/api/v1/sessions/${encodeURIComponent(sessionId)}/start`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to start Smoke Session');
  }
  const session = normalizeSmokeSession(data.session);
  if (!session) throw new Error('Invalid Smoke Session response');
  return session;
}
