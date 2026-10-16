import { formatPlayerProfile, getUnlockedEnvironments } from './starSchema.js';
import {
  MAX_BODY_BYTES,
  checkRateLimit,
  extractBearerToken,
  generatePlayerCredentials,
  hasTamperedScoreFields,
  hashPassword,
  hashPlayerToken,
  isValidEnvironmentId,
  normalizePlatform,
  normalizeStartedAtUnix,
  validateCallsign,
  validatePassword,
  verifyOAuthIdToken,
  verifyPassword,
  verifyShiftReplay,
} from './shiftVerifier.js';

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
 * @param {string | null | undefined} authHeader
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 */
async function authenticatePlayer(authHeader, store) {
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  const tokenHash = await hashPlayerToken(token);
  return store.getPlayerByTokenHash(tokenHash);
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

  const environmentId = body.environmentId;
  if (!isValidEnvironmentId(environmentId)) {
    return { ok: false, status: 400, error: 'Invalid break environmentId' };
  }

  const unlocked = getUnlockedEnvironments(Number(playerRow.lifetime_smoked ?? 0));
  if (!unlocked.includes(environmentId)) {
    return { ok: false, status: 400, error: `Environment '${environmentId}' is locked` };
  }

  const platformResult = normalizePlatform(body.platform ?? playerRow.platform);
  if (!platformResult.ok) {
    return { ok: false, status: 400, error: platformResult.error };
  }

  return {
    ok: true,
    playerRow,
    environmentId,
    platform: platformResult.platform,
    previousUnlocked: unlocked,
  };
}

