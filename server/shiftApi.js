// Server-authoritative v1 API router for leaderboard, taglines CMS, and shift start/finish verification.
import { authenticateAdmin, authenticatePlayer, handlePlayerAndAuthRoutes } from './playerAuthRoutes.js';
import {
  MAX_BODY_BYTES,
  checkRateLimit,
  hasTamperedScoreFields,
  isValidEnvironmentId,
  normalizePlatform,
  normalizeStartedAtUnix,
  verifyShiftReplay,
} from './shiftVerifier.js';
import { handleSmokeSessionRoutes } from './smokeSessionRoutes.js';
import {
  VALID_TAGLINE_CADENCES,
  evaluatePromotionAttempt,
} from './starSchema.js';
import { formatPlayerProfile } from './storeQueries.js';

/**
 * Normalizes subpath-prefixed API paths (/idle-smoke/api/v1/* or /idle-smoke-break/api/v1/*) to /api/v1/*.
 * @param {string} pathname
 */
function normalizeApiPathname(pathname) {
  const stripped = pathname.replace(/^\/idle-smoke(?:-break)?(?=\/api\/)/, '');
  return stripped.length > 1 ? stripped.replace(/\/+$/, '') : stripped;
}

/**
 * @param {string} pathname
 */
export function isApiPathname(pathname) {
  const normalized = normalizeApiPathname(pathname);
  return normalized === '/api/v1' || normalized.startsWith('/api/v1/');
}

/**
 * @param {string | undefined} rawBody
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }}
 */
function parseJsonObjectBody(rawBody) {
  if (rawBody === undefined || rawBody.trim() === '') {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Request body must be a JSON object' };
    }
    return { ok: true, value: /** @type {Record<string, unknown>} */ (parsed) };
  } catch {
    return { ok: false, error: 'Malformed JSON request body' };
  }
}

/**
 * Parses single or bulk newline-separated joke strings from POST /api/v1/admin/taglines.
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, jokes: string[] } | { ok: false, error: string }}
 */
function normalizeJokeCandidates(body) {
  const rawLines = [];
  if (typeof body.jokeText === 'string') {
    rawLines.push(...body.jokeText.split(/\r?\n/));
  }
  if (Array.isArray(body.jokes)) {
    for (const item of body.jokes) {
      if (typeof item === 'string') rawLines.push(...item.split(/\r?\n/));
    }
  }

  const cleaned = [];
  const seen = new Set();
  for (const line of rawLines) {
    const stripped = line
      .trim()
      .replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, '')
      .replace(/^["“]|["”]$/g, '')
      .trim();
    if (!stripped) continue;
    if (stripped.length < 3 || stripped.length > 280) {
      return {
        ok: false,
        error: `Each tagline must be between 3 and 280 characters (got ${stripped.length} chars)`,
      };
    }
    if (!seen.has(stripped)) {
      seen.add(stripped);
      cleaned.push(stripped);
    }
  }

  if (cleaned.length === 0) {
    return { ok: false, error: 'Provide at least one tagline (3–280 characters)' };
  }
  if (cleaned.length > 250) {
    return { ok: false, error: 'Maximum 250 taglines per batch import' };
  }
  return { ok: true, jokes: cleaned };
}

