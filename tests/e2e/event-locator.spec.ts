/**
 * The event locator against a fixture listing around Austin.
 *
 * Every outside service is stubbed: map tiles become blank images, the
 * geocoder answers from fixtures, and /api/locate reports Austin. The clock
 * is pinned so the fixture's September dates stay "upcoming".
 */

import { expect, type Page, test } from '@playwright/test';

const AUSTIN = { lat: 30.27, lon: -97.74, city: 'Austin', region: 'Texas', regionCode: 'TX', cc: 'US' };

const PHOTON: Record<string, unknown[]> = {
  dragon: [
    {
      geometry: { coordinates: [-97.95, 30.35] },
      properties: { name: 'Dragon', city: 'Lakeway', state: 'Texas', countrycode: 'US', type: 'locality' }
    }
  ],
  tokyo: [
    {
      geometry: { coordinates: [139.69, 35.68] },
      properties: { name: 'Tokyo', state: 'Tokyo', country: 'Japan', countrycode: 'JP', type: 'city' }
    }
  ]
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00'));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'tile.openstreetmap.org' || request.resourceType() === 'image') {
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      });
    }
    if (url.hostname === 'photon.komoot.io') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      return route.fulfill({ json: { features: PHOTON[query] ?? [] } });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`page requested external resource: ${url.href}`);
    }
    if (url.pathname === '/api/locate') {
      return route.fulfill({ json: { location: AUSTIN } });
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 503, body: 'Unavailable in fixtures' });
    }
    return route.continue();
  });
});

async function openLocator(page: Page, path = '/events'): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.locator('.el-row').first()).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
}

test('opens on the approximate location and lists what is near it, by day', async ({ page }) => {
  await openLocator(page);
  await expect(page.locator('.hero-meta')).toHaveText('50 mi around Austin, TX (approximate)');
  // San Antonio is 75 miles out, so five of the six fixture events are in range.
  await expect(page.locator('.el-row')).toHaveCount(5);
  await expect(page.locator('.el-count')).toHaveText('5 events, 2 Cups');
  await expect(page.locator('.el-day-head').first()).toContainText('Wed, Sep 16');
  await expect(page.locator('.el-day-head').first()).toContainText('Tomorrow');
  await expect(page.locator('.lm-marker')).toHaveCount(4);
  await expect(page.locator('.lm-credit')).toHaveText('© OpenStreetMap contributors');
});

test("the store's own registration leads, and pokemon.com carries the details", async ({ page }) => {
  await openLocator(page);
  const cup = page.locator('.el-item', { hasText: "Dragon's Lair Austin League Cup" });
  await cup.locator('.el-row').click();
  await expect(cup.locator('.el-row')).toHaveAttribute('aria-expanded', 'true');
  const register = cup.getByRole('link', { name: 'Register with the store' });
  await expect(register).toHaveAttribute('href', 'https://register.example.com/dragons-lair/cup');
  await expect(register).toHaveClass(/btn-primary/);
  await expect(register).toHaveAttribute('rel', /noreferrer/);
  const details = cup.getByRole('link', { name: 'Event details on pokemon.com' });
  await expect(details).toHaveClass(/btn-secondary/);
  await expect(cup.locator('.el-facts')).toContainText('2438 W Anderson Ln, Austin, TX 78757');
  await expect(cup.locator('.el-facts')).toContainText('Sep 1, 12:00 pm to Sep 19, 10:45 am');

  const challenge = page.locator('.el-item', { hasText: 'Fixture League Challenge 1' });
  await challenge.locator('.el-row').click();
  await expect(challenge.getByRole('link', { name: 'Event details on pokemon.com' })).toHaveClass(/btn-primary/);
  await expect(challenge.getByRole('link', { name: 'Register with the store' })).toHaveCount(0);
});

