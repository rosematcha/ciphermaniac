import { expect, test } from '@playwright/test';
import { sanAntonioLocals, sanAntonioScheduled } from '../__utils__/sanAntonioEvents';

const CENTER = { lat: 29.4928, lon: -98.552, city: 'San Antonio', region: 'Texas', regionCode: 'TX', cc: 'US' };
const locals = sanAntonioLocals();
const scheduledIndex = {
  version: 1,
  generation: 'san-antonio',
  generatedAt: locals.index.updatedAt,
  source: locals.index.source,
  cellDegrees: 5,
  countries: ['US'],
  cells: { '25_-100': sanAntonioScheduled.length },
  total: sanAntonioScheduled.length,
  kinds: { cup: 1, challenge: 3, prerelease: 0, local: 0 }
};

function listing(path: string): unknown {
  if (path === '/events/v1/index.json') {
    return scheduledIndex;
  }
  if (path === '/events/locals/v1/index.json') {
    return locals.index;
  }
  if (path === '/events/locals/v1/cells/25_-100.json') {
    return locals.cells.get('25_-100');
  }
  if (path.endsWith('/places.json')) {
    return { version: 1, cities: [], venues: [] };
  }
  return { version: 1, key: '25_-100', events: sanAntonioScheduled };
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: CENTER.lat, longitude: CENTER.lon });
  await page.clock.setFixedTime(new Date('2026-09-16T17:00:00Z'));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'tile.openstreetmap.org' || request.resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    if (url.hostname === 'photon.komoot.io') {
      return route.fulfill({
        json: { features: [{ properties: { city: 'San Antonio', state: 'Texas', countrycode: 'US' } }] }
      });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`Unexpected network request: ${url.href}`);
    }
    if (url.pathname === '/api/locate') {
      return route.fulfill({ json: { location: CENTER } });
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 503, body: 'Fixture only' });
    }
    // Listings only: /events/locator itself is the page under test.
    if (/^\/events\/(v1|locals)\//.test(url.pathname)) {
      return route.fulfill({ json: listing(url.pathname) });
    }
    return route.continue();
  });
});

test('San Antonio shows venue-local times and scheduled events replace weekly sessions', async ({ page }, testInfo) => {
  await page.goto('/events/locator');
  await expect(page.locator('.el-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Locals', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Filters' })).not.toBeVisible();

  const hive = page.locator('.el-item', { hasText: 'The Pokehive Wonderland Mall' });
  await expect(hive).toHaveCount(3);
  await expect(hive.first().locator('.el-time')).toHaveText('7:30 pm');
  await expect(page.locator('.el-day', { hasText: 'Fri, Sep 18' })).toContainText('The Pokehive Wonderland Mall');

  const cpSunday = page
    .locator('.el-day', { hasText: 'Sun, Sep 20' })
    .locator('.el-item', { hasText: 'Cp Collectibles' });
  await expect(cpSunday).toHaveCount(1);
  await expect(cpSunday.locator('.el-time')).toHaveText('3:00 pm');
  const challengeDay = page.locator('.el-day', { hasText: 'Wed, Sep 23' });
  await expect(challengeDay.locator('.el-item', { hasText: 'Cp Collectibles' })).toHaveCount(1);
  await expect(challengeDay).toContainText('Combat Power League');
  await expect(challengeDay.locator('.el-time')).toHaveText('7:30 pm');

  const time2play = page.locator('.el-item', { hasText: 'Time2Play' });
  await expect(time2play).toHaveCount(3);
  await expect(time2play.first().locator('.el-time')).toHaveText('Unclear');
  await time2play.first().locator('.el-row').click();
  await expect(time2play.first()).toContainText('1:00 pm / 2:30 pm');
  await expect(time2play.first().getByRole('button', { name: 'Add to calendar' })).toBeDisabled();
  await time2play.first().screenshot({ path: testInfo.outputPath('time2play.png'), animations: 'disabled' });
  await challengeDay.screenshot({ path: testInfo.outputPath('combat-power-challenge.png'), animations: 'disabled' });

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Challenges', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.el-day', { hasText: 'Wed, Sep 23' })).toHaveCount(0);
  await expect(page.locator('.el-day', { hasText: 'Wed, Sep 30' })).toContainText('Cp Collectibles');
});
