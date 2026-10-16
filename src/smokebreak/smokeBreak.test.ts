import { expect, it } from 'vitest';
import { ENVIRONMENTS, getEnvironment } from './EnvironmentDeck';
import { BREAK_MS, PRESSES_PER_CIGARETTE, buttSlot, freshBreak, press, remainingMs } from './smokeBreak';

it('lasts 15 seconds', () => expect(BREAK_MS).toBe(15_000));

it('does not start the clock until the first press', () => {
  expect(remainingMs(freshBreak(), 5_000)).toBe(BREAK_MS);
  const started = press(freshBreak(), 1_000);
  expect(remainingMs(started, 6_000)).toBe(BREAK_MS - 5_000);
});

it('lights the next cigarette once one is finished', () => {
  let state = freshBreak();
  for (let i = 0; i < PRESSES_PER_CIGARETTE; i++) state = press(state, 0);
  expect(state).toMatchObject({ smoked: 1, progress: 0 });
  expect(press(state, 0).progress).toBe(1);
});

it('ignores presses after time is up', () => {
  const state = press(freshBreak(), 0);
  expect(press(state, BREAK_MS)).toBe(state);
});

it('stacks butts in rings, each layer on the last and inside the bowl', () => {
  const slots = Array.from({ length: 20 }, (_, n) => buttSlot(n));
  expect(slots.map(s => s.layer)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  for (const { x, z } of slots) expect(Math.hypot(x, z)).toBeLessThan(2);
  // A new layer sits between the butts below it, not on top of one.
  expect(buttSlot(6).angle).not.toBeCloseTo(buttSlot(0).angle);
});

it('defines the four static break environments and resolves them by id with unlock milestones', () => {
  expect(ENVIRONMENTS.map(e => ({ id: e.id, unlock: e.unlockSmokedRequired }))).toEqual([
    { id: 'alleyway', unlock: 0 },
    { id: 'restaurant', unlock: 5 },
    { id: 'parking-garage', unlock: 15 },
    { id: 'dumpster', unlock: 30 },
  ]);
  expect(getEnvironment('parking-garage').name).toBe('Parking Garage');
});

it('records relative millisecond pressOffsetsMs from the first drag and ignores post-break drags', async () => {
  const { freshShiftSession, recordShiftDrag, getUnlockedEnvironments, UNLOCK_THRESHOLDS } = await import('./smokeBreak');
  let session = freshShiftSession();
  expect(session.pressOffsetsMs).toEqual([]);

  // First press at t=1000ms starts the clock at offset 0ms
  session = recordShiftDrag(session, 1_000);
  expect(session.pressOffsetsMs).toEqual([0]);

  // Subsequent presses record relative offsets from startedAt (1000ms)
  for (let i = 1; i < PRESSES_PER_CIGARETTE; i++) {
    session = recordShiftDrag(session, 1_000 + i * 100);
  }
  expect(session.state.smoked).toBe(1);
  expect(session.pressOffsetsMs).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]);

  // Presses at or after 15,000ms from startedAt (t=16000ms) are ignored
  const afterBreak = recordShiftDrag(session, 1_000 + BREAK_MS);
  expect(afterBreak).toBe(session);
  expect(afterBreak.pressOffsetsMs).toHaveLength(12);

  expect(UNLOCK_THRESHOLDS).toEqual({
    alleyway: 0,
    restaurant: 5,
    'parking-garage': 15,
    dumpster: 30,
  });
  expect(getUnlockedEnvironments(0)).toEqual(['alleyway']);
  expect(getUnlockedEnvironments(15)).toEqual(['alleyway', 'restaurant', 'parking-garage']);
});



