// Deterministic shift press reducer, replay anti-cheat verifier, request rate limiter, and input validators.
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
