import { expect, test } from '@playwright/test';

for (const exhausted of [false, true]) {
  test(`card hero ${exhausted ? 'exhausts each fallback once' : 'decodes the first successful fallback'} @mobile`, async ({
    page
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('cm:r2CardImages', '0'));
    const attempts: string[] = [];
    await page.route('**/*', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.resourceType() !== 'image') {
        return route.continue();
      }
      if (/^\/thumbnails\/(lg|sm|xs)\/MEG\/114$/.test(path)) {
        attempts.push(path);
        if (exhausted || path.includes('/lg/')) {
          return route.fulfill({ status: 404, body: '' });
        }
      }
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="274" height="381"/>'
      });
    });
    // The printings strip loads the same xs thumbnail; without reprints it stays out of the count.
    await page.route('**/card-synonyms-slim.json', route =>
      route.fulfill({ json: { synonyms: {}, canonicals: {} }, headers: { 'access-control-allow-origin': '*' } })
    );
    await page.goto('/cards/MEG/114');
    const hero = page.locator('.card-image-real');
    if (exhausted) {
      await expect(hero.locator('.card-image-fallback')).toBeVisible();
      expect(attempts).toEqual(['/thumbnails/lg/MEG/114', '/thumbnails/sm/MEG/114', '/thumbnails/xs/MEG/114']);
    } else {
      const image = hero.locator('img');
      await expect(image).toHaveAttribute('data-loaded', '');
      await expect(image).toHaveAttribute('src', '/thumbnails/sm/MEG/114');
      expect(attempts).toEqual(['/thumbnails/lg/MEG/114', '/thumbnails/sm/MEG/114']);
      expect(await image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
  });
}

test('a printing picked after a late ready marker loads its mirrored art', async ({ page }) => {
  let releaseMarker: () => void = () => {};
  const markerHeld = new Promise<void>(resolve => {
    releaseMarker = resolve;
  });
  await page.route('**/card-images/_ready', async route => {
    await markerHeld;
    await route.fulfill({
      json: { cards: 1, prints: true, unmirrored: [] },
      headers: { 'access-control-allow-origin': '*' }
    });
  });
  await page.route('**/*', route => {
    if (route.request().resourceType() !== 'image') {
      return route.fallback();
    }
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="274" height="381"/>'
    });
  });
  await page.goto('/cards/MEG/114');
  const frames = page.locator('.ps-frame');
  await expect(frames.nth(1)).toBeVisible();
  releaseMarker();
  await page.waitForFunction(() => sessionStorage.getItem('cm:r2CardImages')?.startsWith('{'));
  await frames.nth(1).click();
  const label = (await frames.nth(1).getAttribute('title')) ?? '';
  const [set, number] = label.split(' · ')[0].split(' ');
  await expect(page.locator('.card-image-real img')).toHaveAttribute(
    'src',
    new RegExp(`/card-images/${set}/${set}_0*${number}_R_EN_(LG|SM|XS)\\.webp`, 'i')
  );
});
