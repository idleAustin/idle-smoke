import { ENVIRONMENT_SEEDS } from './starSchema.js';

export const BREAK_MS = 15_000;
/** Space presses it takes to finish one cigarette. */
export const PRESSES_PER_CIGARETTE = 12;
export const MAX_BODY_BYTES = 16 * 1024;

const MAX_PRESS_COUNT = 360;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const CALLSIGN_PATTERN = /^[A-Za-z0-9 _-]{2,16}$/;
const VALID_PLATFORMS = new Set(['web', 'ios', 'android']);
const VALID_ENVIRONMENTS = new Set(ENVIRONMENT_SEEDS.map(env => env.id));
const TAMPERED_SCORE_KEYS = Object.freeze([
  'smoked',
  'lifetimeSmoked',
  'lifetime_smoked',
  'bestSmoked',
  'best_smoked',
  'shiftsCompleted',
  'shifts_completed',
  'unlockedEnvironments',
  'unlocked_environments',
  'tokenHash',
  'token_hash',
  'status',
]);

/** @type {Map<string, { count: number, resetAtMs: number }>} */
const ipRateWindows = new Map();

/**
 * @typedef {{ progress: number, smoked: number, startedAt?: number }} SmokeBreakState
 */

/**
 * @returns {SmokeBreakState}
 */
export const freshBreak = () => ({ progress: 0, smoked: 0 });

/**
 * One press of the space bar (or tap). Presses after time is up are ignored.
 * @param {SmokeBreakState} state
 * @param {number} now
 * @returns {SmokeBreakState}
 */
export function press(state, now) {
  const startedAt = state.startedAt ?? now;
  if (now - startedAt >= BREAK_MS) return state;
  const progress = state.progress + 1;
  return progress >= PRESSES_PER_CIGARETTE
    ? { startedAt, progress: 0, smoked: state.smoked + 1 }
    : { startedAt, progress, smoked: state.smoked };
}

/**
 * Enforces per-IP request rate limiting within a 60s window.
 * @param {string | null | undefined} clientIp
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function checkRateLimit(clientIp, nowMs = Date.now()) {
  if (!clientIp) return true;
  if (ipRateWindows.size > 2048) {
    for (const [ip, entry] of ipRateWindows.entries()) {
      if (nowMs >= entry.resetAtMs) ipRateWindows.delete(ip);
    }
  }
  const existing = ipRateWindows.get(clientIp);
  if (!existing || nowMs >= existing.resetAtMs) {
    ipRateWindows.set(clientIp, { count: 1, resetAtMs: nowMs + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX_REQUESTS;
}

/**
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function hashPlayerToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a public UUID v4 playerId, a 256-bit secret hex playerToken, and a default SHIFT-XXXX callsign.
 */
export function generatePlayerCredentials() {
  const playerId = globalThis.crypto.randomUUID();
  const tokenBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(tokenBytes);
  const playerToken = Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
  const badgeNum = ((tokenBytes[0] << 8) | tokenBytes[1]) % 9000 + 1000;
  const callsign = `SHIFT-${badgeNum}`;
  return { playerId, playerToken, callsign };
}

/**
 * @param {string | null | undefined} authHeader
 * @returns {string | null}
 */
