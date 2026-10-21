// End-to-end Playwright browser test for login, pre-shift lobby navigation, 15s shift gameplay, and session persistence.

import { expect, test } from '@playwright/test';

test('signs in, navigates pre-shift lobby and HUD back actions, completes a 15-second break, and persists session on reload until sign-out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const timer = page.getByRole('timer', { name: 'Smoke break time remaining' });
  const tally = page.getByRole('region', { name: 'Smoke break tally' });
  const canvas = page.getByRole('img', { name: 'A lit cigarette over a steel ashtray' });

  await expect(canvas).toBeVisible();
  await expect(timer).toHaveText('0:15');

  // Step 1: Login modal is presented first. Verify default Returning tab vs New Hire tab, then register DOCK-LEAD.
  const loginDialog = page.getByRole('dialog', { name: 'Sign in to Smoke Break' });
  await expect(loginDialog).toBeVisible();
  await expect(loginDialog.getByText('EMAIL ADDRESS OR CALLSIGN')).toBeVisible();
  await expect(loginDialog.getByText('Forgot password?')).toBeVisible();
  await expect(loginDialog.getByText('Prefer Callsign-only (no email)?')).toBeHidden();
  await expect(loginDialog.getByText('NO EMAIL · RECOVERY NOT GUARANTEED')).toBeHidden();

  await loginDialog.getByRole('tab', { name: 'New Hire · Create Account' }).click();
  const preferCallsignBtn = loginDialog.getByText('Prefer Callsign-only (no email)?');
  await expect(preferCallsignBtn).toBeVisible();
  await expect(loginDialog.getByText('Forgot password?')).toBeHidden();

  const callsignInput = loginDialog.getByRole('textbox', { name: 'Login callsign' });
  await preferCallsignBtn.click();
  await expect(callsignInput).toHaveValue(/^[A-Z]{3}-[A-Z]{3,4}-[0-9]{2}$/);
  const initialCallsign = await callsignInput.inputValue();

  const randomizeBtn = loginDialog.getByText('↻ Randomize');
  await expect(randomizeBtn).toBeVisible();
  await randomizeBtn.click();
  await expect(callsignInput).toHaveValue(/^[A-Z]{3}-[A-Z]{3,4}-[0-9]{2}$/);
  await expect(callsignInput).not.toHaveValue(initialCallsign);

  await callsignInput.fill('DOCK-LEAD');
  await expect(loginDialog.getByText('NO EMAIL · RECOVERY NOT GUARANTEED')).toBeVisible();
  await loginDialog.getByRole('textbox', { name: 'Login password' }).fill('dock1234');
  await loginDialog.getByRole('button', { name: /Create Account & Choose Game Mode/ }).click();

  // Step 2: 3-Card Game Mode Selection (Campaign, Head-to-Head, Sandbox) without step indicator pills.
  const modeRegion = page.getByRole('region', { name: 'Select Game Mode' });
  await expect(modeRegion).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Select How You Want to Smoke' })).toBeVisible();
  await expect(modeRegion.getByRole('button', { name: /1\. SIGNED IN/i })).toHaveCount(0);
  await expect(page.locator('.proto-step-indicator')).toHaveCount(0);
  await expect(modeRegion.getByRole('heading', { name: 'Campaign · Sector Map' })).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Smoke Session' })).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Sandbox · Free Break' })).toBeVisible();

  // Verify Smoke Session 2-digit code lobby navigation before Campaign
  await modeRegion.getByRole('button', { name: /Open Smoke Session/ }).click();
  const sessionRegion = page.getByRole('region', { name: 'Smoke Session Lobby' });
  await expect(sessionRegion).toBeVisible();
  await expect(sessionRegion.getByRole('heading', { name: 'Start a Smoke Session' })).toBeVisible();
  await expect(sessionRegion.getByRole('heading', { name: 'Join with 2-Digit Code' })).toBeVisible();
  await sessionRegion.getByRole('button', { name: '← Game Modes' }).click();
  await expect(modeRegion).toBeVisible();

  // Step 3: Navigate to Campaign Sector Map, back to Game Modes, then deploy to Alleyway.
  await modeRegion.getByRole('button', { name: /Open Sector Map/ }).click();
  const mapRegion = page.getByRole('region', { name: 'Campaign Sector Map' });
  await expect(mapRegion).toBeVisible();
  await mapRegion.getByRole('button', { name: '← Game Modes' }).click();
  await expect(modeRegion).toBeVisible();
  await expect(mapRegion).toBeHidden();

  await modeRegion.getByRole('button', { name: /Open Sector Map/ }).click();
  await expect(mapRegion).toBeVisible();
  await mapRegion.getByRole('button', { name: /Deploy to Alleyway/ }).click();

  // Step 4: Active 3D Smoke Break viewport, pre-drag HUD back navigation, & top-right user profile circle.
  await expect(page.getByRole('heading', { name: 'Light up.' })).toBeVisible();
  await expect(tally.locator('strong')).toHaveText('0');

  const hudBackBtn = page.getByRole('button', { name: '← Modes / Map' });
  await expect(hudBackBtn).toBeVisible();
  await hudBackBtn.click();
  await expect(modeRegion).toBeVisible();
  await modeRegion.getByRole('button', { name: /Open Sector Map/ }).click();
  await mapRegion.getByRole('button', { name: /Deploy to Alleyway/ }).click();
  await expect(hudBackBtn).toBeVisible();

  const profileBtn = page.getByRole('button', { name: 'Open profile card for DOCK-LEAD' });
  await expect(profileBtn).toBeVisible();
  await profileBtn.click();
  const quickCard = page.getByRole('dialog', { name: 'Quick User Profile Card' });
  await expect(quickCard).toContainText('DOCK-LEAD');
  await profileBtn.click();
  await expect(quickCard).toBeHidden();

  // Environment deck displays unlock milestone badges (5, 15, 30 lifetime cigarettes).
  await expect(page.getByLabel('Unlock milestone: 5 lifetime cigarettes')).toHaveText('5 BUTTS');
  await expect(page.getByLabel('Unlock milestone: 15 lifetime cigarettes')).toHaveText('15 BUTTS');
  await expect(page.getByLabel('Unlock milestone: 30 lifetime cigarettes')).toHaveText('30 BUTTS');

  // Clock waits until the first drag, even when switching environments.
  await expect(page.getByRole('img', { name: 'Environment backdrop: Alleyway' })).toBeVisible();
  await page.getByRole('radio', { name: /Parking Garage/ }).click();
  await expect(page.getByRole('img', { name: 'Environment backdrop: Parking Garage' })).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(timer).toHaveText('0:15');

  // 12 Space presses finish one cigarette and stub it out in the tray; HUD back button hides once shift starts.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Space');
  }
  await expect(hudBackBtn).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Keep dragging.' })).toBeVisible();
  await expect(tally.locator('strong')).toHaveText('1');

  // Fast-forward the 15-second break clock to completion.
  await page.clock.fastForward(15_000);
  await expect(timer).toHaveText('0:00');
  const dialog = page.getByRole('dialog', { name: '1 cigarette in 15 seconds' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Global Top 10 Leaderboard' })).toContainText('DOCK-LEAD');
  await expect(dialog.getByRole('region', { name: 'Global Top 10 Leaderboard' })).toContainText('1 butts');

  // Button arms after 800ms guard against mashing.
  const newShift = dialog.getByRole('button', { name: 'Start new shift' });
  await expect(newShift).toBeDisabled();
  await page.clock.fastForward(800);
  await expect(newShift).toBeEnabled();
  await newShift.click();

  await expect(dialog).toBeHidden();
  await expect(timer).toHaveText('0:15');
  await expect(tally.locator('strong')).toHaveText('0');
  await expect(page.getByRole('img', { name: 'Environment backdrop: Parking Garage' })).toBeVisible();

  // Step 5: Reloading while signed in bypasses login dialog and lands on Select Game Mode; signing out returns to login.
  await page.reload();
  await expect(loginDialog).toBeHidden();
  await expect(modeRegion).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Select How You Want to Smoke' })).toBeVisible();

  await profileBtn.click();
  await expect(quickCard).toBeVisible();
  await quickCard.getByRole('button', { name: /Sign Out/i }).click();
  await expect(loginDialog).toBeVisible();

  expect(errors).toEqual([]);
});

