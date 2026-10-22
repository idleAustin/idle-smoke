// Player profile, session authentication, password login, and OAuth route handlers for the v1 API.
import {
  extractBearerToken,
  generatePlayerCredentials,
  hashPassword,
  hashPlayerToken,
  verifyOAuthIdToken,
  verifyPassword,
} from './authVerifier.js';
import {
  normalizePlatform,
  validateCallsign,
  validateLoginIdentifier,
  validatePassword,
} from './shiftVerifier.js';
import { formatPlayerProfile, isEmailInAdminList, parseAvatarConfig } from './storeQueries.js';

/**
 * @param {string | null | undefined} authHeader
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 */
export async function authenticatePlayer(authHeader, store) {
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  const tokenHash = await hashPlayerToken(token);
  return store.getPlayerByTokenHash(tokenHash);
}

/**
 * Verifies admin access via either X-Admin-Passcode header or an allowlisted account email.
 * @param {{ authHeader?: string | null, adminPasscode?: string | null }} req
 * @param {ReturnType<typeof import('./sqliteDb.js').createSqliteStore>} store
 * @param {{ env?: Record<string, unknown> }} [options]
 */
export async function authenticateAdmin(req, store, options = {}) {
  const expectedPasscode = String(
    options.env?.ADMIN_PASSCODE ?? globalThis.process?.env?.ADMIN_PASSCODE ?? ''
  ).trim();
  const providedPasscode =
    typeof req.adminPasscode === 'string' ? req.adminPasscode.trim() : '';

  if (providedPasscode && expectedPasscode && providedPasscode === expectedPasscode) {
    return { ok: true };
  }

  const playerRow = await authenticatePlayer(req.authHeader, store);
  const rawAdminEmails = String(
    options.env?.ADMIN_EMAILS ?? globalThis.process?.env?.ADMIN_EMAILS ?? ''
  );
  if (
    playerRow &&
    Boolean(playerRow.auth_provider) &&
    isEmailInAdminList(playerRow.auth_email, rawAdminEmails)
  ) {
    return { ok: true, playerRow };
  }

  return {
    ok: false,
    status: 403,
    error: 'Admin access required. Sign in with an Admin email or enter a valid Admin Passcode.',
  };
}

/** Issues or reuses a session token for an existing auth identity's linked player. */
async function createIdentitySessionResponse(params) {
  const { playerId, email, notFoundError, refreshProfile, authHeader, store, nowUnix, rawAdminEmails } = params;
  const targetPlayer = await store.getPlayerById(String(playerId));
  if (!targetPlayer) return { status: 404, body: { error: notFoundError } };

  const callerPlayer = await authenticatePlayer(authHeader, store);
  if (callerPlayer && String(callerPlayer.id) === String(targetPlayer.id)) {
    return { status: 200, body: formatPlayerProfile(targetPlayer, rawAdminEmails) };
  }

  const sessionCreds = generatePlayerCredentials();
  const sessionTokenHash = await hashPlayerToken(sessionCreds.playerToken);
  await store.upsertAuthIdentity({
    provider: 'session',
    providerSub: sessionTokenHash,
    playerId: String(targetPlayer.id),
    email,
    nowUnix,
  });

  const profileRow = refreshProfile
    ? ((await store.getPlayerById(String(targetPlayer.id))) ?? targetPlayer)
    : targetPlayer;

  return {
    status: 200,
    body: { ...formatPlayerProfile(profileRow, rawAdminEmails), playerToken: sessionCreds.playerToken },
  };
}

/** Resolves the authenticated caller player or provisions a new player record when linking an identity. */
async function resolveOrCreatePlayerForIdentity(params) {
  const { authHeader, desiredCallsign, shouldRenameExisting, platform, store, nowUnix } = params;
  let playerRow = await authenticatePlayer(authHeader, store);
  let issuedToken = null;

  if (!playerRow) {
    const creds = generatePlayerCredentials();
    const tokenHash = await hashPlayerToken(creds.playerToken);
    playerRow = await store.createPlayer({
      id: creds.playerId,
      callsign: desiredCallsign ?? creds.callsign,
      tokenHash,
      platform,
      nowUnix,
    });
    issuedToken = creds.playerToken;
  } else if (desiredCallsign && shouldRenameExisting(String(playerRow.callsign))) {
    playerRow = await store.updatePlayerCallsign(String(playerRow.id), desiredCallsign, nowUnix);
  }

  return { playerRow, issuedToken };
}

/**
 * Handles player registration, profile inspection/update/deletion, password login, and OAuth sign-in routes.
 * Returns null when the route/method is not handled by this module.
 * @param {{
 *   method: string,
 *   route: string,
 *   req: { authHeader?: string | null },
 *   body: Record<string, unknown>,
 *   store: ReturnType<typeof import('./sqliteDb.js').createSqliteStore>,
 *   nowUnix: number,
 *   rawAdminEmails: string,
 *   options: { nowUnix?: number, jwksFetch?: typeof fetch, env?: Record<string, unknown> }
 * }} ctx
 * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
 */
