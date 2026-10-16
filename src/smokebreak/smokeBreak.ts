import {
  BREAK_MS,
  PRESSES_PER_CIGARETTE,
  freshBreak,
  press,
  type SmokeBreakState as SmokeBreak,
} from '../../server/shiftVerifier.js';

export type { SmokeBreak };
export { BREAK_MS, PRESSES_PER_CIGARETTE, freshBreak, press };

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