test('navigates 3-Phase Campaign Blueprint Map and 3-Round Promotion Inspector, verifies non-overlapping 390x844 mobile grid, and drums multi-key Drag Ratio overdrive (12 -> 8 -> 4)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // Sign in as a new player
  const loginDialog = page.getByRole('dialog', { name: 'Sign in to Smoke Break' });
  await expect(loginDialog).toBeVisible();
  await loginDialog.getByRole('tab', { name: 'New Hire · Create Account' }).click();
  await loginDialog.getByText('Prefer Callsign-only (no email)?').click();
  await loginDialog.getByRole('textbox', { name: 'Login callsign' }).fill('ASH-BOSS-01');
  await loginDialog.getByRole('textbox', { name: 'Login password' }).fill('ashboss123');
  await loginDialog.getByRole('button', { name: /Create Account & Choose Game Mode/ }).click();

  // Open Campaign Sector Map
  const modeRegion = page.getByRole('region', { name: 'Select Game Mode' });
  await expect(modeRegion).toBeVisible();
  await expect(modeRegion).toContainText('1/12 UNLOCKED');
  await modeRegion.getByRole('button', { name: /Open Sector Map/ }).click();

  const mapRegion = page.getByRole('region', { name: 'Campaign Sector Map' });
  await expect(mapRegion).toBeVisible();

  // Verify 3-Tab Phase Strata bar (Phase 01, Phase 02, Phase 03)
  const phaseTabs = mapRegion.getByRole('tablist', { name: 'Campaign socioeconomic phases' });
  await expect(phaseTabs).toBeVisible();
  const phase1Tab = phaseTabs.getByRole('tab', { name: /PHASE 01.*Started from the Bottom/i });
  const phase2Tab = phaseTabs.getByRole('tab', { name: /PHASE 02.*Middle Class/i });
  const phase3Tab = phaseTabs.getByRole('tab', { name: /PHASE 03.*White-Collar/i });
  await expect(phase1Tab).toHaveAttribute('aria-selected', 'true');
  await expect(phase2Tab).toContainText('LOCKED');
  await expect(phase3Tab).toContainText('LOCKED');

  // Inspect Phase 01 Sector pin & 5th Promotion pin (Shift Lead Evaluation: 10 / 15 / 20 butts)
  await mapRegion.getByRole('button', { name: /SEC-04.*By a Dumpster/i }).click();
  await expect(mapRegion.locator('.proto-map-inspector')).toContainText('By a Dumpster');
  await expect(mapRegion.locator('.proto-map-inspector')).toContainText('0 / 20 butts');

  await mapRegion.getByRole('button', { name: /PROMOTION · 3 ROUNDS.*Shift Lead Evaluation/i }).click();
  const inspector = mapRegion.locator('.proto-map-inspector');
  await expect(inspector).toContainText('3-ROUND CHECKPOINTED PROMOTION');
  await expect(inspector).toContainText('Shift Lead Evaluation');
  await expect(inspector).toContainText('ROUND 01');
  await expect(inspector).toContainText('10 BUTTS');
  await expect(inspector).toContainText('ROUND 02');
  await expect(inspector).toContainText('15 BUTTS');
  await expect(inspector).toContainText('ROUND 03');
  await expect(inspector).toContainText('20 BUTTS');

  // Switch to Phase 02 (Middle Class) & inspect its sectors and HR Compliance Review promotion
  await phase2Tab.click();
  await expect(phase2Tab).toHaveAttribute('aria-selected', 'true');
  await expect(mapRegion.getByRole('button', { name: /SEC-05.*Office Sidewalk/i })).toBeVisible();
  await expect(mapRegion.getByRole('button', { name: /SEC-08.*Designated Gazebo/i })).toBeVisible();
  await mapRegion.getByRole('button', { name: /PROMOTION · 3 ROUNDS.*HR Compliance Review/i }).click();
  await expect(inspector).toContainText('HR Compliance Review');
  await expect(inspector).toContainText('15 BUTTS');
  await expect(inspector).toContainText('20 BUTTS');
  await expect(inspector).toContainText('25 BUTTS');

  // Switch to Phase 03 (White-Collar) & inspect its sectors and Boardroom Coronation promotion
  await phase3Tab.click();
  await expect(phase3Tab).toHaveAttribute('aria-selected', 'true');
  await expect(mapRegion.getByRole('button', { name: /SEC-09.*Executive Balcony/i })).toBeVisible();
  await expect(mapRegion.getByRole('button', { name: /SEC-12.*Penthouse Helipad/i })).toBeVisible();
  await mapRegion.getByRole('button', { name: /PROMOTION · 3 ROUNDS.*Boardroom Coronation/i }).click();
  await expect(inspector).toContainText('Boardroom Coronation');
  await expect(inspector).toContainText('20 BUTTS');
  await expect(inspector).toContainText('25 BUTTS');
  await expect(inspector).toContainText('30 BUTTS');

  // Switch back to Phase 01 and test mobile viewport (390x844 <= 640px) non-overlapping 2x2 grid + full-width Promotion card
  await phase1Tab.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mapRegion.locator('.proto-map-paths')).toBeHidden();

  const pins = mapRegion.locator('.proto-blueprint-canvas .proto-map-pin');
  await expect(pins).toHaveCount(5);
  const boxes = [];
  for (let i = 0; i < 5; i++) {
    const box = await pins.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(54);
    boxes.push(box!);
  }
  // Verify zero pairwise bounding-box overlap among all 5 mobile pins
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapsX = a.x < b.x + b.width - 1 && a.x + a.width - 1 > b.x;
      const overlapsY = a.y < b.y + b.height - 1 && a.y + a.height - 1 > b.y;
      expect(overlapsX && overlapsY).toBe(false);
    }
  }

  // Restore desktop viewport and deploy to Alleyway
  await page.setViewportSize({ width: 1280, height: 800 });
  await mapRegion.getByRole('button', { name: /SEC-01.*Alleyway/i }).click();
  await mapRegion.getByRole('button', { name: /Deploy to Alleyway/ }).click();

  // Verify pre-shift Digit1..4 switches EnvironmentDeck without starting the clock
  const timer = page.getByRole('timer', { name: 'Smoke break time remaining' });
  const tally = page.getByRole('region', { name: 'Smoke break tally' });
  const briefPanel = page.getByRole('region', { name: 'Smoke break brief' });

  await page.keyboard.press('Digit2');
  await expect(page.getByRole('img', { name: 'Environment backdrop: Behind a Restaurant' })).toBeVisible();
  await expect(timer).toHaveText('0:15');
  await page.keyboard.press('Digit1');
  await expect(page.getByRole('img', { name: 'Environment backdrop: Alleyway' })).toBeVisible();

  // Before shift starts, non-Space drum keys (KeyA, ArrowUp) do not start the 15s break clock
  await page.keyboard.press('KeyA');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('heading', { name: 'Light up.' })).toBeVisible();
  await expect(timer).toHaveText('0:15');

  // Drum 120 drags across multiple keys starting with Space (Space, KeyA, KeyS, KeyD, KeyF, KeyJ, KeyK, KeyL, Digit2, ArrowUp) -> 10 butts
  const drumKeys = ['Space', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Digit2', 'ArrowUp'];
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press(drumKeys[i % drumKeys.length]);
  }
  await expect(page.getByRole('heading', { name: 'Keep dragging.' })).toBeVisible();
  await expect(tally.locator('strong')).toHaveText('10');
  await expect(briefPanel).toContainText('8 DRAGS / BUTT · TURBO');
  await expect(briefPanel).toContainText('HOT DOG! Down to 8 drags a butt!');
  // Pressing Digit2 during an active shift did not switch away from Alleyway
  await expect(page.getByRole('img', { name: 'Environment backdrop: Alleyway' })).toBeVisible();

  // Drum 80 more drags at 8 drags/butt -> 20 butts total (4 DRAGS / BUTT overdrive)
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(drumKeys[i % drumKeys.length]);
  }
  await expect(tally.locator('strong')).toHaveText('20');
  await expect(briefPanel).toContainText('4 DRAGS / BUTT · OVERDRIVE');
  await expect(briefPanel).toContainText('HOLY SMOKES! 4 drags a butt!');

  // Drum 4 more drags at 4 drags/butt -> 21st butt finished!
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(drumKeys[i]);
  }
  await expect(tally.locator('strong')).toHaveText('21');

  expect(errors).toEqual([]);
});


