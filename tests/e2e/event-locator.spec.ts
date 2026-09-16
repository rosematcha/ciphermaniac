/**
 * The event locator against a fixture listing around Austin.
 *
 * Every outside service is stubbed: map tiles become blank images, the
 * geocoder answers from fixtures, and /api/locate reports Austin. The clock
 * is pinned so the fixture's September dates stay "upcoming".
 */

import { expect, type Locator, type Page, test } from '@playwright/test';

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

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: AUSTIN.lat, longitude: AUSTIN.lon });
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
      if (url.pathname === '/reverse') {
        return route.fulfill({
          json: { features: [{ properties: { city: 'Austin', state: 'Texas', countrycode: 'US' } }] }
        });
      }
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

/** The filter controls, opened: the panel over the list on desktop, the sheet on a phone. */
async function filters(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Filters' }).click();
  return page.getByRole('dialog', { name: 'Filters' });
}

/** Where the list is centred: the empty search box says so. */
const search = (page: Page) => page.getByRole('combobox', { name: /Search a place/ });

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`${selector} has no bounding box`);
  }
  return box;
}

test('asks for device location on first open and lists what is near it, by day', async ({ page }) => {
  await openLocator(page);
  await expect(search(page)).toHaveAttribute('placeholder', 'Austin, TX');
  // San Antonio is 75 miles out, so five of the six fixture events are in range.
  await expect(page.locator('.el-row')).toHaveCount(5);
  await expect(page.locator('.el-count')).toHaveText('5 events, 2 Cups');
  await expect(page.locator('.el-day-head').first()).toContainText('Wed, Sep 16');
  await expect(page.locator('.el-day-head').first()).toContainText('Tomorrow');
  await expect(page.locator('.lm-marker')).toHaveCount(4);
  await expect(page.locator('.lm-credit')).toHaveText('© OpenStreetMap contributors');
});

test('the desktop workspace grows fluidly on a wide display', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'desktop workspace behavior');
  await page.setViewportSize({ width: 2000, height: 1000 });
  await openLocator(page);

  const layout = await page.locator('.page').evaluate(element => {
    const map = element.querySelector<HTMLElement>('.el-map-slot')!.getBoundingClientRect();
    const results = element.querySelector<HTMLElement>('.el-results')!.getBoundingClientRect();
    return {
      pageWidth: element.getBoundingClientRect().width,
      mapWidth: map.width,
      mapShare: map.width / (map.width + results.width)
    };
  });

  expect(layout.pageWidth).toBeCloseTo(1560, 0);
  expect(layout.mapWidth).toBeGreaterThan(600);
  expect(layout.mapShare).toBeCloseTo(3 / 7, 2);
});

test('without device location it shows the edge estimate, marked approximate', async ({ context, page }) => {
  await context.clearPermissions();
  await page.goto('/events', { waitUntil: 'load' });
  await expect(search(page)).toHaveAttribute('placeholder', 'Austin, TX (approximate)');
});

test('with no location at all it falls back to the Peoria address', async ({ context, page }) => {
  await context.clearPermissions();
  await page.route('**/api/locate', route => route.fulfill({ status: 503, body: 'Unavailable in fixtures' }));
  await page.goto('/events', { waitUntil: 'load' });
  await expect(search(page)).toHaveAttribute('placeholder', '201 SW Jefferson Ave, Peoria, IL 61602');
});

test('while the location prompt is open it shows loading, never an empty result', async ({ page }) => {
  // A prompt nobody answers: the device never calls back.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: () => undefined } });
  });
  await page.route('**/api/locate', route => route.fulfill({ status: 503, body: 'Unavailable in fixtures' }));
  await page.goto('/events', { waitUntil: 'load' });
  await expect(page.locator('.el-skeleton').first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('.empty-state')).toHaveCount(0);
});

test('on a phone every row shows its distance in full', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const hidden = await page.$$eval(
    '.el-dist',
    cells =>
      cells.filter(cell => cell.getBoundingClientRect().width === 0 || cell.scrollWidth > cell.clientWidth).length
  );
  expect(hidden).toBe(0);
});

