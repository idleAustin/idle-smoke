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


