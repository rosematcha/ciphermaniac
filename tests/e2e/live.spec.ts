/**
 * The live event page, against a fixed round rather than a real tournament.
 *
 * These lock the things the page was rebuilt to fix, all of which are layout
 * claims a unit test cannot make: the control bar is one row rather than five
 * of wrapped round chips, a pairing fits a phone without scrolling sideways,
 * and a seat whose registered name differs from their career's still leads to
 * that career.
 */

import { expect, test } from '@playwright/test';

const SLUG = 'testcup-2027';
const LIVE = `/live/${SLUG}`;

/** Fail loudly if a page reaches production R2 — the fixture wiring is broken. */
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === 'image') {
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`page requested external resource: ${url.href}`);
    }
    return route.continue();
  });
});

async function openLive(page: import('@playwright/test').Page, path = LIVE): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('.live-table .data tbody tr').first().waitFor({ timeout: 15_000 });
  expect(errors, `uncaught page errors on ${path}`).toEqual([]);
}

test('the page opens on the round the event is on, with every table', async ({ page }) => {
  await openLive(page);
  await expect(page.locator('h1')).toHaveText('Test Cup Regional Championships');
  await expect(page.locator('.hero-meta')).toContainText('Live: Round 2');
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(4);
  await expect(page.locator('.round-step-label')).toHaveText('R2');
  await expect(page.locator('.round-step-label')).not.toHaveClass(/is-pinned/);
});

test('the control bar is one row, whatever the round count', async ({ page }) => {
  await openLive(page);
  const bar = page.locator('.live-bar');
  const height = await bar.evaluate(el => el.getBoundingClientRect().height);
  // One 44px control plus the bar's own 10px padding each way. The fifteen
  // round chips this replaced ran to roughly 290px on a phone.
  expect(height).toBeLessThan(80);
  await expect(page.locator('.live-bar .chip')).toHaveCount(0);
});

test('nothing on the page scrolls sideways', async ({ page }) => {
  await openLive(page);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > viewport ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
});

test('both seats of a pairing are on screen', async ({ page }) => {
  await openLive(page);
  const row = page.locator('.live-table .data tbody tr').first();
  const width = await page.evaluate(() => window.innerWidth);
  for (const cell of await row.locator('.live-seat-cell').all()) {
    const box = await cell.boundingBox();
    expect(box, 'a seat cell has no box').not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
});

test('the round stepper walks back and marks the pinned round', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(page).toHaveURL(/round=1/);
  await expect(page.locator('.round-step-label')).toHaveText('R1');
  await expect(page.locator('.round-step-label')).toHaveClass(/is-pinned/);
  // The hero still says where the event actually is, and the strip reconciles them.
  await expect(page.locator('.filter-strip')).toContainText('live is R2');
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(4);
  // R1 is the first posted round; there is nowhere further back to step.
  await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled();
  // Stepping back onto the live round unpins it, so the page resumes following
  // the event instead of freezing on the round that happens to be current now.
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(page.locator('.round-step-label')).toHaveText('R2');
  await expect(page).not.toHaveURL(/round=/);
  await expect(page.locator('.round-step-label')).not.toHaveClass(/is-pinned/);
  await expect(page.locator('.filter-strip')).toHaveCount(0);
});

test('standings places come from the whole field, not from what the search left', async ({ page }) => {
  await page.goto(`${LIVE}?view=standings&q=hopper`, { waitUntil: 'load' });
  await page.locator('.live-standings .data tbody tr').first().waitFor({ timeout: 15_000 });
  const rows = page.locator('.live-standings .data tbody tr');
  await expect(rows).toHaveCount(1);
  // Grace Hopper is 0-2-0 and last; searching for her must not make her first.
  await expect(rows.first()).toContainText('Grace Hopper');
  await expect(rows.first().locator('.live-table-col')).not.toHaveText('1');
});

test('standings find a table by number too', async ({ page }) => {
  await page.goto(`${LIVE}?view=standings&q=3`, { waitUntil: 'load' });
  await page.locator('.live-standings .data tbody tr').first().waitFor({ timeout: 15_000 });
  await expect(page.locator('.live-standings .data tbody tr')).toHaveCount(2);
});

