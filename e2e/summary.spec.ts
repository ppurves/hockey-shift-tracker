import { expect, test } from '@playwright/test';

test('demo game: summary, timeline tabs and TOI check', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load demo game' }).click();
  await expect(page.getByRole('heading', { name: /Demo Hawks/ })).toBeVisible();
  await expect(page.getByTestId('summary-score')).toHaveText('4–2');

  const bars = page.locator('.timeline-scroll rect.shift');
  const all = await bars.count();
  expect(all).toBeGreaterThan(100);
  await page.getByRole('tab', { name: 'P2' }).click();
  await expect(page.getByRole('tab', { name: 'P2' })).toHaveAttribute('aria-selected', 'true');
  const p2 = await bars.count();
  expect(p2).toBeGreaterThan(20);
  expect(p2).toBeLessThan(all);

  await expect(page.locator('.timeline-scroll .goal')).not.toHaveCount(0);
  await expect(page.getByTestId('stats-table').locator('tbody tr')).toHaveCount(5);
  await page.getByRole('tab', { name: 'All' }).click();
  // Sanity: forward and D TOI equal the clock in every period.
  await expect(page.getByTestId('toi-check').locator('td:has-text("✓")')).toHaveCount(6);
});

test('zero-shift units show an em dash', async ({ page }) => {
  await page.goto('./#/new');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Period options' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /View summary/ }).click();
  await expect(page.getByTestId('stats-table').locator('tbody tr').first()).toContainText('—');
});
