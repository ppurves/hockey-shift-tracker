import { expect, test } from '@playwright/test';

// Replaces Lighthouse's removed PWA audit: Chrome's own installability check
// plus a real offline reload.
test('production build is installable and works offline', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByTestId('offline-status')).toHaveText(/Ready for offline use/, { timeout: 15_000 });

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')!.getAttribute('href')!;
    return (await fetch(href)).json();
  });
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  await expect(page.locator('link[rel=apple-touch-icon][sizes="180x180"]')).toHaveCount(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hockey Shift Tracker' })).toBeVisible();
  await expect(page.getByTestId('offline-status')).toHaveText(/Ready for offline use/);
});