test('a dropped player keeps a page after they stop being paired', async ({ page }) => {
  // José drops in round 2 and is in no later round; the page still traces the
  // rounds he did play rather than going blank.
  await page.goto(`${LIVE}/player/jose-nunez--mx`, { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText('José Núñez');
  await expect(page.locator('.live-rounds .round')).toHaveCount(2);
  await expect(page.locator('.hero-meta')).toContainText('dropped');
});

test('a slug naming nobody says so instead of showing an empty run', async ({ page }) => {
  await page.goto(`${LIVE}/player/nobody-at-all--zz`, { waitUntil: 'load' });
  await expect(page.locator('h1')).toHaveText('Player not in this event');
  await expect(page.getByText('No seat under this name.')).toBeVisible();
});

test('following only, with nobody followed, says that and not "no match"', async ({ page }) => {
  await page.goto(`${LIVE}?following=1`, { waitUntil: 'load' });
  await expect(page.getByText('You are not following anyone yet.')).toBeVisible();
});

test('the search finds a table by its number as well as a player by name', async ({ page }) => {
  await openLive(page);
  const search = page.getByPlaceholder('Name or table...');
  await search.fill('3');
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(1);
  await expect(page.locator('.live-table .data tbody tr')).toContainText('Grace Hopper');
  await search.fill('liskov');
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(1);
  await search.fill('nobody at all');
  await expect(page.getByText('Nothing matches.')).toBeVisible();
});

test('a filter says it is on and can be taken off again', async ({ page }) => {
  await openLive(page);
  await page.goto(`${LIVE}?status=playing`, { waitUntil: 'load' });
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(2);
  await expect(page.locator('.live-filters-btn')).toHaveClass(/is-active/);
  await page.locator('.filter-strip .mini-chip', { hasText: 'Playing' }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(4);
});

test('standings rank the field with this round folded into the record', async ({ page }) => {
  await page.goto(`${LIVE}?view=standings`, { waitUntil: 'load' });
  await page.locator('.live-standings .data tbody tr').first().waitFor({ timeout: 15_000 });
  const first = page.locator('.live-standings .data tbody tr').first();
  // Ada won round 2, so she reads 2-0-0 here while the pairing still says 1-0-0.
  await expect(first).toContainText('Ada Lovelace');
  await expect(first).toContainText('2-0-0');
  await expect(page.locator('.live-standings .data tbody tr')).toHaveCount(8);
});

test('a seat whose registered name is not their career name still leads there', async ({ page }) => {
  await openLive(page);
  const seat = page.locator('.live-table .data tbody tr', { hasText: 'Caitlin White' });
  await expect(seat).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('Cali White');
  await expect(seat.getByRole('link', { name: 'Caitlin White' })).toHaveAttribute('href', '/players/9397');
});

test('a seat with no career gets a page of its own under the event', async ({ page }) => {
  await openLive(page);
  await page.getByRole('link', { name: 'Alan Turing' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${LIVE}/player/alan-turing--gb$`));
  await expect(page.locator('h1')).toHaveText('Alan Turing');
  // Both posted rounds, oldest first, with the result of each.
  await expect(page.locator('.live-rounds .round')).toHaveCount(2);
  await expect(page.locator('.live-rounds .round').first()).toContainText('R1');
  await expect(page.getByRole('link', { name: 'Test Cup Regional Championships' })).toBeVisible();
});

test('the old inline-run link is sent on to the page that replaced it', async ({ page }) => {
  await page.goto(`${LIVE}?player=Alan%20Turing&cc=GB`, { waitUntil: 'load' });
  await expect(page).toHaveURL(new RegExp(`${LIVE}/player/alan-turing--gb$`));
});

test('a submitted result is marked as unconfirmed, not just coloured', async ({ page }) => {
  await openLive(page);
  const provisional = page.locator('.round-outcome.provisional');
  await expect(provisional.first()).toBeVisible();
  await expect(provisional.first()).toContainText('?');
});

test('following is set from the row and filters the list', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Follow Ada Lovelace' }).click();
  await page.goto(`${LIVE}?following=1`, { waitUntil: 'load' });
  await expect(page.locator('.live-table .data tbody tr')).toHaveCount(1);
  await expect(page.locator('.live-table .data tbody tr')).toContainText('Ada Lovelace');
});