/**
 * Shared server-authoritative API handler used by both Express (server/index.js) and Cloudflare Workers (server/worker.js).
 * @param {{ method: string, pathname: string, authHeader?: string | null, rawBody?: string, contentLength?: number | string | null, clientIp?: string | null }} req
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 * @param {{ nowUnix?: number, jwksFetch?: typeof fetch }} [options]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function handleApiRequest(req, store, options = {}) {
  const method = req.method.toUpperCase();
  const route = normalizeApiPathname(req.pathname);
  const nowUnix = options.nowUnix ?? Math.floor(Date.now() / 1000);

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

  if (route === '/api/v1/players/me' && method === 'GET') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) {
      return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
    }
    return { status: 200, body: formatPlayerProfile(playerRow) };
  }

  if (route === '/api/v1/players/me' && method === 'DELETE') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) {
      return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
    }
    const playerId = String(playerRow.id);
    const callsign = String(playerRow.callsign);
    await store.deletePlayer(playerId);
    const leaderboard = await store.getLeaderboard();
    return {
      status: 200,
      body: {
        deleted: true,
        playerId,
        callsign,
        leaderboard,
      },
    };
  }

  const parsedBody = parseJsonObjectBody(req.rawBody);
  if (!parsedBody.ok) {
    return { status: 400, body: { error: parsedBody.error } };
  }
  const body = parsedBody.value;

  if (hasTamperedScoreFields(body)) {
    return {
      status: 400,
      body: { error: 'Client-submitted score or progression fields are forbidden' },
    };
  }

  if (route === '/api/v1/players' && method === 'POST') {
    if (typeof req.authHeader === 'string' && req.authHeader.trim() !== '') {
      const existingPlayer = await authenticatePlayer(req.authHeader, store);
      if (!existingPlayer) {
        return { status: 401, body: { error: 'Invalid Bearer playerToken' } };
      }
      return { status: 200, body: formatPlayerProfile(existingPlayer) };
    }

    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) {
      return { status: 400, body: { error: platformResult.error } };
    }

    const creds = generatePlayerCredentials();
    let callsign = creds.callsign;
    if (body.callsign !== undefined) {
      const callsignResult = validateCallsign(body.callsign);
      if (!callsignResult.ok) {
        return { status: 400, body: { error: callsignResult.error } };
      }
      callsign = callsignResult.callsign;
    }

    const tokenHash = await hashPlayerToken(creds.playerToken);
    const createdRow = await store.createPlayer({
      id: creds.playerId,
      callsign,
      tokenHash,
      platform: platformResult.platform,
      nowUnix,
    });

    if (!createdRow) {
      return { status: 500, body: { error: 'Failed to create player record' } };
    }

    return {
      status: 201,
      body: {
        ...formatPlayerProfile(createdRow),
        playerToken: creds.playerToken,
      },
    };
  }

  if (route === '/api/v1/players/me' && method === 'PATCH') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) {
      return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
    }

    const callsignResult = validateCallsign(body.callsign);
    if (!callsignResult.ok) {
      return { status: 400, body: { error: callsignResult.error } };
    }

    const normalizedCallsign = callsignResult.callsign.toUpperCase();
    const existingIdentity = await store.getAuthIdentity('password', normalizedCallsign);
    if (existingIdentity && String(existingIdentity.player_id) !== String(playerRow.id)) {
      return { status: 409, body: { error: 'Callsign is already registered by another player' } };
    }

    const updatedRow = await store.updatePlayerCallsign(
      String(playerRow.id),
      callsignResult.callsign,
      nowUnix
    );
    if (!updatedRow) {
      return { status: 404, body: { error: 'Player not found' } };
    }
    return { status: 200, body: formatPlayerProfile(updatedRow) };
  }

  if (route === '/api/v1/auth/login' && method === 'POST') {
    const callsignResult = validateCallsign(body.callsign);
    if (!callsignResult.ok) {
      return { status: 400, body: { error: callsignResult.error } };
    }
    const passwordResult = validatePassword(body.password);
    if (!passwordResult.ok) {
      return { status: 400, body: { error: passwordResult.error } };
    }
    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) {
      return { status: 400, body: { error: platformResult.error } };
    }

    const normalizedCallsign = callsignResult.callsign.toUpperCase();
    const existingIdentity = await store.getAuthIdentity('password', normalizedCallsign);

    if (existingIdentity) {
      const validPassword = await verifyPassword(
        passwordResult.password,
        String(existingIdentity.secret_hash ?? '')
      );
      if (!validPassword) {
        return { status: 401, body: { error: 'Invalid callsign or password' } };
      }

      const targetPlayer = await store.getPlayerById(String(existingIdentity.player_id));
      if (!targetPlayer) {
        return { status: 404, body: { error: 'Player account not found' } };
      }

      const callerPlayer = await authenticatePlayer(req.authHeader, store);
      if (callerPlayer && String(callerPlayer.id) === String(targetPlayer.id)) {
        return { status: 200, body: formatPlayerProfile(targetPlayer) };
      }

      const sessionCreds = generatePlayerCredentials();
      const sessionTokenHash = await hashPlayerToken(sessionCreds.playerToken);
      await store.upsertAuthIdentity({
        provider: 'session',
        providerSub: sessionTokenHash,
        playerId: String(targetPlayer.id),
        nowUnix,
      });

      return {
        status: 200,
        body: {
          ...formatPlayerProfile(targetPlayer),
          playerToken: sessionCreds.playerToken,
        },
      };
    }

    let playerRow = await authenticatePlayer(req.authHeader, store);
    let issuedToken = null;

    if (!playerRow) {
      const creds = generatePlayerCredentials();
      const tokenHash = await hashPlayerToken(creds.playerToken);
      playerRow = await store.createPlayer({
        id: creds.playerId,
        callsign: normalizedCallsign,
        tokenHash,
        platform: platformResult.platform,
        nowUnix,
      });
      issuedToken = creds.playerToken;
    } else if (String(playerRow.callsign) !== normalizedCallsign) {
      playerRow = await store.updatePlayerCallsign(
        String(playerRow.id),
        normalizedCallsign,
        nowUnix
      );
    }

    if (!playerRow) {
      return { status: 500, body: { error: 'Failed to initialize player account' } };
    }

    const secretHash = await hashPassword(passwordResult.password);
    await store.upsertAuthIdentity({
      provider: 'password',
      providerSub: normalizedCallsign,
      playerId: String(playerRow.id),
      secretHash,
      nowUnix,
    });
    playerRow = (await store.getPlayerById(String(playerRow.id))) ?? playerRow;

    return {
      status: 200,
      body: {
        ...formatPlayerProfile(playerRow),
        ...(issuedToken ? { playerToken: issuedToken } : {}),
      },
    };
  }

  if (route === '/api/v1/auth/oauth' && method === 'POST') {
    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) {
      return { status: 400, body: { error: platformResult.error } };
    }

    const oauthResult = await verifyOAuthIdToken(body.provider, body.idToken, {
      nowUnix,
      jwksFetch: options.jwksFetch,
    });
    if (!oauthResult.ok) {
      return { status: oauthResult.status, body: { error: oauthResult.error } };
    }

    const existingIdentity = await store.getAuthIdentity(oauthResult.provider, oauthResult.sub);
    if (existingIdentity) {
      const targetPlayer = await store.getPlayerById(String(existingIdentity.player_id));
      if (!targetPlayer) {
        return { status: 404, body: { error: 'Linked player account not found' } };
      }

      const callerPlayer = await authenticatePlayer(req.authHeader, store);
      if (callerPlayer && String(callerPlayer.id) === String(targetPlayer.id)) {
        return { status: 200, body: formatPlayerProfile(targetPlayer) };
      }

      const sessionCreds = generatePlayerCredentials();
      const sessionTokenHash = await hashPlayerToken(sessionCreds.playerToken);
      await store.upsertAuthIdentity({
        provider: 'session',
        providerSub: sessionTokenHash,
        playerId: String(targetPlayer.id),
        email: oauthResult.email,
        nowUnix,
      });

      return {
        status: 200,
        body: {
          ...formatPlayerProfile(targetPlayer),
          playerToken: sessionCreds.playerToken,
        },
      };
    }

    let playerRow = await authenticatePlayer(req.authHeader, store);
    let issuedToken = null;
    let desiredCallsign = null;
    if (body.callsign !== undefined) {
      const cs = validateCallsign(body.callsign);
      if (cs.ok) desiredCallsign = cs.callsign.toUpperCase();
    } else if (oauthResult.suggestedCallsign) {
      desiredCallsign = oauthResult.suggestedCallsign;
    }

    if (!playerRow) {
      const creds = generatePlayerCredentials();
      const tokenHash = await hashPlayerToken(creds.playerToken);
      playerRow = await store.createPlayer({
        id: creds.playerId,
        callsign: desiredCallsign ?? creds.callsign,
        tokenHash,
        platform: platformResult.platform,
        nowUnix,
      });
      issuedToken = creds.playerToken;
    } else if (
      desiredCallsign &&
      String(playerRow.callsign).startsWith('SHIFT-') &&
      String(playerRow.callsign) !== desiredCallsign
    ) {
      playerRow = await store.updatePlayerCallsign(
        String(playerRow.id),
        desiredCallsign,
        nowUnix
      );
    }

    if (!playerRow) {
      return { status: 500, body: { error: 'Failed to initialize OAuth player account' } };
    }

    await store.upsertAuthIdentity({
      provider: oauthResult.provider,
      providerSub: oauthResult.sub,
      playerId: String(playerRow.id),
      email: oauthResult.email,
      nowUnix,
    });
    playerRow = (await store.getPlayerById(String(playerRow.id))) ?? playerRow;

    return {
      status: 200,
      body: {
        ...formatPlayerProfile(playerRow),
        ...(issuedToken ? { playerToken: issuedToken } : {}),
      },
    };
  }

  if (route === '/api/v1/shifts/start' && method === 'POST') {
    const ctx = await authenticateAndValidateShiftContext(req.authHeader, body, store);
    if (!ctx.ok) {
      return { status: ctx.status, body: { error: ctx.error } };
    }

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
      body: {
        shiftId,
        environmentId: ctx.environmentId,
        startedAt: nowUnix,
      },
    };
  }

  if (route === '/api/v1/shifts/finish' && method === 'POST') {
    const ctx = await authenticateAndValidateShiftContext(req.authHeader, body, store);
    if (!ctx.ok) {
      return { status: ctx.status, body: { error: ctx.error } };
    }

    const { playerRow, environmentId, platform, previousUnlocked } = ctx;
    let shiftId = globalThis.crypto.randomUUID();
    let hasExistingStartedRow = false;
    let startedAt = nowUnix;
    let hasClientStartedAt = false;

    if (body.startedAt !== undefined) {
      const startedAtResult = normalizeStartedAtUnix(body.startedAt, nowUnix);
      if (!startedAtResult.ok) {
        return { status: 400, body: { error: startedAtResult.error } };
      }
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
              profile: formatPlayerProfile(playerRow),
              leaderboard,
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
    });

    const updatedProfile = formatPlayerProfile(updatedPlayerRow ?? playerRow);
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
      },
    };
  }

  return { status: 404, body: { error: 'API route not found' } };
}
