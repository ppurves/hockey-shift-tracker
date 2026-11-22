import { expect, test } from '@playwright/test';

test('post-game edit: delete a goal, add one, fix a shift', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load demo game' }).click();
  await expect(page.getByTestId('summary-score')).toHaveText('4–2');
  await page.getByRole('button', { name: /Edit shifts/ }).click();

  // Delete the first goal for in P1 → score 3–2.
  await page.getByRole('button', { name: /Delete ▲ Goal for/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('edit-msg')).toHaveText('Deleted.');

  // Add a missed goal against at 2:00 → 3–3, credited to whoever was on.
  await page.getByLabel('Event type').selectOption('goalAgainst');
  await page.locator('.add-row').first().getByPlaceholder('m:ss').fill('2:00');
  await page.locator('.add-row').first().getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('edit-msg')).toContainText('Added ▼ Goal against at 2:00');
  await expect(page.getByTestId('marker-list')).toContainText(/2:00 · EV · .+/);

  // Overlapping shift is rejected with a clear message.
  const firstShift = page.getByTestId('shift-list').locator('li').first();
  await firstShift.getByRole('button', { name: /^Edit/ }).click();
  await firstShift.getByLabel('to').fill('14:00');
  await firstShift.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('edit-msg')).toContainText('Overlaps');
  await firstShift.getByRole('button', { name: 'Cancel' }).click();

  // Persisted: reload and check the summary.
  await page.reload();
  await page.getByRole('button', { name: '‹ Summary' }).click();
  await expect(page.getByTestId('summary-score')).toHaveText('3–3');
});

test('settings: default units and period length flow into a new game', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByLabel('Name for L1').fill('Smith-Jones-Lee');
  await page.getByRole('button', { name: '+ Add Line 4' }).click();
  await page.getByLabel('Default period length (minutes)').fill('12');
  await page.getByLabel(/Audio tick/).check();
  await page.getByRole('heading', { name: 'Settings' }).click();

  await page.goto('./#/new');
  await expect(page.getByLabel('Period length (minutes)')).toHaveValue('12');
  await page.getByRole('button', { name: /Unit names for this game \(10 units\)/ }).click();
  await page.getByLabel('Name for L2').fill('Kids Line');
  await page.getByRole('button', { name: 'Create game' }).click();

  await expect(page.locator('[data-unit="L4"]')).toBeVisible();
  await expect(page.locator('[data-unit="L1"]')).toContainText('Smith-Jones-Lee');
  await expect(page.locator('[data-unit="L2"]')).toContainText('Kids Line');
  // Start + tap with the audio tick enabled: must not break the tap.
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await page.locator('[data-unit="L4"]').click();
  await expect(page.locator('[data-unit="L4"]')).toHaveAttribute('aria-pressed', 'true');

  // The defaults themselves were not changed by the per-game rename.
  await page.goto('./#/settings');
  await expect(page.getByLabel('Name for L2')).toHaveValue('Line 2');
});
