import { expect, test, type Page } from '@playwright/test';

const tile = (page: Page, id: string) => page.locator(`[data-unit="${id}"]`);
const clock = (page: Page) => page.getByTestId('game-clock');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('live capture: shifts, goal, pause, force-quit restore, undo', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/new');
  await page.getByLabel('Opponent').fill('Hawks');
  await page.getByRole('button', { name: 'Create game' }).click();

  // Start P1 (guarded by a confirm sheet), then resume at faceoff.
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();
  await page.getByRole('button', { name: '▶ Resume' }).click();

  await page.clock.fastForward('01:00');
  await tile(page, 'L1').click();
  await tile(page, 'D1').click();
  await expect(tile(page, 'L1')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.fastForward('00:45');
  await expect(tile(page, 'L1')).toContainText('0:45');
  await expect(clock(page)).toContainText('1:45');

  // One-tap line change within the group; D pair untouched.
  await tile(page, 'L2').click();
  await expect(tile(page, 'L1')).toHaveAttribute('aria-pressed', 'false');
  await expect(tile(page, 'L1')).toContainText('0:45'); // last shift
  await expect(tile(page, 'L2')).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, 'D1')).toHaveAttribute('aria-pressed', 'true');

  // Goal For records the goal and auto-pauses the clock.
  await page.getByRole('button', { name: /Goal\s*For/ }).click();
  await expect(page.getByTestId('score')).toContainText('1–0');
  await expect(page.getByText('PAUSED')).toBeVisible();

  // While paused, 5 minutes of real time must not move any clock.
  await page.clock.fastForward('05:00');
  await expect(clock(page)).toContainText('1:45');

  // "Force-quit": reload from the start URL (no hash), auto-resumes the live game.
  await page.goto('./');
  await expect(clock(page)).toContainText('1:45');
  await expect(page.getByText('PAUSED')).toBeVisible();
  await expect(tile(page, 'L2')).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, 'D1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('score')).toContainText('1–0');

  // Resume, then a restart while running counts the time away.
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.fastForward('00:30');
  await page.reload();
  await page.clock.fastForward('00:15');
  await expect(clock(page)).toContainText('2:30');
  await expect(tile(page, 'L2')).toContainText('0:45');

  // Undo shows what it will undo, then reverses it.
  const undo = page.getByRole('button', { name: /Undo/ });
  await expect(undo).toContainText('resume');
  await undo.click();
  await expect(page.getByText('Undone: resume')).toBeVisible();
  await expect(page.getByText('PAUSED')).toBeVisible();
  await expect(clock(page)).toContainText('1:45');
  await expect(undo).toContainText('goal for');
  await undo.click(); // removes the goal and its auto-pause: clock as if it never stopped
  await expect(page.getByTestId('score')).toContainText('0–0');
  await expect(clock(page)).toContainText('7:30');

  // End P1 via the period menu: everything comes off, P2 waits paused at 0:00.
  await page.getByRole('button', { name: 'Period options' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P2' }).click();
  await expect(clock(page)).toContainText('0:00');
  for (const id of ['L2', 'D1']) await expect(tile(page, id)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('PAUSED')).toBeVisible();
});

test('taps fire once on pointerdown (no double toggle)', async ({ page }) => {
  await page.goto('./#/new');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await tile(page, 'L3').tap();
  await expect(tile(page, 'L3')).toHaveAttribute('aria-pressed', 'true');
  await tile(page, 'L3').click();
  await expect(tile(page, 'L3')).toHaveAttribute('aria-pressed', 'false');
});

test('tiles show rest time; long shift turns red; long rest turns text red', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/new');
  await page.getByLabel('Opponent').fill('Hawks');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('button', { name: '▶ Resume' }).click();

  await tile(page, 'L1').click();
  await page.clock.fastForward('01:20');
  await expect(tile(page, 'L1')).not.toHaveClass(/long-shift/);
  await page.clock.fastForward('00:15'); // 1:35 > 1:30
  await expect(tile(page, 'L1')).toHaveClass(/long-shift/);
  await expect(tile(page, 'L1')).toHaveCSS('background-color', 'rgb(215, 38, 61)');

  await tile(page, 'L2').click();
  await page.clock.fastForward('02:00');
  await expect(page.getByTestId('rest-L1')).toHaveText('off 2:00');
  await expect(tile(page, 'L1')).not.toHaveClass(/long-rest/);
  await page.clock.fastForward('03:05'); // off 5:05 > 5:00
  await expect(page.getByTestId('rest-L1')).toHaveText('off 5:05');
  await expect(tile(page, 'L1')).toHaveClass(/long-rest/);
  await expect(tile(page, 'L1')).toHaveCSS('color', 'rgb(255, 107, 107)');
  await expect(page.getByTestId('rest-L3')).toHaveText(''); // never on: no rest shown
});

test('long shift / long rest thresholds come from Settings', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/settings');
  await page.getByTestId('long-shift').fill('0:45');
  await page.getByTestId('long-rest').fill('nonsense');
  await page.getByTestId('long-shift').focus(); // blur long-rest: invalid reverts
  await expect(page.getByTestId('long-rest')).toHaveValue('5:00');
  await page.getByTestId('long-rest').fill('90'); // plain seconds → 1:30
  await page.getByTestId('long-shift').focus();
  await expect(page.getByTestId('long-rest')).toHaveValue('1:30');
  await expect(page.getByTestId('long-shift')).toHaveValue('0:45');

  await page.goto('./#/new');
  await page.getByLabel('Opponent').fill('Hawks');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await tile(page, 'L1').click();
  await page.clock.fastForward('00:50');
  await expect(tile(page, 'L1')).toHaveClass(/long-shift/);
  await tile(page, 'L2').click();
  await page.clock.fastForward('01:35');
  await expect(tile(page, 'L1')).toHaveClass(/long-rest/);
});