export function extractBearerToken(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const match = authHeader.trim().match(/^Bearer\s+([A-Za-z0-9._~+/-]+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length >= 8 && token.length <= 256 ? token : null;
}

/**
 * @param {unknown} rawCallsign
 * @returns {{ ok: true, callsign: string } | { ok: false, error: string }}
 */
export function validateCallsign(rawCallsign) {
  if (typeof rawCallsign !== 'string') {
    return { ok: false, error: 'Callsign must be a string' };
  }
  const trimmed = rawCallsign.trim();
  if (!CALLSIGN_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: 'Callsign must be 2–16 characters (alphanumeric, space, hyphen, or underscore)',
    };
  }
  return { ok: true, callsign: trimmed };
}

/**
 * Validates either a 2–16 char callsign OR an email address for /api/v1/auth/login.
 * @param {unknown} rawIdentifier
 * @returns {{ ok: true, isEmail: boolean, providerSub: string, email: string | null, callsign: string } | { ok: false, error: string }}
 */
export function validateLoginIdentifier(rawIdentifier) {
  if (typeof rawIdentifier !== 'string') {
    return { ok: false, error: 'Callsign or email must be a string' };
  }
  const trimmed = rawIdentifier.trim();
  if (trimmed.includes('@')) {
    if (trimmed.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      return { ok: false, error: 'Enter a valid email address' };
    }
    const email = trimmed.toLowerCase();
    const localPart = email
      .split('@')[0]
      .replace(/[^a-z0-9_-]/gi, '')
      .toUpperCase()
      .slice(0, 16);
    const derivedCallsign = localPart.length >= 2 ? localPart : `ADMIN-${localPart || '01'}`;
    return {
      ok: true,
      isEmail: true,
      providerSub: email,
      email,
      callsign: derivedCallsign,
    };
  }
  const callsignResult = validateCallsign(trimmed);
  if (!callsignResult.ok) {
    return callsignResult;
  }
  const normalizedCallsign = callsignResult.callsign.toUpperCase();
  return {
    ok: true,
    isEmail: false,
    providerSub: normalizedCallsign,
    email: null,
    callsign: normalizedCallsign,
  };
}

/**
 * @param {unknown} rawPassword
 * @returns {{ ok: true, password: string } | { ok: false, error: string }}
 */
export function validatePassword(rawPassword) {
  if (typeof rawPassword !== 'string') {
    return { ok: false, error: 'Password must be a string' };
  }
  if (rawPassword.length < 4 || rawPassword.length > 128) {
    return { ok: false, error: 'Password must be 4–128 characters' };
  }
  return { ok: true, password: rawPassword };
}

const PBKDF2_ITERATIONS = 50_000;

/**
 * Derives a salted PBKDF2-SHA256 password hash formatted as `pbkdf2$<saltHex>$<hashHex>`.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const saltHex = Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${saltHex}$${hashHex}`;
}

/**
 * Verifies a password against a stored `pbkdf2$<saltHex>$<hashHex>` string in constant time.
 * @param {string} password
 * @param {string | null | undefined} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, expectedHex] = parts;
  if (!/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;

  const saltBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    saltBytes[i] = parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  }
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const actualBytes = new Uint8Array(derivedBits);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    const expectedByte = parseInt(expectedHex.slice(i * 2, i * 2 + 2), 16);
    diff |= actualBytes[i] ^ expectedByte;
  }
  return diff === 0;
}

const OAUTH_PROVIDERS = Object.freeze({
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: new Set(['https://appleid.apple.com']),
  },
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: new Set(['https://accounts.google.com', 'accounts.google.com']),
  },
});

/**
 * @param {string} b64url
 * @returns {Uint8Array | null}
 */
function decodeBase64UrlBytes(b64url) {
  if (typeof b64url !== 'string' || b64url.length === 0) return null;
  try {
    const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    const binary = globalThis.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Derives a valid 2-16 character uppercase callsign from an OAuth email or display name.
 * @param {unknown} email
 * @param {unknown} name
 * @returns {string | null}
 */
function deriveCallsignFromClaims(email, name) {
  const rawCandidate =
    typeof name === 'string' && name.trim().length >= 2
      ? name.trim()
      : typeof email === 'string' && email.includes('@')
        ? email.split('@')[0]
        : '';
  const cleaned = rawCandidate
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .slice(0, 16)
    .toUpperCase();
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * Verifies an Apple or Google RS256 OAuth ID Token against the provider's JWKS keys.
 * @param {unknown} rawProvider
 * @param {unknown} rawIdToken
 * @param {{ nowUnix?: number, jwksFetch?: typeof fetch, expectedAudience?: string }} [options]
 * @returns {Promise<{ ok: true, provider: 'apple' | 'google', sub: string, email: string | null, suggestedCallsign: string | null } | { ok: false, status: number, error: string }>}
 */
export async function verifyOAuthIdToken(rawProvider, rawIdToken, options = {}) {
  if (rawProvider !== 'apple' && rawProvider !== 'google') {
    return { ok: false, status: 400, error: 'OAuth provider must be apple or google' };
  }
  if (typeof rawIdToken !== 'string' || rawIdToken.trim().length < 16) {
    return { ok: false, status: 400, error: 'Valid OAuth idToken is required' };
  }

  const parts = rawIdToken.trim().split('.');
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: 'Malformed OAuth JWT' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const headerBytes = decodeBase64UrlBytes(headerB64);
  const payloadBytes = decodeBase64UrlBytes(payloadB64);
  const signatureBytes = decodeBase64UrlBytes(signatureB64);
  if (!headerBytes || !payloadBytes || !signatureBytes) {
    return { ok: false, status: 401, error: 'Invalid base64url encoding in OAuth JWT' };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, status: 401, error: 'Invalid JSON in OAuth JWT' };
  }

  if (header?.alg !== 'RS256') {
    return { ok: false, status: 401, error: 'Unsupported OAuth JWT algorithm' };
  }

  const providerConfig = OAUTH_PROVIDERS[rawProvider];
  if (typeof payload?.iss !== 'string' || !providerConfig.issuers.has(payload.iss)) {
    return { ok: false, status: 401, error: 'OAuth token issuer mismatch' };
  }
  if (typeof payload?.sub !== 'string' || payload.sub.trim().length === 0) {
    return { ok: false, status: 401, error: 'OAuth token missing subject (sub)' };
  }

  const nowUnix = options.nowUnix ?? Math.floor(Date.now() / 1000);
  if (typeof payload?.exp !== 'number' || payload.exp <= nowUnix) {
    return { ok: false, status: 401, error: 'OAuth token has expired' };
  }

  if (options.expectedAudience && payload.aud !== options.expectedAudience) {
    return { ok: false, status: 401, error: 'OAuth token audience mismatch' };
  }

  const fetchImpl = options.jwksFetch ?? globalThis.fetch.bind(globalThis);
  let keys = [];
  try {
    const jwksRes = await fetchImpl(providerConfig.jwksUrl);
    if (!jwksRes.ok) {
      return { ok: false, status: 401, error: 'Failed to fetch OAuth provider JWKS' };
    }
    const jwksData = await jwksRes.json();
    keys = Array.isArray(jwksData?.keys) ? jwksData.keys : [];
  } catch {
    return { ok: false, status: 401, error: 'Unable to reach OAuth provider JWKS' };
  }

  const candidateKeys = keys.filter(
    k => k && k.kty === 'RSA' && (!header.kid || k.kid === header.kid)
  );
  if (candidateKeys.length === 0) {
    return { ok: false, status: 401, error: 'No matching JWKS key found for OAuth token' };
  }

  const signingBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let verified = false;
  for (const jwk of candidateKeys) {
    try {
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      const ok = await globalThis.crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        signatureBytes,
        signingBytes
      );
      if (ok) {
        verified = true;
        break;
      }
    } catch {
      // Try next key if any
    }
  }

  if (!verified) {
    return { ok: false, status: 401, error: 'Invalid OAuth token signature' };
  }

  const email = typeof payload.email === 'string' ? payload.email : null;
  const suggestedCallsign = deriveCallsignFromClaims(email, payload.name);

  return {
    ok: true,
    provider: rawProvider,
    sub: payload.sub.trim(),
    email,
    suggestedCallsign,
  };
}

/**
 * @param {unknown} rawPlatform
 * @returns {{ ok: true, platform: string } | { ok: false, error: string }}
 */
export function normalizePlatform(rawPlatform) {
  if (rawPlatform === undefined || rawPlatform === null) {
    return { ok: true, platform: 'web' };
  }
  if (typeof rawPlatform === 'string' && VALID_PLATFORMS.has(rawPlatform)) {
    return { ok: true, platform: rawPlatform };
  }
  return { ok: false, error: 'Platform must be web, ios, or android' };
}

/**
 * @param {unknown} environmentId
 * @returns {environmentId is string}
 */
export function isValidEnvironmentId(environmentId) {
  return typeof environmentId === 'string' && VALID_ENVIRONMENTS.has(environmentId);
}

/**
 * @param {Record<string, unknown>} body
 * @returns {boolean}
 */
export function hasTamperedScoreFields(body) {
  return TAMPERED_SCORE_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key));
}