test('searching a store name finds the store and opens its next event', async ({ page }) => {
  await openLocator(page);
  await page.getByRole('combobox', { name: /Search a place/ }).fill('dragon');
  const options = page.getByRole('option');
  await expect(options.first()).toContainText("Dragon's Lair Austin");
  await expect(options.first()).toContainText('Next Sat, Sep 19');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hero-meta')).toHaveText("50 mi around Dragon's Lair Austin, Austin");
  const cup = page.locator('.el-item', { hasText: "Dragon's Lair Austin League Cup" });
  await expect(cup.locator('.el-row')).toHaveAttribute('aria-expanded', 'true');
  // A place the visitor chose goes into the link.
  await expect(page).toHaveURL(/near=Dragon/);
  await expect(page).toHaveURL(/lat=30\.359/);
});

test("the visitor's own position never goes into the link", async ({ page }) => {
  await openLocator(page);
  await page.waitForTimeout(600);
  expect(new URL(page.url()).searchParams.get('lat')).toBeNull();
});

test('League Cups alone narrows the list and the map', async ({ page }) => {
  await openLocator(page);
  await page.getByRole('button', { name: 'Challenges' }).click();
  await expect(page.locator('.el-row')).toHaveCount(2);
  await expect(page.locator('.lm-marker')).toHaveCount(2);
  await expect(page.locator('.el-count')).toHaveText('2 events, 2 Cups');
});

test('a shared link opens on its place and radius', async ({ page }) => {
  await openLocator(page, '/events?near=San%20Antonio%2C%20TX&lat=29.424&lon=-98.494&cc=US&r=25&u=mi');
  await expect(page.locator('.hero-meta')).toHaveText('25 mi around San Antonio, TX');
  await expect(page.locator('.el-row')).toHaveCount(1);
  await expect(page.locator('.el-row')).toContainText('San Antonio Challenge');
});

test('a country with no listed events says so', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'covered on desktop; the phone search is the same component');
  await openLocator(page);
  await page.getByRole('combobox', { name: /Search a place/ }).fill('tokyo');
  await expect(page.getByRole('option').first()).toContainText('None listed');
  await page.keyboard.press('Enter');
  await expect(page.locator('.empty-state')).toContainText('No events listed in Japan.');
});

test('on a phone the map scrolls away to a strip under the header', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const slot = page.locator('.el-map-slot');
  const map = page.locator('.lm');
  const height = (await map.boundingBox())?.height ?? 0;
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(page.locator('.el-map-frame')).toHaveClass(/collapsed/);
  const strip = await page.evaluate(() => {
    const nav = document.querySelector('.topnav')?.getBoundingClientRect().bottom ?? 0;
    return (document.querySelector('.el-map-slot')?.getBoundingClientRect().bottom ?? 0) - nav;
  });
  expect(strip).toBeGreaterThan(100);
  expect(strip).toBeLessThan(130);
  // The map itself never resizes, and the search row stays inside the strip.
  expect((await map.boundingBox())?.height).toBe(height);
  const search = await page.locator('.el-search-row').boundingBox();
  const box = await slot.boundingBox();
  expect(search && box && search.y + search.height).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('on a phone the map swallows long presses and tapped markers stay in the strip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const prevented = await page.evaluate(() => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('.lm')?.dispatchEvent(menu);
    return menu.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.locator('.lm-marker').first().tap();
  await expect(page.locator('.el-item.open')).toHaveCount(1);
  await expect(page.locator('.el-map-frame')).toHaveClass(/collapsed/);
  const inStrip = await page.evaluate(() => {
    const slot = document.querySelector('.el-map-slot')?.getBoundingClientRect();
    const nav = document.querySelector('.topnav')?.getBoundingClientRect().bottom ?? 0;
    const tapped = [...document.querySelectorAll('.lm-marker')].map(m => m.getBoundingClientRect());
    return tapped.some(r => slot && r.top >= nav && r.bottom <= slot.bottom);
  });
  expect(inStrip).toBe(true);
});
