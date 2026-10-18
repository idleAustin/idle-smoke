import { expect, test } from '@playwright/test';

test('signs in, selects Campaign mode and Sector Map, smokes a cigarette in 12 drags, completes the 15-second break, and starts a fresh shift', async ({ page }) => {
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

  // Step 1: Login modal is presented first. Register callsign DOCK-LEAD.
  const loginDialog = page.getByRole('dialog', { name: 'Sign in to Smoke Break' });
  await expect(loginDialog).toBeVisible();
  await loginDialog.getByRole('tab', { name: 'New Hire · Create Account' }).click();
  await loginDialog.getByRole('textbox', { name: 'Login callsign' }).fill('DOCK-LEAD');
  await loginDialog.getByRole('textbox', { name: 'Login password' }).fill('dock1234');
  await loginDialog.getByRole('button', { name: /Create Account & Choose Game Mode/ }).click();

  // Step 2: 3-Card Game Mode Selection (Campaign, Head-to-Head, Sandbox).
  const modeRegion = page.getByRole('region', { name: 'Select Game Mode' });
  await expect(modeRegion).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Campaign · Sector Map' })).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Head-to-Head' })).toBeVisible();
  await expect(modeRegion.getByRole('heading', { name: 'Sandbox · Free Break' })).toBeVisible();
  await modeRegion.getByRole('button', { name: /Open Sector Map/ }).click();

  // Step 3: Campaign Blueprint Sector Map.
  const mapRegion = page.getByRole('region', { name: 'Campaign Sector Map' });
  await expect(mapRegion).toBeVisible();
  await mapRegion.getByRole('button', { name: /Deploy to Alleyway/ }).click();

  // Step 4: Active 3D Smoke Break viewport & top-right user profile circle.
  await expect(page.getByRole('heading', { name: 'Light up.' })).toBeVisible();
  await expect(tally.locator('strong')).toHaveText('0');
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

  // 12 Space presses finish one cigarette and stub it out in the tray.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Space');
  }
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
  expect(errors).toEqual([]);
});
