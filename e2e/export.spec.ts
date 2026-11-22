import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('demo game → export screen: 4 files, email path reported on screen', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load demo game' }).click();
  await page.getByRole('button', { name: /Export & email/ }).click();

  const files = page.getByTestId('export-files').locator('li');
  await expect(files).toHaveCount(4, { timeout: 15_000 });
  const names = await files.locator('span').allTextContents();
  const date = names[0].slice(0, 10);
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(names).toEqual([
    `${date}_vs_Demo-Hawks_report.pdf`,
    `${date}_vs_Demo-Hawks_summary.csv`,
    `${date}_vs_Demo-Hawks_shifts.csv`,
    `${date}_vs_Demo-Hawks_events.csv`,
  ]);

  // The PDF downloads and is a real PDF.
  const [dl] = await Promise.all([page.waitForEvent('download'), files.first().getByRole('button').click()]);
  const pdf = await readFile((await dl.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(20_000); // includes the timeline PNG

  // Headless Chromium has no file share sheet → fallback path, stated on screen.
  await page.evaluate(() => {
    // Keep the test page from navigating to mailto:.
    Object.defineProperty(navigator, 'share', { value: undefined });
  });
  await page.getByTestId('email-me').click();
  await expect(page.getByTestId('delivery-result')).toContainText('Path used: download + email text', { timeout: 10_000 });
  await expect(page.getByTestId('delivery-result')).toContainText('NO attachments');
});

test('share sheet path is used when the browser supports file sharing', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', {
      value: async (data: { files: File[] }) => {
        (window as unknown as { __shared: unknown[] }).__shared.push(data.files.map((f) => f.name));
      },
    });
  });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load demo game' }).click();
  await page.getByRole('button', { name: /Export & email/ }).click();
  await expect(page.getByTestId('export-files').locator('li')).toHaveCount(4, { timeout: 15_000 });
  await page.getByTestId('email-me').click();
  await expect(page.getByTestId('delivery-result')).toContainText('Path used: share sheet');
  const shared = await page.evaluate(() => (window as unknown as { __shared: string[][] }).__shared);
  expect(shared[0]).toHaveLength(4);
});

test('backup then restore on a fresh install brings back every game', async ({ page, browser }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load demo game' }).click();
  await expect(page.getByRole('heading', { name: /Demo Hawks/ })).toBeVisible();
  await page.goto('./#/new');
  await page.getByLabel('Opponent').fill('Bears');
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByTestId('game-clock')).toBeVisible();
  await page.goto('./#/settings');
  await page.getByLabel('Default email recipient').fill('coach@example.com');
  await page.getByRole('heading', { name: 'Settings' }).click(); // blur → save
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up all data' }).click()]);
  const backupPath = (await dl.path())!;
  expect(JSON.parse(await readFile(backupPath, 'utf8')).games).toHaveLength(2);

  // Fresh install = new browser context with empty storage.
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto('./#/settings');
  await fresh.getByTestId('restore-input').setInputFiles(backupPath);
  await fresh.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.getByText('Restored 2 games')).toBeVisible();
  await fresh.goto('./#/');
  await expect(fresh.locator('.game-row')).toHaveCount(2);
  await expect(fresh.locator('.game-row', { hasText: 'Demo Hawks' })).toContainText('4–2');
  await fresh.goto('./#/settings');
  await expect(fresh.getByLabel('Default email recipient')).toHaveValue('coach@example.com');
});