/**
 * Shared authentication, environment unlock check, and platform validation for /shifts/start and /shifts/finish.
 * @param {string | null | undefined} authHeader
 * @param {Record<string, unknown>} body
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 */
async function authenticateAndValidateShiftContext(authHeader, body, store) {
  const playerRow = await authenticatePlayer(authHeader, store);
  if (!playerRow) {
    return { ok: false, status: 401, error: 'Valid Bearer playerToken required' };
  }

  let smokeSession = null;
  if (body.sessionId !== undefined && body.sessionId !== null) {
    if (typeof body.sessionId !== 'string' || body.sessionId.trim().length === 0) {
      return { ok: false, status: 400, error: 'Invalid sessionId' };
    }
    smokeSession = await store.getSmokeSessionById(body.sessionId.trim());
    if (!smokeSession || !smokeSession.participants.some(p => p.playerId === String(playerRow.id))) {
      return { ok: false, status: 400, error: 'Invalid or unjoined Smoke Session' };
    }
  }

  const environmentId = smokeSession ? smokeSession.environmentId : body.environmentId;
  if (!isValidEnvironmentId(environmentId)) {
    return { ok: false, status: 400, error: 'Invalid break environmentId' };
  }

  const currentProfile = formatPlayerProfile(playerRow);
  const unlocked = currentProfile.unlockedEnvironments;
  if (!smokeSession && !unlocked.includes(environmentId)) {
    return {
      ok: false,
      status: 403,
      error: `environment_locked: Environment '${environmentId}' is locked`,
    };
  }

  const platformResult = normalizePlatform(body.platform ?? playerRow.platform);
  if (!platformResult.ok) {
    return { ok: false, status: 400, error: platformResult.error };
  }

  return {
    ok: true,
    playerRow,
    currentProfile,
    environmentId,
    platform: platformResult.platform,
    previousUnlocked: unlocked,
    smokeSession,
  };
}