/**
 * Normalizes a Unix epoch timestamp (seconds or milliseconds) into positive Unix seconds.
 * @param {unknown} rawStartedAt
 * @param {number} [fallbackUnix]
 * @returns {{ ok: true, startedAt: number } | { ok: false, error: string }}
 */
export function normalizeStartedAtUnix(rawStartedAt, fallbackUnix = Math.floor(Date.now() / 1000)) {
  if (rawStartedAt === undefined || rawStartedAt === null) {
    return { ok: true, startedAt: fallbackUnix };
  }
  const num = Number(rawStartedAt);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'Invalid startedAt timestamp' };
  }
  const seconds = num > 10_000_000_000 ? Math.floor(num / 1000) : Math.floor(num);
  return { ok: true, startedAt: Math.min(fallbackUnix, Math.max(1, seconds)) };
}

/**
 * Replays pressOffsetsMs through the deterministic press() reducer and enforces anti-cheat bounds.
 * @param {unknown} pressOffsetsMs
 * @returns {{ ok: true, smoked: number, progress: number, tapCount: number, durationMs: number } | { ok: false, error: string }}
 */
export function verifyShiftReplay(pressOffsetsMs) {
  if (!Array.isArray(pressOffsetsMs)) {
    return { ok: false, error: 'pressOffsetsMs must be an array of millisecond tap offsets' };
  }
  if (pressOffsetsMs.length > MAX_PRESS_COUNT) {
    return { ok: false, error: `pressOffsetsMs exceeds maximum human cadence ceiling (${MAX_PRESS_COUNT} taps)` };
  }

  let state = freshBreak();
  let previousOffset = 0;
  let appliedTapCount = 0;

  for (let i = 0; i < pressOffsetsMs.length; i++) {
    const offset = pressOffsetsMs[i];
    if (typeof offset !== 'number' || !Number.isFinite(offset)) {
      return { ok: false, error: 'Every press offset must be a finite number' };
    }
    if (offset < 0 || offset > BREAK_MS) {
      return { ok: false, error: `Press offset ${offset}ms must fall within 0..${BREAK_MS}ms` };
    }
    if (i > 0 && offset < previousOffset) {
      return { ok: false, error: 'pressOffsetsMs must be in non-decreasing chronological order' };
    }
    previousOffset = offset;
    const nextState = press(state, offset);
    if (nextState !== state) {
      appliedTapCount += 1;
    }
    state = nextState;
  }

  const durationMs =
    pressOffsetsMs.length > 0
      ? Math.min(BREAK_MS, Math.max(0, Math.round(pressOffsetsMs[pressOffsetsMs.length - 1] - pressOffsetsMs[0])))
      : 0;

  return {
    ok: true,
    smoked: state.smoked,
    progress: state.progress,
    tapCount: appliedTapCount,
    durationMs,
  };
}
