import { expect, test, type Page } from '@playwright/test';

const player = (page: Page, id: string) => page.locator(`[data-unit="${id}"]`);
const line = (page: Page, id: string) => page.locator(`[data-line="${id}"]`);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('roster: build a roster, track by line and by player, summary by line', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Roster (players)' }).click();
  // Three forwards on Line 1, an extra forward, two D on pair 1.
  const add = async (pos: 'Forward' | 'Defense', num: string, name: string) => {
    await page.getByRole('button', { name: `+ ${pos}` }).click();
    const row = page.locator('.roster-row').last();
    await row.getByLabel(/Number/).fill(num);
    await row.getByLabel(/Name/).fill(name);
  };
  await add('Forward', '9', 'Avery');
  await add('Forward', '17', 'Brooks');
  await add('Forward', '22', 'Cole');
  await add('Forward', '28', 'Jones');
  await page.locator('.roster-row').last().getByLabel(/Line/).selectOption({ label: 'Extra' });
  await add('Defense', '2', 'Kerr');
  await add('Defense', '4', 'Lowe');
  await expect(page.locator('.roster-row')).toHaveCount(6);

  // New game picks up roster mode and the roster.
  await page.goto('./#/new');
  await expect(page.getByRole('button', { name: 'Roster (players)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Roster for this game (6 skaters)')).toBeVisible();
  await page.getByLabel('Opponent').fill('Hawks');
  await page.getByRole('button', { name: 'Create game' }).click();

  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('button', { name: '▶ Resume' }).click();

  // Whole line on with one tap; D pair too.
  await line(page, 'L1').click();
  await line(page, 'D1').click();
  for (const id of ['p1', 'p2', 'p3', 'p5', 'p6']) await expect(player(page, id)).toHaveAttribute('aria-pressed', 'true');
  await expect(line(page, 'L1')).toContainText('ON ICE');

  // Single swap: #22 off, extra #28 on. The line still counts (2 of 3).
  await page.clock.fastForward('00:30');
  await player(page, 'p3').click();
  await player(page, 'p4').click();
  await expect(line(page, 'L1')).toContainText('2/3 on');
  await expect(player(page, 'p4')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Goal\s*For/ }).click();
  await expect(page.getByText(/Goal for \(EV\) · #9 Avery, #17 Brooks, #2 Kerr, #4 Lowe, #28 Jones/)).toBeVisible();
  await expect(player(page, 'p1')).not.toContainText('Avery'); // tiles: numbers only
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.fastForward('00:30');

  // Undo names the action.
  await line(page, 'L1').click(); // puts #22 back on, takes the extra off
  await expect(page.getByRole('button', { name: /Undo Line 1 on/ })).toBeVisible();
  await expect(player(page, 'p4')).toHaveAttribute('aria-pressed', 'false');

  // Summary: line rows with players under them.
  await page.getByRole('button', { name: 'Period options' }).click();
  await page.getByRole('button', { name: 'View summary & timeline' }).click();
  const table = page.getByTestId('stats-table');
  const rows = table.locator('tbody tr');
  await expect(rows.nth(0)).toHaveClass(/row-line/);
  await expect(rows.nth(0).locator('th')).toHaveText('Line 1');
  await expect(rows.nth(1).locator('th')).toHaveText('#9 Avery');
  await expect(rows.nth(4)).toHaveClass(/row-line/);
  await expect(rows.nth(4).locator('th')).toHaveText('D 1');
  await expect(rows.nth(7).locator('th')).toHaveText('#28 Jones'); // extras after the lines
  // Line 1 on the whole minute (≥ 2 of 3), +1; #22 missed the goal.
  await expect(rows.nth(0)).toContainText('1:00');
  await expect(rows.nth(0).locator('td').last()).toHaveText('+1');
  await expect(rows.nth(3).locator('td').last()).toHaveText('0');
  await expect(page.locator('.timeline-box svg rect.shift[data-unit="L1"]').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/roster-summary.png', fullPage: true });
});

test('roster demo: capture layout fits and the export builds', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load roster demo game' }).click();
  await expect(page.getByTestId('summary-score')).toBeVisible();
  await expect(page.getByTestId('stats-table').locator('tr.row-line')).toHaveCount(5);
  await page.getByRole('button', { name: /Export/ }).click();
  await expect(page.getByText(/report\.pdf/)).toBeVisible({ timeout: 15_000 });
});

test('roster capture screen fits a phone without scrolling', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Roster (players)' }).click();
  // 3 lines × 3 F + 1 extra, 2 pairs × 2 D: a full bench.
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '+ Forward' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+ Defense' }).click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '+ Goalie' }).click();
  const rows = page.locator('.roster-row');
  for (let i = 0; i < 16; i++) await rows.nth(i).getByLabel(/Number/).fill(String(i + 2));
  await page.goto('./#/new');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  const tiles = page.locator('.cap-units .tile');
  await expect(tiles).toHaveCount(5 + 14 + 2); // line tiles, skaters, goalies (no PP/PK tiles)
  for (const t of await tiles.all()) {
    const b = (await t.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(56);
    expect(b.width).toBeGreaterThanOrEqual(60);
  }
  const footer = (await page.locator('.cap-footer').boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(844);
  // Player tiles show numbers only; goalies show no timer.
  await expect(page.locator('.tile.player').first()).toHaveText(/^#\d+0:00/);
  await expect(page.locator('.tile.g-G').first()).not.toContainText(':');
  await page.screenshot({ path: 'test-results/roster-capture.png' });
});
