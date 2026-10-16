import { expect, test } from '@playwright/test';

test('renders the 3D break area, smokes a cigarette in 12 drags, completes the 15-second break, and starts a fresh shift', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Light up.' })).toBeVisible();
  await expect(tally.locator('strong')).toHaveText('0');

  // Environment deck displays unlock milestone badges (5, 15, 30 lifetime cigarettes).
  await expect(page.getByLabel('Unlock milestone: 5 lifetime cigarettes')).toHaveText('5 BUTTS');
  await expect(page.getByLabel('Unlock milestone: 15 lifetime cigarettes')).toHaveText('15 BUTTS');
  await expect(page.getByLabel('Unlock milestone: 30 lifetime cigarettes')).toHaveText('30 BUTTS');

  // Players can view and update their employee callsign badge from the HUD header without starting the clock.
  await expect(page.getByLabel('Employee callsign badge')).toContainText('BADGE · SHIFT-');
  await page.getByRole('button', { name: 'Edit employee callsign' }).click();
  const callsignInput = page.getByRole('textbox', { name: 'Employee callsign' });
  await callsignInput.fill('DOCK-LEAD');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Employee callsign badge')).toContainText('BADGE · DOCK-LEAD');

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



