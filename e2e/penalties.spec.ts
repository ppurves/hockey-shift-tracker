import { expect, test, type Page } from '@playwright/test';

const player = (page: Page, id: string) => page.locator(`[data-unit="${id}"]`);
const line = (page: Page, id: string) => page.locator(`[data-line="${id}"]`);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function rosterGame(page: Page) {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Roster (players)' }).click();
  for (const [pos, num] of [['Forward', '9'], ['Forward', '17'], ['Forward', '22'], ['Defense', '2'], ['Defense', '4'], ['Goalie', '30'], ['Goalie', '31']]) {
    await page.getByRole('button', { name: `+ ${pos}` }).click();
    await page.locator('.roster-row').last().getByLabel(/Number/).fill(num);
  }
  await page.getByTestId('penalty-length').fill('1:30');
  await page.getByRole('heading', { name: 'Settings' }).click();
  await page.goto('./#/new');
  await page.getByLabel('Opponent').fill('Hawks');
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
}

test('penalty against: pick the player, they are boxed, PK ends when time is up', async ({ page }) => {
  await rosterGame(page);
  await player(page, 'p6').click(); // goalie #30 in net
  await expect(player(page, 'p6')).toContainText('IN NET');
  await line(page, 'L1').click();
  await line(page, 'D1').click();
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.fastForward('00:30');

  await page.getByRole('button', { name: /Penalty\s*Against/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: '#9', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '#30' })).toHaveCount(0); // goalies can't be picked
  await sheet.getByRole('button', { name: '#17', exact: true }).click();
  await expect(sheet.getByRole('button', { name: '1:30' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Save' }).click();

  // #17 is in the box: off the ice, disabled, counting down.
  await expect(player(page, 'p2')).toHaveAttribute('aria-pressed', 'false');
  await expect(player(page, 'p2')).toBeDisabled();
  await expect(player(page, 'p2')).toContainText('IN BOX');
  await expect(page.getByTestId('cond-against')).toContainText('PK 1:30');
  await expect(page.getByTestId('cond-against')).toContainText('#17 in box');

  // A line tap keeps #17 off.
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.fastForward('00:30');
  await expect(page.getByTestId('cond-against')).toContainText(/PK (1:00|0:5\d)/);
  await line(page, 'L1').click();
  await expect(player(page, 'p2')).toHaveAttribute('aria-pressed', 'false');

  // Time runs out: PK ends by itself, #17 can play again.
  await page.clock.fastForward('01:05');
  await expect(page.getByTestId('cond-against')).toHaveCount(0);
  await expect(page.getByText('Penalty kill over')).toBeVisible();
  await expect(player(page, 'p2')).toBeEnabled();
  await player(page, 'p2').click();
  await expect(player(page, 'p2')).toHaveAttribute('aria-pressed', 'true');

  // Summary: one PP / PK lane, box time in #17's row, penalty listed.
  await page.getByRole('button', { name: 'Period options' }).click();
  await page.getByRole('button', { name: 'View summary & timeline' }).click();
  await expect(page.getByTestId('penalty-list')).toContainText(/Against \(PK\) P1 0:30 · #17 · 1:30 · served, P1 2:00/);
  await expect(page.getByTestId('condition-totals')).toContainText('Penalty kill 1:30');
  await expect(page.locator('.timeline-box svg rect.cond-PK')).toHaveCount(1);
  await expect(page.locator('.timeline-box svg rect.box[data-unit="p2"]')).toHaveCount(1);
});

test('penalty for: power play starts, a goal for ends it; Undo brings it back', async ({ page }) => {
  await rosterGame(page);
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.getByRole('button', { name: /Penalty\s*For/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // no prompt for a penalty for
  await expect(page.getByTestId('cond-for')).toContainText('PP 1:30');
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.fastForward('00:20');
  await page.getByRole('button', { name: /Goal\s*For/ }).click();
  await expect(page.getByText(/Goal for \(PP\).*power play over/)).toBeVisible();
  await expect(page.getByTestId('cond-for')).toHaveCount(0);
  await page.getByRole('button', { name: /Undo goal for/ }).click();
  await expect(page.getByTestId('cond-for')).toContainText(/PP 1:(0\d|10)/); // the clock ran on through the Undo
  // End it early from the strip.
  await page.getByTestId('cond-for').click();
  await page.getByRole('dialog').getByRole('button', { name: 'End power play now' }).click();
  await expect(page.getByTestId('cond-for')).toHaveCount(0);
});

test('lines mode: no PP/PK tiles; penalty against asks for an optional number', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T19:00:00') });
  await page.goto('./#/new');
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.locator('[data-unit="PP1"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start P1' }).click();
  await page.getByRole('button', { name: /Penalty\s*Against/ }).click();
  await page.getByRole('dialog').getByLabel('Player #').fill('12');
  await page.getByRole('dialog').getByRole('button', { name: '5:00' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('cond-against')).toContainText('PK 5:00');
  await expect(page.getByTestId('cond-against')).toContainText('#12 in box');
  // Force-quit restore keeps the penalty running.
  await page.goto('./');
  await expect(page.getByTestId('cond-against')).toContainText('PK 5:00');
});