export async function handlePlayerAndAuthRoutes(ctx) {
  const { method, route, req, body, store, nowUnix, rawAdminEmails, options } = ctx;

  if (route === '/api/v1/players/me' && method === 'GET') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
    return { status: 200, body: formatPlayerProfile(playerRow, rawAdminEmails) };
  }

  if (route === '/api/v1/players/me' && method === 'DELETE') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) return { status: 401, body: { error: 'Valid Bearer playerToken required' } };
    const playerId = String(playerRow.id);
    const callsign = String(playerRow.callsign);
    await store.deletePlayer(playerId);
    const leaderboard = await store.getLeaderboard();
    return { status: 200, body: { deleted: true, playerId, callsign, leaderboard } };
  }

  if (route === '/api/v1/players' && method === 'POST') {
    if (typeof req.authHeader === 'string' && req.authHeader.trim() !== '') {
      const existingPlayer = await authenticatePlayer(req.authHeader, store);
      if (!existingPlayer) return { status: 401, body: { error: 'Invalid Bearer playerToken' } };
      return { status: 200, body: formatPlayerProfile(existingPlayer, rawAdminEmails) };
    }

    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) return { status: 400, body: { error: platformResult.error } };

    const creds = generatePlayerCredentials();
    let callsign = creds.callsign;
    if (body.callsign !== undefined) {
      const callsignResult = validateCallsign(body.callsign);
      if (!callsignResult.ok) return { status: 400, body: { error: callsignResult.error } };
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
    if (!createdRow) return { status: 500, body: { error: 'Failed to create player record' } };

    return {
      status: 201,
      body: { ...formatPlayerProfile(createdRow, rawAdminEmails), playerToken: creds.playerToken },
    };
  }

  if (route === '/api/v1/players/me' && method === 'PATCH') {
    const playerRow = await authenticatePlayer(req.authHeader, store);
    if (!playerRow) return { status: 401, body: { error: 'Valid Bearer playerToken required' } };

    if (body.callsign === undefined && body.avatarConfig === undefined) {
      const callsignResult = validateCallsign(body.callsign);
      if (!callsignResult.ok) return { status: 400, body: { error: callsignResult.error } };
    }

    let updatedRow = playerRow;

    if (body.callsign !== undefined) {
      const callsignResult = validateCallsign(body.callsign);
      if (!callsignResult.ok) return { status: 400, body: { error: callsignResult.error } };

      const normalizedCallsign = callsignResult.callsign.toUpperCase();
      const existingIdentity = await store.getAuthIdentity('password', normalizedCallsign);
      if (existingIdentity && String(existingIdentity.player_id) !== String(playerRow.id)) {
        return { status: 409, body: { error: 'Callsign is already registered by another player' } };
      }

      updatedRow = await store.updatePlayerCallsign(
        String(playerRow.id),
        callsignResult.callsign,
        nowUnix
      );
    }

    if (body.avatarConfig !== undefined) {
      const isCallerAdmin =
        Boolean(playerRow.auth_provider) && isEmailInAdminList(playerRow.auth_email, rawAdminEmails);
      if (body.avatarConfig === null) {
        updatedRow = await store.updatePlayerAvatarConfig(String(playerRow.id), null, nowUnix);
      } else if (typeof body.avatarConfig === 'object' && !Array.isArray(body.avatarConfig)) {
        const avatarObj = /** @type {Record<string, unknown>} */ (body.avatarConfig);
        if (avatarObj.useAdminScorpion === true && !isCallerAdmin) {
          return {
            status: 403,
            body: { error: 'Admin Scorpion avatar is restricted to Admin accounts' },
          };
        }
        const cleanedAvatar = parseAvatarConfig(body.avatarConfig, isCallerAdmin);
        if (!cleanedAvatar) {
          return { status: 400, body: { error: 'Invalid avatarConfig payload' } };
        }
        updatedRow = await store.updatePlayerAvatarConfig(
          String(playerRow.id),
          JSON.stringify(cleanedAvatar),
          nowUnix
        );
      } else {
        return { status: 400, body: { error: 'Invalid avatarConfig payload' } };
      }
    }

    if (!updatedRow) return { status: 404, body: { error: 'Player not found' } };
    return { status: 200, body: formatPlayerProfile(updatedRow, rawAdminEmails) };
  }

  if (route === '/api/v1/auth/login' && method === 'POST') {
    const loginId = validateLoginIdentifier(body.callsign);
    if (!loginId.ok) return { status: 400, body: { error: loginId.error } };
    const passwordResult = validatePassword(body.password);
    if (!passwordResult.ok) return { status: 400, body: { error: passwordResult.error } };
    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) return { status: 400, body: { error: platformResult.error } };

    const authMode = body.mode === 'register' ? 'register' : 'login';
    const isAdminEmail = Boolean(
      loginId.isEmail && isEmailInAdminList(loginId.email, rawAdminEmails)
    );

    if (isAdminEmail) {
      if (authMode === 'register') {
        return {
          status: 403,
          body: {
            error:
              'Admin accounts are pre-configured in Doppler and cannot be registered from the public form. Switch to Sign In.',
          },
        };
      }
      const expectedAdminPasscode = String(
        options.env?.ADMIN_PASSCODE ?? globalThis.process?.env?.ADMIN_PASSCODE ?? ''
      ).trim();
      if (!expectedAdminPasscode || passwordResult.password !== expectedAdminPasscode) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }
    }

    const existingIdentity = await store.getAuthIdentity('password', loginId.providerSub);

    if (!isAdminEmail && authMode === 'login' && !existingIdentity) {
      return {
        status: 401,
        body: { error: 'Account not found. Switch to Create Account to register.' },
      };
    }

    if (!isAdminEmail && authMode === 'register' && existingIdentity) {
      return {
        status: 409,
        body: { error: 'An account with this callsign or email already exists. Switch to Sign In.' },
      };
    }

    if (existingIdentity) {
      if (!isAdminEmail) {
        const validPassword = await verifyPassword(
          passwordResult.password,
          String(existingIdentity.secret_hash ?? '')
        );
        if (!validPassword) return { status: 401, body: { error: 'Invalid callsign or password' } };
      }

      return createIdentitySessionResponse({
        playerId: existingIdentity.player_id,
        email: existingIdentity.email ? String(existingIdentity.email) : loginId.email,
        notFoundError: 'Player account not found',
        refreshProfile: true,
        authHeader: req.authHeader,
        store,
        nowUnix,
        rawAdminEmails,
      });
    }

    let { playerRow, issuedToken } = await resolveOrCreatePlayerForIdentity({
      authHeader: req.authHeader,
      desiredCallsign: loginId.callsign,
      shouldRenameExisting: current =>
        (!loginId.isEmail || current.startsWith('SHIFT-')) && current !== loginId.callsign,
      platform: platformResult.platform,
      store,
      nowUnix,
    });
    if (!playerRow) return { status: 500, body: { error: 'Failed to initialize player account' } };

    const secretHash = await hashPassword(passwordResult.password);
    await store.upsertAuthIdentity({
      provider: 'password',
      providerSub: loginId.providerSub,
      playerId: String(playerRow.id),
      secretHash,
      email: loginId.email,
      nowUnix,
    });
    playerRow = (await store.getPlayerById(String(playerRow.id))) ?? playerRow;

    return {
      status: 200,
      body: {
        ...formatPlayerProfile(playerRow, rawAdminEmails),
        ...(issuedToken ? { playerToken: issuedToken } : {}),
      },
    };
  }

  if (route === '/api/v1/auth/oauth' && method === 'POST') {
    const platformResult = normalizePlatform(body.platform);
    if (!platformResult.ok) return { status: 400, body: { error: platformResult.error } };

    const oauthResult = await verifyOAuthIdToken(body.provider, body.idToken, {
      nowUnix,
      jwksFetch: options.jwksFetch,
    });
    if (!oauthResult.ok) return { status: oauthResult.status, body: { error: oauthResult.error } };

    const existingIdentity = await store.getAuthIdentity(oauthResult.provider, oauthResult.sub);
    if (existingIdentity) {
      return createIdentitySessionResponse({
        playerId: existingIdentity.player_id,
        email: oauthResult.email,
        notFoundError: 'Linked player account not found',
        refreshProfile: false,
        authHeader: req.authHeader,
        store,
        nowUnix,
        rawAdminEmails,
      });
    }

    let desiredCallsign = null;
    if (body.callsign !== undefined) {
      const cs = validateCallsign(body.callsign);
      if (cs.ok) desiredCallsign = cs.callsign.toUpperCase();
    } else if (oauthResult.suggestedCallsign) {
      desiredCallsign = oauthResult.suggestedCallsign;
    }

    let { playerRow, issuedToken } = await resolveOrCreatePlayerForIdentity({
      authHeader: req.authHeader,
      desiredCallsign,
      shouldRenameExisting: current =>
        current.startsWith('SHIFT-') && current !== desiredCallsign,
      platform: platformResult.platform,
      store,
      nowUnix,
    });
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
        ...formatPlayerProfile(playerRow, rawAdminEmails),
        ...(issuedToken ? { playerToken: issuedToken } : {}),
      },
    };
  }

  return null;
}
