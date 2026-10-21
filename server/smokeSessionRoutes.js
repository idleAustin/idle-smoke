// Server-authoritative v1 API routes for 2-digit code Smoke Sessions (create, join, poll, and start).
import { authenticatePlayer } from './playerAuthRoutes.js';
import { isValidEnvironmentId } from './shiftVerifier.js';
import { getUnlockedEnvironments } from './starSchema.js';
import { SMOKE_SESSION_TTL_SECONDS } from './storeQueries.js';

const MAX_SESSION_PARTICIPANTS = 16;

/**
 * Picks a random unused 2-digit code ('00'..'99') using Web Crypto.
 * @param {readonly string[]} activeCodes
 * @returns {string | null}
 */
function generateAvailableSessionCode(activeCodes) {
  const used = new Set(activeCodes);
  const available = [];
  for (let i = 0; i < 100; i++) {
    const candidate = String(i).padStart(2, '0');
    if (!used.has(candidate)) {
      available.push(candidate);
    }
  }
  if (available.length === 0) return null;
  const rand = new Uint32Array(1);
  globalThis.crypto.getRandomValues(rand);
  return available[rand[0] % available.length];
}

/**
 * Handles /api/v1/sessions* routes for creating, joining, polling, and starting a Smoke Session.
 * @param {{
 *   method: string,
 *   route: string,
 *   req: { authHeader?: string | null },
 *   body: Record<string, unknown>,
 *   store: ReturnType<typeof import('./sqliteDb.js').createSqliteStore>,
 *   nowUnix: number
 * }} ctx
 * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
 */
export async function handleSmokeSessionRoutes({ method, route, req, body, store, nowUnix }) {
  if (route !== '/api/v1/sessions' && !route.startsWith('/api/v1/sessions/')) {
    return null;
  }

  const playerRow = await authenticatePlayer(req.authHeader, store);
  if (!playerRow) {
    return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
  }
  const playerId = String(playerRow.id);
  const minCreatedAtUnix = Math.max(0, nowUnix - SMOKE_SESSION_TTL_SECONDS);

  if (route === '/api/v1/sessions' && method === 'POST') {
    const requestedEnv = body.environmentId ?? 'alleyway';
    if (!isValidEnvironmentId(requestedEnv)) {
      return { status: 400, body: { error: 'Invalid break environmentId' } };
    }
    const unlocked = getUnlockedEnvironments(Number(playerRow.lifetime_smoked ?? 0));
    if (!unlocked.includes(requestedEnv)) {
      return { status: 400, body: { error: `Environment '${requestedEnv}' is locked` } };
    }

    const activeCodes = await store.getActiveSessionCodes(minCreatedAtUnix);
    const code = generateAvailableSessionCode(activeCodes);
    if (!code) {
      return { status: 503, body: { error: 'All 100 Smoke Session codes are currently in use' } };
    }

    const sessionId = globalThis.crypto.randomUUID();
    const session = await store.createSmokeSession({
      sessionId,
      code,
      hostPlayerId: playerId,
      environmentId: requestedEnv,
      nowUnix,
    });
    return { status: 201, body: { session } };
  }

  if (route === '/api/v1/sessions/join' && method === 'POST') {
    const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\d{2}$/.test(rawCode)) {
      return { status: 400, body: { error: 'Enter a valid 2-digit session code (00–99)' } };
    }

    const existing = await store.getSmokeSessionByCode(rawCode, minCreatedAtUnix);
    if (!existing) {
      return { status: 404, body: { error: `No open Smoke Session found for code ${rawCode}` } };
    }

    const alreadyJoined = existing.participants.some(p => p.playerId === playerId);
    if (existing.status !== 'waiting' && !alreadyJoined) {
      return { status: 400, body: { error: `Smoke Session ${rawCode} has already started` } };
    }
    if (!alreadyJoined && existing.participants.length >= MAX_SESSION_PARTICIPANTS) {
      return { status: 400, body: { error: `Smoke Session ${rawCode} is full` } };
    }

    const session = await store.joinSmokeSession({
      sessionId: existing.sessionId,
      playerId,
      nowUnix,
    });
    return { status: 200, body: { session } };
  }

  const startMatch = route.match(/^\/api\/v1\/sessions\/([^/]+)\/start$/);
  if (startMatch && method === 'POST') {
    const sessionId = decodeURIComponent(startMatch[1]);
    const existing = await store.getSmokeSessionById(sessionId);
    if (!existing) {
      return { status: 404, body: { error: 'Smoke Session not found' } };
    }
    if (existing.hostPlayerId !== playerId) {
      return { status: 403, body: { error: 'Only the session creator can start the Smoke Session' } };
    }
    if (existing.status !== 'waiting') {
      return { status: 200, body: { session: existing } };
    }
    const session = await store.startSmokeSession({
      sessionId,
      hostPlayerId: playerId,
      nowUnix,
    });
    return { status: 200, body: { session } };
  }

  const getMatch = route.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (getMatch && method === 'GET') {
    const target = decodeURIComponent(getMatch[1]);
    const session = /^\d{2}$/.test(target)
      ? await store.getSmokeSessionByCode(target, minCreatedAtUnix)
      : await store.getSmokeSessionById(target);
    if (!session) {
      return { status: 404, body: { error: 'Smoke Session not found' } };
    }
    return { status: 200, body: { session } };
  }

  return null;
}
