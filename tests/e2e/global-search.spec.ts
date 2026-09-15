/**
 * Global search in the top nav, against the fixture dataset.
 *
 * Desktop drives the inline field from the keyboard; the phone project opens
 * the bottom sheet from the nav button, since phones have no `/` key to press.
 */

import { expect, type Page, test } from '@playwright/test';

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
    if (url.pathname === '/api/limitless/upcoming') {
      return route.fulfill({ status: 503, body: 'Unavailable in route fixtures' });
    }
    return route.continue();
  });
});

async function gotoHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.locator('main').first().waitFor({ state: 'attached', timeout: 15_000 });
}

test('slash focuses the box and Enter opens the top archetype', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'phones open the search sheet instead');
  const playerIndex: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/players/index')) {
      playerIndex.push(r.url());
    }
  });
  await gotoHome(page);
  const box = page.getByRole('combobox', { name: /Search cards/ });
  await expect(box).toBeVisible();
  expect(playerIndex, 'players index must not load with the page').toEqual([]);

  await page.locator('body').press('/');
  await expect(box).toBeFocused();
  await box.fill('Dragapult');

  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByRole('group', { name: 'Archetypes' })).toBeVisible();
  await expect(results.getByRole('option').first()).toContainText('Dragapult');
  await expect(results.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

  await box.press('Enter');
  await expect(page).toHaveURL(/\/archetypes\/Dragapult(\?|$)/);
});

test('Enter right after typing opens the match for the full query', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop field only');
  await gotoHome(page);
  const box = page.getByRole('combobox', { name: /Search cards/ });
  await box.click();
  await box.fill('Slowking');
  await expect(page.getByRole('option').first()).toContainText('Slowking');
  // Faster than the debounce: the list on screen is still for "Slowking".
  await box.fill('Dragapult');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/archetypes\/Dragapult(\?|$)/);
});

test('Escape clears and closes the results', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop field only');
  await gotoHome(page);
  const box = page.getByRole('combobox', { name: /Search cards/ });
  await box.click();
  await box.fill('Dragapult');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible();
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveCount(0);
});

test('the phone nav opens search in a sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone layout only');
  await gotoHome(page);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Search' });
  await expect(sheet).toBeVisible();
  const box = sheet.getByRole('combobox');
  await expect(box).toBeFocused();
  await box.fill('Dragapult');
  await sheet.getByRole('option').first().click();
  await expect(page).toHaveURL(/\/archetypes\/Dragapult(\?|$)/);
  await expect(sheet).toHaveCount(0);
});
