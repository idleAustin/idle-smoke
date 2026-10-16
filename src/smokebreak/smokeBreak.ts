import {
  BREAK_MS,
  PRESSES_PER_CIGARETTE,
  freshBreak,
  press,
  type SmokeBreakState as SmokeBreak,
} from '../../server/shiftVerifier.js';
import { UNLOCK_THRESHOLDS, getUnlockedEnvironments } from '../../server/starSchema.js';

export type { SmokeBreak };
export { BREAK_MS, PRESSES_PER_CIGARETTE, UNLOCK_THRESHOLDS, freshBreak, getUnlockedEnvironments, press };

export type EnvironmentId = 'alleyway' | 'restaurant' | 'parking-garage' | 'dumpster';

export interface SmokeBreakSession {
  state: SmokeBreak;
  pressOffsetsMs: number[];
}

export const freshShiftSession = (): SmokeBreakSession => ({
  state: freshBreak(),
  pressOffsetsMs: [],
});

/**
 * Advances the deterministic break state and records the relative millisecond offset
 * from the first drag (`0..15000ms` in non-decreasing order) for server replay verification.
 */
export function recordShiftDrag(session: SmokeBreakSession, now: number): SmokeBreakSession {
  const nextState = press(session.state, now);
  if (nextState === session.state || nextState.startedAt === undefined) {
    return session;
  }
  const rawOffset = Math.round(now - nextState.startedAt);
  const previousOffset = session.pressOffsetsMs.length > 0 ? session.pressOffsetsMs[session.pressOffsetsMs.length - 1] : 0;
  const clampedOffset = Math.max(previousOffset, Math.min(BREAK_MS, Math.max(0, rawOffset)));
  return {
    state: nextState,
    pressOffsetsMs: [...session.pressOffsetsMs, clampedOffset],
  };
}

/**
 * Projects career stats and newly unlocked environments for a completed shift.
 */
export function projectShiftProgression(
  lifetimeSmoked: number,
  bestSmoked: number,
  previousUnlocked: readonly EnvironmentId[],
  shiftSmoked: number
) {
  const nextLifetimeSmoked = lifetimeSmoked + shiftSmoked;
  const nextBestSmoked = Math.max(bestSmoked, shiftSmoked);
  const nextUnlockedEnvironments = getUnlockedEnvironments(nextLifetimeSmoked);
  const newlyUnlockedEnvironments = nextUnlockedEnvironments.filter(id => !previousUnlocked.includes(id));
  return {
    lifetimeSmoked: nextLifetimeSmoked,
    bestSmoked: nextBestSmoked,
    unlockedEnvironments: nextUnlockedEnvironments,
    newlyUnlockedEnvironments,
  };
}

/**
 * Returns true if a keyboard event originated inside an editable input or textarea.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

export const remainingMs = (state: SmokeBreak, now: number) =>
  state.startedAt === undefined ? BREAK_MS : Math.max(0, BREAK_MS - (now - state.startedAt));

/** Butts per ring in the ashtray before the pile starts a new layer. */
const BUTTS_PER_LAYER = 6;

/**
 * Where the `n`th butt rests in the ashtray, in cm from the bowl's center: a ring of butts lying
 * on the ash bed, each layer rotated half a slot and resting on the one below.
 */
export function buttSlot(n: number) {
  const layer = Math.floor(n / BUTTS_PER_LAYER);
  const angle = (n % BUTTS_PER_LAYER) * (2 * Math.PI / BUTTS_PER_LAYER) + layer * (Math.PI / BUTTS_PER_LAYER);
  const reach = 1.9 - Math.min(layer, 3) * 0.25;
  return { x: Math.cos(angle) * reach, z: Math.sin(angle) * reach, layer, angle };
}



