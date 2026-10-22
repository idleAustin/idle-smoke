import { expect, it } from 'vitest';
import { ENVIRONMENTS, getEnvironment } from './EnvironmentDeck';
import { generateRandomCallsign } from './LobbyLoginRecoveryPanel';
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

it('defines the twelve static break environments across three phases and resolves them by id with unlock milestones and sector quotas', () => {
  expect(
    ENVIRONMENTS.map(e => ({
      id: e.id,
      phase: e.phase,
      quota: e.sectorQuotaRequired,
      unlock: e.unlockSmokedRequired,
    }))
  ).toEqual([
    { id: 'alleyway', phase: 1, quota: 5, unlock: 0 },
    { id: 'restaurant', phase: 1, quota: 10, unlock: 5 },
    { id: 'parking-garage', phase: 1, quota: 15, unlock: 15 },
    { id: 'dumpster', phase: 1, quota: 20, unlock: 30 },
    { id: 'office-sidewalk', phase: 2, quota: 25, unlock: 50 },
    { id: 'breakroom-patio', phase: 2, quota: 30, unlock: 75 },
    { id: 'strip-mall-median', phase: 2, quota: 35, unlock: 105 },
    { id: 'designated-gazebo', phase: 2, quota: 40, unlock: 140 },
    { id: 'executive-balcony', phase: 3, quota: 50, unlock: 180 },
    { id: 'concert-side-stage', phase: 3, quota: 60, unlock: 230 },
    { id: 'superyacht-aft-deck', phase: 3, quota: 75, unlock: 290 },
    { id: 'penthouse-helipad', phase: 3, quota: 100, unlock: 365 },
  ]);
  expect(getEnvironment('parking-garage').name).toBe('Parking Garage');
  expect(getEnvironment('penthouse-helipad').name).toBe('Penthouse Helipad');
  for (const env of ENVIRONMENTS) {
    expect(env.isPlaceholderArt).toBe(false);
    expect(env.image).toMatch(new RegExp(`environments/${env.id}\\.jpg$`));
  }
});

it('generates 10-11 character callsigns matching /^[A-Z]{3}-[A-Z]{3,4}-[0-9]{2}$/ and never returns the excluded callsign', () => {
  let previous = generateRandomCallsign();
  expect(previous).toMatch(/^[A-Z]{3}-[A-Z]{3,4}-[0-9]{2}$/);
  expect(previous.length).toBeGreaterThanOrEqual(10);
  expect(previous.length).toBeLessThanOrEqual(11);

  for (let i = 0; i < 50; i++) {
    const next = generateRandomCallsign(previous);
    expect(next).toMatch(/^[A-Z]{3}-[A-Z]{3,4}-[0-9]{2}$/);
    expect(next.length).toBeGreaterThanOrEqual(10);
    expect(next.length).toBeLessThanOrEqual(11);
    expect(next).not.toBe(previous);
    previous = next;
  }
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

  expect(UNLOCK_THRESHOLDS).toMatchObject({
    alleyway: 0,
    restaurant: 5,
    'parking-garage': 15,
    dumpster: 30,
  });
  expect(getUnlockedEnvironments(0)).toEqual(['alleyway']);
  expect(getUnlockedEnvironments(15)).toEqual(['alleyway', 'restaurant', 'parking-garage']);
});