/**
 * Shared server-authoritative API handler used by both Express (server/index.js) and Cloudflare Workers (server/worker.js).
 * @param {{ method: string, pathname: string, authHeader?: string | null, adminPasscode?: string | null, rawBody?: string, contentLength?: number | string | null, clientIp?: string | null }} req
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 * @param {{ nowUnix?: number, jwksFetch?: typeof fetch, env?: Record<string, unknown> }} [options]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function handleApiRequest(req, store, options = {}) {
  const method = req.method.toUpperCase();
  const route = normalizeApiPathname(req.pathname);
  const nowUnix = options.nowUnix ?? Math.floor(Date.now() / 1000);
  const rawAdminEmails = String(
    options.env?.ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? ''
  );

  if (!checkRateLimit(req.clientIp, nowUnix * 1000)) {
    return { status: 429, body: { error: 'Rate limit exceeded' } };
  }

  if (req.contentLength !== undefined && req.contentLength !== null) {
    const declaredBytes = Number(req.contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return { status: 400, body: { error: 'Payload exceeds 16kb limit' } };
    }
  }

  if (typeof req.rawBody === 'string') {
    const bodyBytes = new TextEncoder().encode(req.rawBody).byteLength;
    if (bodyBytes > MAX_BODY_BYTES) {
      return { status: 400, body: { error: 'Payload exceeds 16kb limit' } };
    }
  }

  if (route === '/api/v1/leaderboard' && method === 'GET') {
    const leaderboard = await store.getLeaderboard();
    return { status: 200, body: leaderboard };
  }

  if (route === '/api/v1/taglines' && method === 'GET') {
    const data = await store.getActiveTaglines();
    return { status: 200, body: data };
  }

  if (route === '/api/v1/admin/taglines' && method === 'GET') {
    const adminCheck = await authenticateAdmin(req, store, options);
    if (!adminCheck.ok) return { status: adminCheck.status, body: { error: adminCheck.error } };
    const data = await store.getAllTaglines();
    return { status: 200, body: data };
  }

  const parsedBody = parseJsonObjectBody(req.rawBody);
  if (!parsedBody.ok) return { status: 400, body: { error: parsedBody.error } };
  const body = parsedBody.value;

  if (hasTamperedScoreFields(body)) {
    return {
      status: 400,
      body: {
        error: 'score_fields_forbidden: Client-submitted score or progression fields are forbidden',
      },
    };
  }

  const playerAuthResult = await handlePlayerAndAuthRoutes({
    method,
    route,
    req,
    body,
    store,
    nowUnix,
    rawAdminEmails,
    options,
  });
  if (playerAuthResult) return playerAuthResult;

  const smokeSessionResult = await handleSmokeSessionRoutes({
    method,
    route,
    req,
    body,
    store,
    nowUnix,
  });
  if (smokeSessionResult) return smokeSessionResult;

  if (route === '/api/v1/admin/taglines' && method === 'POST') {
    const adminCheck = await authenticateAdmin(req, store, options);
    if (!adminCheck.ok) return { status: adminCheck.status, body: { error: adminCheck.error } };
    const candidateResult = normalizeJokeCandidates(body);
    if (!candidateResult.ok) return { status: 400, body: { error: candidateResult.error } };
    const data = await store.addTaglines(candidateResult.jokes, nowUnix);
    return { status: 201, body: { ...data, addedCount: candidateResult.jokes.length } };
  }

  if (route === '/api/v1/admin/taglines' && method === 'PATCH') {
    const adminCheck = await authenticateAdmin(req, store, options);
    if (!adminCheck.ok) return { status: adminCheck.status, body: { error: adminCheck.error } };

    if (body.cadence !== undefined) {
      const cadence = typeof body.cadence === 'string' ? body.cadence.trim() : '';
      if (!VALID_TAGLINE_CADENCES.includes(/** @type {any} */ (cadence))) {
        return {
          status: 400,
          body: { error: `Invalid cadence. Supported: ${VALID_TAGLINE_CADENCES.join(', ')}` },
        };
      }
      const data = await store.setTaglineCadence(cadence, nowUnix);
      return { status: 200, body: data };
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { status: 400, body: { error: 'Valid tagline id is required' } };
    }

    let jokeText = null;
    if (body.jokeText !== undefined) {
      if (typeof body.jokeText !== 'string') {
        return { status: 400, body: { error: 'jokeText must be a string' } };
      }
      const trimmed = body.jokeText.trim();
      if (trimmed.length < 3 || trimmed.length > 280) {
        return { status: 400, body: { error: 'Tagline must be between 3 and 280 characters' } };
      }
      jokeText = trimmed;
    }

    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null;
    const data = await store.updateTagline({ id, jokeText, isActive });
    return { status: 200, body: data };
  }

  if (route === '/api/v1/admin/taglines' && method === 'DELETE') {
    const adminCheck = await authenticateAdmin(req, store, options);
    if (!adminCheck.ok) return { status: adminCheck.status, body: { error: adminCheck.error } };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { status: 400, body: { error: 'Valid tagline id is required' } };
    }
    const data = await store.deleteTagline(id);
    return { status: 200, body: data };
  }

  if (route === '/api/v1/shifts/start' && method === 'POST') {
    const ctx = await authenticateAndValidateShiftContext(req.authHeader, body, store);
    if (!ctx.ok) return { status: ctx.status, body: { error: ctx.error } };

    const shiftId = globalThis.crypto.randomUUID();
    await store.createStartedShift({
      shiftId,
      playerId: String(ctx.playerRow.id),
      environmentId: ctx.environmentId,
      platform: ctx.platform,
      nowUnix,
    });

    return {
      status: 201,
      body: { shiftId, environmentId: ctx.environmentId, startedAt: nowUnix },
    };
  }

  if (route === '/api/v1/shifts/finish' && method === 'POST') {
    const ctx = await authenticateAndValidateShiftContext(req.authHeader, body, store);
    if (!ctx.ok) return { status: ctx.status, body: { error: ctx.error } };

    const { playerRow, currentProfile, environmentId, platform, previousUnlocked, smokeSession } = ctx;
    let shiftId = globalThis.crypto.randomUUID();
    let hasExistingStartedRow = false;
    let startedAt = nowUnix;
    let hasClientStartedAt = false;

    if (body.startedAt !== undefined) {
      const startedAtResult = normalizeStartedAtUnix(body.startedAt, nowUnix);
      if (!startedAtResult.ok) return { status: 400, body: { error: startedAtResult.error } };
      startedAt = startedAtResult.startedAt;
      hasClientStartedAt = true;
    }

    if (body.shiftId !== undefined) {
      if (typeof body.shiftId !== 'string' || body.shiftId.trim().length === 0 || body.shiftId.length > 64) {
        return { status: 400, body: { error: 'Invalid shiftId' } };
      }
      shiftId = body.shiftId.trim();
      const existingShift = await store.getShiftById(shiftId);
      if (!existingShift) {
        if (!hasClientStartedAt) {
          return { status: 400, body: { error: 'Unknown shiftId: shift was not started' } };
        }
      } else {
        if (String(existingShift.player_id) !== String(playerRow.id)) {
          return { status: 400, body: { error: 'shiftId belongs to another player' } };
        }
        if (String(existingShift.environment_id) !== environmentId) {
          return { status: 400, body: { error: 'environmentId does not match started shift' } };
        }
        if (existingShift.status === 'rejected') {
          return { status: 400, body: { error: 'Shift was already rejected' } };
        }
        if (existingShift.status === 'verified') {
          const leaderboard = await store.getLeaderboard();
          const currentSession = smokeSession
            ? await store.getSmokeSessionById(smokeSession.sessionId)
            : null;
          return {
            status: 200,
            body: {
              shiftId,
              verified: true,
              smoked: Number(existingShift.smoked),
              progress: 0,
              tapCount: Number(existingShift.tap_count),
              durationMs: Number(existingShift.duration_ms),
              newlyUnlockedEnvironments: [],
              profile: formatPlayerProfile(playerRow, rawAdminEmails),
              leaderboard,
              ...(currentSession ? { smokeSession: currentSession } : {}),
            },
          };
        }
        hasExistingStartedRow = true;
        startedAt = Number(existingShift.started_at ?? startedAt);
      }
    }

    const replay = verifyShiftReplay(body.pressOffsetsMs);
    if (!replay.ok) {
      await store.recordRejectedShift({
        shiftId,
        hasExistingStartedRow,
        playerId: String(playerRow.id),
        environmentId,
        platform,
        startedAt,
        completedAt: nowUnix,
      });
      return { status: 400, body: { error: replay.error } };
    }

    const promoResult = evaluatePromotionAttempt({
      environmentId,
      shiftSmoked: replay.smoked,
      smokedByEnvironmentBeforeShift: currentProfile.smokedByEnvironment,
      promotionRoundsClearedBeforeShift: currentProfile.promotionRoundsCleared,
    });

    const updatedPlayerRow = await store.recordVerifiedShift({
      shiftId,
      hasExistingStartedRow,
      playerId: String(playerRow.id),
      environmentId,
      platform,
      smoked: replay.smoked,
      tapCount: replay.tapCount,
      durationMs: replay.durationMs,
      startedAt,
      completedAt: nowUnix,
      promotionDelta: promoResult.promotionDelta,
    });

    const updatedSession = smokeSession
      ? await store.recordSmokeSessionShift({
          sessionId: smokeSession.sessionId,
          playerId: String(playerRow.id),
          shiftId,
          smoked: replay.smoked,
          tapCount: replay.tapCount,
          durationMs: replay.durationMs,
          completedAt: nowUnix,
        })
      : null;

    const updatedProfile = formatPlayerProfile(updatedPlayerRow ?? playerRow, rawAdminEmails);
    const newlyUnlockedEnvironments = updatedProfile.unlockedEnvironments.filter(
      id => !previousUnlocked.includes(id)
    );
    const leaderboard = await store.getLeaderboard();

    return {
      status: 200,
      body: {
        shiftId,
        verified: true,
        smoked: replay.smoked,
        progress: replay.progress,
        tapCount: replay.tapCount,
        durationMs: replay.durationMs,
        newlyUnlockedEnvironments,
        profile: updatedProfile,
        leaderboard,
        ...(updatedSession ? { smokeSession: updatedSession } : {}),
      },
    };
  }

  return { status: 404, body: { error: 'API route not found' } };
}