test('the Locals setting adds casual weekly events and is remembered', async ({ page }) => {
  await openLocator(page);
  const locals = (await filters(page)).getByRole('button', { name: 'Locals' });
  await expect(locals).toHaveAttribute('aria-pressed', 'false');
  await locals.click();
  await expect(locals).toHaveAttribute('aria-pressed', 'true');
  // The fixture store runs one weekly slot on Sundays: three of them fall inside the three-week horizon.
  await expect(page.locator('.el-row')).toHaveCount(8);
  await expect(page.locator('.el-count')).toHaveText('8 events, 2 Cups');
  await expect(page.locator('.el-item', { hasText: 'Weekly local' })).toHaveCount(3);
  await expect(page.locator('.el-day-head', { hasText: 'Sun, Sep 20' })).toBeVisible();
  await expect(page.locator('.el-day-head', { hasText: 'Sun, Oct 4' })).toBeVisible();
  await page.reload();
  await expect((await filters(page)).getByRole('button', { name: 'Locals' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.el-row')).toHaveCount(8);
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
  await expect(search(page)).toHaveAttribute('placeholder', "Dragon's Lair Austin, Austin");
  const cup = page.locator('.el-item', { hasText: "Dragon's Lair Austin League Cup" });
  await expect(cup.locator('.el-row')).toHaveAttribute('aria-expanded', 'true');
  // A place the visitor chose goes into the link.
  await expect(page).toHaveURL(/near=Dragon/);
  await expect(page).toHaveURL(/lat=30\.359/);

  await page.reload();
  await expect(search(page)).toHaveAttribute('placeholder', "Dragon's Lair Austin, Austin");
});

test('clicking empty map space does not move the search center', async ({ page }) => {
  await openLocator(page);
  const map = page.locator('.lm');
  const box = await map.boundingBox();
  if (!box) {
    throw new Error('map has no bounding box');
  }
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.7);
  await expect(search(page)).toHaveAttribute('placeholder', 'Austin, TX');
});

test("the visitor's own position never goes into the link", async ({ page }) => {
  await openLocator(page);
  await page.waitForTimeout(600);
  expect(new URL(page.url()).searchParams.get('lat')).toBeNull();
});

test('League Cups alone narrows the list and the map', async ({ page }) => {
  await openLocator(page);
  await (await filters(page)).getByRole('button', { name: 'Challenges' }).click();
  await expect(page.locator('.el-row')).toHaveCount(2);
  await expect(page.locator('.lm-marker')).toHaveCount(2);
  await expect(page.locator('.el-count')).toHaveText('2 events, 2 Cups');
});

test('a shared link opens on its place and radius', async ({ page }) => {
  await openLocator(page, '/events?near=San%20Antonio%2C%20TX&lat=29.424&lon=-98.494&cc=US&r=25&u=mi');
  await expect(search(page)).toHaveAttribute('placeholder', 'San Antonio, TX');
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

test('on a phone the map and list split the screen, and only the list scrolls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const height = page.viewportSize()?.height ?? 0;
  const map = await boxOf(page, '.el-map-slot');
  const list = await boxOf(page, '.el-results');
  expect(map.height).toBeGreaterThan(height * 0.3);
  expect(list.y).toBeGreaterThanOrEqual(map.y + map.height);
  expect(Math.round(list.y + list.height)).toBe(height);
  await page.locator('.el-results').evaluate(el => el.scrollTo(0, 400));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await boxOf(page, '.el-map-slot')).toEqual(map);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('on a phone the filter sheet holds the controls and the seam states the result', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const seam = page.locator('.el-seam');
  await expect(seam).toContainText('5 events, 2 Cups');
  await expect(seam).toContainText('30 days · 50 mi');
  // The search box says where the list is centred.
  await expect(page.getByRole('combobox', { name: /Search a place/ })).toHaveAttribute('placeholder', 'Austin, TX');
  await seam.click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByRole('button', { name: 'Challenges' }).click();
  await sheet.getByRole('button', { name: 'Show 2 events' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.el-row')).toHaveCount(2);
  await expect(seam).toContainText('2 events, 2 Cups');
});

test('on a phone the map swallows long presses and a tapped dot opens its event below', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await openLocator(page);
  const prevented = await page.evaluate(() => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('.lm')?.dispatchEvent(menu);
    return menu.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const map = await boxOf(page, '.el-map-slot');
  await page.locator('.lm-marker').first().tap();
  await expect(page.locator('.el-item.open')).toHaveCount(1);
  await expect(page.locator('.el-item.open')).toBeInViewport();
  // The map stays whole: the list scrolled, the page did not.
  expect(await boxOf(page, '.el-map-slot')).toEqual(map);
});

test('a phone on its side puts the map beside the list, with its controls clear', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.setViewportSize({ width: 844, height: 390 });
  await openLocator(page);
  const map = await boxOf(page, '.el-map-slot');
  const list = await boxOf(page, '.el-results');
  expect(list.x).toBeGreaterThanOrEqual(map.x + map.width);
  // Nothing sits over the zoom buttons.
  const zoom = await boxOf(page, '.lm-zoom button[aria-label="Zoom in"]');
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label'), {
    x: zoom.x + zoom.width / 2,
    y: zoom.y + zoom.height / 2
  });
  expect(hit).toBe('Zoom in');
});

test('conflicting local times appear once and cannot export a guessed calendar start', async ({ page }) => {
  await page.route('**/events/locals/v1/cells/*.json*', async route => {
    const response = await route.fetch();
    const cell = await response.json();
    for (const venue of cell.venues) {
      for (const slot of venue.slots) {
        slot.time = '';
        slot.reportedTimes = ['13:00', '14:30'];
      }
    }
    await route.fulfill({ json: cell });
  });
  await openLocator(page);
  const dialog = await filters(page);
  await dialog.getByRole('button', { name: 'Locals' }).click();
  await page.keyboard.press('Escape');
  const locals = page.locator('.el-item', { hasText: 'Weekly local' });
  await expect(locals).toHaveCount(3);
  const first = locals.first();
  await expect(first.locator('.el-time')).toHaveText('Unclear');
  await first.locator('.el-row').click();
  await expect(first.locator('.el-facts')).toContainText('Conflicting times');
  await expect(first.locator('.el-facts')).toContainText('1:00 pm / 2:30 pm');
  await expect(first.getByRole('button', { name: 'Add to calendar' })).toBeDisabled();
});
