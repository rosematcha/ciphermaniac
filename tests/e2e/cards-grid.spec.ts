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
