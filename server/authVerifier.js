// Web Crypto token hashing, credential generation, PBKDF2 password hashing, and OAuth JWKS ID token verification.

const PBKDF2_ITERATIONS = 50_000;

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