it('scales in-shift Drag Ratio (12 -> 8 -> 4) across client press() and server verifyShiftReplay()', async () => {
  const { getDragRatio, freshShiftSession, recordShiftDrag } = await import('./smokeBreak');
  const { verifyShiftReplay } = await import('../../server/shiftVerifier.js');

  expect(getDragRatio(0)).toBe(12);
  expect(getDragRatio(9)).toBe(12);
  expect(getDragRatio(10)).toBe(8);
  expect(getDragRatio(19)).toBe(8);
  expect(getDragRatio(20)).toBe(4);
  expect(getDragRatio(59)).toBe(4);
  expect(getDragRatio(100)).toBe(4);

  const milestones: ReadonlyArray<{ drags: number; expectedButts: number }> = [
    { drags: 60, expectedButts: 5 },
    { drags: 120, expectedButts: 10 },
    { drags: 160, expectedButts: 15 },
    { drags: 200, expectedButts: 20 },
    { drags: 220, expectedButts: 25 },
    { drags: 240, expectedButts: 30 },
    { drags: 360, expectedButts: 60 },
    { drags: 364, expectedButts: 61 },
    { drags: 520, expectedButts: 100 },
  ];

  for (const { drags, expectedButts } of milestones) {
    let session = freshShiftSession();
    for (let i = 0; i < drags; i++) {
      session = recordShiftDrag(session, i * 20);
    }
    expect(session.state.smoked).toBe(expectedButts);
    expect(session.state.progress).toBe(0);

    const verified = verifyShiftReplay(session.pressOffsetsMs);
    expect(verified).toMatchObject({
      ok: true,
      smoked: expectedButts,
      progress: 0,
      tapCount: drags,
    });
  }
});

it('returns deterministic 7-tier corny hype copy and Drag Ratio badges across all butt brackets', async () => {
  const { getCornyHypeCopy } = await import('./smokeBreak');

  expect(getCornyHypeCopy(0)).toEqual({
    copy: "Attaboy! Clock's ticking — show that filter who's boss!",
    badge: '12 DRAGS / BUTT',
    dragRatio: 12,
  });
  expect(getCornyHypeCopy(1)).toEqual({
    copy: 'Look at those lungs go! Upper management could never!',
    badge: '12 DRAGS / BUTT',
    dragRatio: 12,
  });
  expect(getCornyHypeCopy(4).copy).toContain('Upper management could never');
  expect(getCornyHypeCopy(5)).toEqual({
    copy: "You're a natural-born chimney, sport! Synergize that nicotine!",
    badge: '12 DRAGS / BUTT',
    dragRatio: 12,
  });
  expect(getCornyHypeCopy(9).badge).toBe('12 DRAGS / BUTT');
  expect(getCornyHypeCopy(10)).toEqual({
    copy: "HOT DOG! Down to 8 drags a butt! Now we're cooking with gas, champ!",
    badge: '8 DRAGS / BUTT · TURBO',
    dragRatio: 8,
  });
  expect(getCornyHypeCopy(15)).toEqual({
    copy: "Sweet mother of pearl, slow down turbo — you're gonna trip the sprinklers!",
    badge: '8 DRAGS / BUTT · TURBO',
    dragRatio: 8,
  });
  expect(getCornyHypeCopy(20)).toEqual({
    copy: 'HOLY SMOKES! 4 drags a butt! Doctors hate you, the Tobacco Board wants your autograph!',
    badge: '4 DRAGS / BUTT · OVERDRIVE',
    dragRatio: 4,
  });
  expect(getCornyHypeCopy(30)).toEqual({
    copy: 'UNBELIEVABLE! You are legally 94% tar and 100% pure American hustle!',
    badge: '4 DRAGS / BUTT · OVERDRIVE',
    dragRatio: 4,
  });
});

