import { expect, test } from '@playwright/test';

// PAGE_SIZE in CardsIndexPage. A column count that doesn't divide it leaves a
// ragged last row on every full page.
const PAGE_SIZE = 84;

test('/cards grid column count divides the page size at every width', async ({ page }) => {
  await page.goto('/cards', { waitUntil: 'load' });
  const grid = page.locator('.cards-index-grid .cards-grid').first();
  await expect(grid.locator('.card-tile').first()).toBeVisible();

  const misses: string[] = [];
  for (let width = 320; width <= 1600; width += 8) {
    await page.setViewportSize({ width, height: 900 });
    const columns = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    if (PAGE_SIZE % columns !== 0) {
      misses.push(`${width}px: ${columns} columns`);
    }
  }
  expect(misses).toEqual([]);
});

test('/cards on the online meta loads only its own prices', async ({ page }) => {
  const priceFiles: string[] = [];
  page.on('request', request => {
    const file = new URL(request.url()).pathname.split('/').pop() ?? '';
    if (file.startsWith('prices')) {
      priceFiles.push(file);
    }
  });
  await page.goto('/cards', { waitUntil: 'load' });
  await page.locator('.cards-filter-bar').getByText('List', { exact: true }).click();
  // A rendered price means the price read has settled, fallback included.
  await expect(page.locator('.cards-list tr', { hasText: "Boss's Orders" })).toContainText('$0.24');
  expect(priceFiles).toEqual(['prices-meta.json']);
});

test("/cards shows a new scope's cards before their prices land", async ({ page }) => {
  await page.route('**/rspk/master.json', async route => {
    const response = await route.fetch();
    const report = (await response.json()) as { items: Record<string, unknown>[] };
    report.items = [{ ...report.items[0], name: 'Solo Card', set: 'TST', number: '001', uid: 'Solo Card::TST::001' }];
    await route.fulfill({ response, json: report });
  });
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/prices.json', async route => {
    await held;
    await route.continue();
  });
  await page.goto('/cards', { waitUntil: 'load' });
  await expect(page.locator('.card-tile').first()).toBeVisible();
  await page.locator('.t-selector-trigger').first().click();
  await page.locator('.t-selector-pop').getByText('RS-PK').click();
  await expect(page.locator('.card-tile', { hasText: 'Solo Card' })).toBeVisible();
  release();
});
