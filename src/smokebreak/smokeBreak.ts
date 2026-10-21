import {
  BREAK_MS,
  PRESSES_PER_CIGARETTE,
  freshBreak,
  getDragRatio,
  press,
  type SmokeBreakState as SmokeBreak,
} from '../../server/shiftVerifier.js';
import {
  CAMPAIGN_PHASES,
  SECTOR_QUOTAS,
  UNLOCK_THRESHOLDS,
  evaluatePromotionAttempt,
  getUnlockedEnvironments,
  getUnlockedPhase,
  isPhasePromotionUnlocked,
} from '../../server/starSchema.js';

export type { SmokeBreak };
export {
  BREAK_MS,
  CAMPAIGN_PHASES,
  PRESSES_PER_CIGARETTE,
  SECTOR_QUOTAS,
  UNLOCK_THRESHOLDS,
  freshBreak,
  getDragRatio,
  getUnlockedEnvironments,
  getUnlockedPhase,
  isPhasePromotionUnlocked,
  press,
};

export type EnvironmentId =
  | 'alleyway'
  | 'restaurant'
  | 'parking-garage'
  | 'dumpster'
  | 'office-sidewalk'
  | 'breakroom-patio'
  | 'strip-mall-median'
  | 'designated-gazebo'
  | 'executive-balcony'
  | 'concert-side-stage'
  | 'superyacht-aft-deck'
  | 'penthouse-helipad';

export interface CornyHypeTier {
  copy: string;
  badge: '12 DRAGS / BUTT' | '8 DRAGS / BUTT · TURBO' | '4 DRAGS / BUTT · OVERDRIVE';
  dragRatio: 12 | 8 | 4;
}

const SHIFT_DRUM_KEY_CODE_PATTERN = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space)$/;

/**
 * Returns true if the KeyboardEvent.code is a valid multi-key drumming key during an active shift.
 */
export function isShiftDrumKeyCode(code: string): boolean {
  return SHIFT_DRUM_KEY_CODE_PATTERN.test(code);
}

/**
 * Returns the 7-tier corny hype phrase and active Drag Ratio badge for the current in-shift butt count.
 */
export function getCornyHypeCopy(smoked: number): CornyHypeTier {
  const dragRatio = getDragRatio(smoked);
  const badge =
    dragRatio === 4
      ? '4 DRAGS / BUTT · OVERDRIVE'
      : dragRatio === 8
        ? '8 DRAGS / BUTT · TURBO'
        : '12 DRAGS / BUTT';

  if (smoked >= 30) {
    return {
      copy: 'UNBELIEVABLE! You are legally 94% tar and 100% pure American hustle!',
      badge,
      dragRatio,
    };
  }
  if (smoked >= 20) {
    return {
      copy: 'HOLY SMOKES! 4 drags a butt! Doctors hate you, the Tobacco Board wants your autograph!',
      badge,
      dragRatio,
    };
  }
  if (smoked >= 15) {
    return {
      copy: "Sweet mother of pearl, slow down turbo — you're gonna trip the sprinklers!",
      badge,
      dragRatio,
    };
  }
  if (smoked >= 10) {
    return {
      copy: "HOT DOG! Down to 8 drags a butt! Now we're cooking with gas, champ!",
      badge,
      dragRatio,
    };
  }
  if (smoked >= 5) {
    return {
      copy: "You're a natural-born chimney, sport! Synergize that nicotine!",
      badge,
      dragRatio,
    };
  }
  if (smoked >= 1) {
    return {
      copy: 'Look at those lungs go! Upper management could never!',
      badge,
      dragRatio,
    };
  }
  return {
    copy: "Attaboy! Clock's ticking — show that filter who's boss!",
    badge,
    dragRatio,
  };
}

export interface SmokeBreakSession {
  state: SmokeBreak;
  pressOffsetsMs: number[];
}

export const freshShiftSession = (): SmokeBreakSession => ({
  state: freshBreak(),
  pressOffsetsMs: [],
});

type ShiftSessionAction = number | { type: 'start_clock'; now: number };

/**
 * Starts the 15-second break clock at `now` without recording a drag (used when a 3-2-1 countdown finishes).
 */
function startShiftClock(session: SmokeBreakSession, now: number): SmokeBreakSession {
  if (session.state.startedAt !== undefined) return session;
  return {
    state: { ...session.state, startedAt: now },
    pressOffsetsMs: session.pressOffsetsMs,
  };
}

/**
 * Advances the deterministic break state and records the relative millisecond offset
 * from the first drag (`0..15000ms` in non-decreasing order) for server replay verification.
 */
export function recordShiftDrag(
  session: SmokeBreakSession,
  action: ShiftSessionAction
): SmokeBreakSession {
  if (typeof action !== 'number') {
    return startShiftClock(session, action.now);
  }
  const now = action;
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
  shiftSmoked: number,
  context?: {
    environmentId: EnvironmentId;
    smokedByEnvironment: Record<EnvironmentId, number>;
    promotionRoundsCleared: number;
    isAdmin?: boolean;
  }
) {
  const nextLifetimeSmoked = lifetimeSmoked + shiftSmoked;
  const nextBestSmoked = Math.max(bestSmoked, shiftSmoked);
  if (context) {
    const isAdmin = Boolean(context.isAdmin);
    const promo = evaluatePromotionAttempt({
      environmentId: context.environmentId,
      shiftSmoked,
      smokedByEnvironmentBeforeShift: context.smokedByEnvironment,
      promotionRoundsClearedBeforeShift: context.promotionRoundsCleared,
    });
    const nextSmokedByEnvironment: Record<EnvironmentId, number> = {
      ...context.smokedByEnvironment,
      [context.environmentId]: (context.smokedByEnvironment[context.environmentId] ?? 0) + shiftSmoked,
    };
    const nextPromotionRoundsCleared = isAdmin ? 9 : promo.newPromotionRoundsCleared;
    const computedUnlocked = getUnlockedEnvironments({
      smokedByEnvironment: nextSmokedByEnvironment,
      promotionRoundsCleared: nextPromotionRoundsCleared,
      isAdmin,
    }) as EnvironmentId[];
    const nextUnlockedEnvironments = Array.from(
      new Set<EnvironmentId>([...previousUnlocked, ...computedUnlocked])
    );
    const newlyUnlockedEnvironments = nextUnlockedEnvironments.filter(
      id => !previousUnlocked.includes(id)
    );
    return {
      lifetimeSmoked: nextLifetimeSmoked,
      bestSmoked: nextBestSmoked,
      smokedByEnvironment: nextSmokedByEnvironment,
      promotionRoundsCleared: nextPromotionRoundsCleared,
      unlockedPhase: (isAdmin ? 3 : promo.unlockedPhase) as 1 | 2 | 3,
      isChairman: isAdmin || promo.isChairman,
      unlockedEnvironments: nextUnlockedEnvironments,
      newlyUnlockedEnvironments,
    };
  }
  const computedUnlocked = getUnlockedEnvironments(nextLifetimeSmoked) as EnvironmentId[];
  const nextUnlockedEnvironments = Array.from(
    new Set<EnvironmentId>([...previousUnlocked, ...computedUnlocked])
  );
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