it('validates desktop multi-key drumming codes (letters, digits, arrows, Space) while rejecting modifiers and navigation keys', async () => {
  const { isShiftDrumKeyCode } = await import('./smokeBreak');

  for (const validCode of ['Space', 'KeyA', 'KeyZ', 'Digit0', 'Digit1', 'Digit9', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    expect(isShiftDrumKeyCode(validCode)).toBe(true);
  }

  for (const ignoredCode of ['Tab', 'Escape', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltLeft', 'MetaLeft', 'F1', 'Backspace']) {
    expect(isShiftDrumKeyCode(ignoredCode)).toBe(false);
  }
});

it('unlocks all 12 environments, Phase 3, and Chairman rank in normalizeProfile and projectShiftProgression when isAdmin is true', async () => {
  const { normalizeProfile } = await import('./shiftStorage');
  const { projectShiftProgression } = await import('./smokeBreak');

  const expectedEnvironments = ENVIRONMENTS.map(env => env.id);
  const adminProfile = normalizeProfile({
    playerId: 'admin-1',
    callsign: 'ADMIN-01',
    isAdmin: true,
  });

  expect(adminProfile).toMatchObject({
    playerId: 'admin-1',
    callsign: 'ADMIN-01',
    isAdmin: true,
    lifetimeSmoked: 0,
    unlockedPhase: 3,
    promotionRoundsCleared: 9,
    isChairman: true,
    unlockedEnvironments: expectedEnvironments,
  });

  const projected = projectShiftProgression(0, 0, ['alleyway'], 1, {
    environmentId: 'penthouse-helipad',
    smokedByEnvironment: adminProfile.smokedByEnvironment,
    promotionRoundsCleared: 0,
    isAdmin: true,
  });

  expect(projected).toMatchObject({
    lifetimeSmoked: 1,
    bestSmoked: 1,
    unlockedPhase: 3,
    promotionRoundsCleared: 9,
    isChairman: true,
    unlockedEnvironments: expectedEnvironments,
  });
  expect(projected.smokedByEnvironment?.['penthouse-helipad']).toBe(1);
});

it('exposes ScoreboardScreen scope filters, drag pace telemetry, and URL query detection', async () => {
  const {
    SCOREBOARD_SCOPES,
    shouldOpenScoreboardFromUrl,
    estimateShiftDrags,
    formatShiftDragPace,
  } = await import('./ScoreboardScreen');

  expect(SCOREBOARD_SCOPES.map(s => s.id)).toEqual(['ALL', 'P1', 'P2', 'P3', 'SESSION']);
  expect(shouldOpenScoreboardFromUrl()).toBe(false);
  expect(estimateShiftDrags(0)).toBe(0);
  expect(estimateShiftDrags(1)).toBeGreaterThan(0);
  expect(formatShiftDragPace(3)).toMatch(/^\d+\.\d drags\/s$/);
});

it('derives deterministic smooth-vector Nice Avatar OperatorAvatar traits and guards Admin Scorpion emblem', async () => {
  const {
    deriveAvatarTraits,
    getSavedAvatarTraits,
    saveAvatarTraits,
    HEADGEAR_OPTIONS,
    EYES_OPTIONS,
    BEARD_OPTIONS,
    SMOKE_PROP_OPTIONS,
  } = await import('./OperatorAvatar');
  const { shouldOpenProfilePrototypeFromUrl } = await import('./UserProfilePrototype');

  const first = deriveAvatarTraits('ASH-KING-01');
  const second = deriveAvatarTraits('ash-king-01');
  expect(first).toEqual(second);
  expect(first.headgearIdx).toBeLessThan(HEADGEAR_OPTIONS.length);
  expect(first.smokeIdx).toBeLessThan(SMOKE_PROP_OPTIONS.length);
  expect(HEADGEAR_OPTIONS.map(o => o.id)).toEqual(['waves', 'buns', 'bob', 'halo', 'quiff', 'beanie', 'hardhat']);
  expect(EYES_OPTIONS.map(o => o.id)).toEqual(['lashes', 'relaxed', 'roundshades', 'cateye', 'heavylids']);
  expect(BEARD_OPTIONS.map(o => o.id)).toEqual(['hoops', 'freckles', 'clean', 'studs', 'stubble', 'beard']);

  // Curated leaderboard callsigns resolve to distinct feminine/masculine/fluid combinations
  expect(deriveAvatarTraits('MENTHOL-88')).not.toEqual(deriveAvatarTraits('ASH-KING'));

  // Regular non-admin users never get useAdminScorpion=true
  saveAvatarTraits('GUEST-OP-01', { headgearIdx: 2, smokeIdx: 3 }, true);
  expect(getSavedAvatarTraits('GUEST-OP-01', false)).toMatchObject({
    useAdminScorpion: false,
    isCustomized: true,
  });
  // Admins default to or honour useAdminScorpion
  expect(getSavedAvatarTraits('ADMIN-OP-01', true).useAdminScorpion).toBe(true);
  expect(shouldOpenProfilePrototypeFromUrl()).toBe(false);
});



