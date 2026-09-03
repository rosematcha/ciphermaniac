/**
 * Deterministic route smoke tests.
 *
 * Every byte these render comes from `tests/fixtures/e2e/`, so a failure means
 * the code changed — not that the meta shifted or R2 had a slow morning. That
 * is the whole point: the live suite catches integration breakage but cannot
 * gate a pull request, because half its failures are somebody else's.
 *
 * Scope is deliberately shallow. These assert that each route mounts, reaches
 * its data, and renders the shape of what it promises. Deep behavior belongs in
 * unit tests, where it is cheaper and more precise.
 */

import { expect, test } from '@playwright/test';

/** Fail loudly if a page reaches production R2 — the fixture wiring is broken. */
test.beforeEach(async ({ page }) => {
  await page.route('**://r2.ciphermaniac.com/**', route => {
    throw new Error(`page requested production R2: ${route.request().url()}`);
  });
});

/**
 * Navigate and assert the page mounted without throwing.
 *
 * Deliberately not `networkidle`: the service worker keeps background work
 * going, so that state never arrives and every test would time out at 30s
 * having proven nothing. Waiting for `main` to exist is both faster and a
 * stronger claim — the app actually rendered.
 */
async function gotoClean(page: import('@playwright/test').Page, path: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('main').first().waitFor({ state: 'attached', timeout: 15_000 });
  expect(errors, `uncaught page errors on ${path}`).toEqual([]);
}

test('home renders its meta summary', async ({ page }) => {
  await gotoClean(page, '/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('body')).toContainText(/Ciphermaniac|meta|deck/i);
});

test('cards index lists cards from the fixture master report', async ({ page }) => {
  await gotoClean(page, '/cards');
  // The fixture's top card. If the index rendered from real data this would be
  // whatever is hot today instead.
  await expect(page.locator('body')).toContainText("Boss's Orders");
});

test('a card page renders usage for its card', async ({ page }) => {
  await gotoClean(page, '/cards/MEG/114');
  await expect(page.locator('body')).toContainText("Boss's Orders");
});

test('a variant card URL resolves to its canonical card', async ({ page }) => {
  // TWM/130 is a Dragapult ex reprint; PRE/073 is the cluster's canonical print.
  // The URL does NOT change here, and that is correct: the 301 lives in the edge
  // Function, which `vite preview` does not run, and the SPA's client-side
  // redirect is a fallback that fires only when the master lookup MISSES. The
  // lookup is cluster-aware, so it hits — the user sees the right card either
  // way. The redirect graph itself (terminal, acyclic, idempotent) is covered
  // exhaustively in tests/data/canonical-card-route.test.ts and the edge
  // behavior in tests/api/card-canonical-redirect.test.ts.
  await gotoClean(page, '/cards/TWM/130');
  await expect(page.locator('body')).toContainText('Dragapult ex');

  await gotoClean(page, '/cards/PRE/073');
  await expect(page.locator('body')).toContainText('Dragapult ex');
});

test('archetypes index lists archetypes', async ({ page }) => {
  await gotoClean(page, '/archetypes');
  await expect(page.locator('body')).toContainText('Dragapult');
});

test('an archetype page renders its card list', async ({ page }) => {
  await gotoClean(page, '/archetypes/Dragapult');
  await expect(page.locator('body')).toContainText('Dragapult');
  await expect(page.locator('.card-tile, .card-row, [data-card]').first()).toBeVisible({ timeout: 10_000 });
});

test('trends renders without reaching the network for live data', async ({ page }) => {
  await gotoClean(page, '/trends');
  await expect(page.locator('main')).toBeVisible();
});

test('players index lists the fixture players', async ({ page }) => {
  await gotoClean(page, '/players');
  await expect(page.locator('body')).toContainText(/Gabriel|player/i);
});

test('a player profile renders their tournament history', async ({ page }) => {
  await gotoClean(page, '/players/1272');
  await expect(page.locator('main')).toBeVisible();
});

test('tournaments index renders the catalog', async ({ page }) => {
  await gotoClean(page, '/tournaments');
  await expect(page.locator('main')).toBeVisible();
});

test('the tools index links to the card wall', async ({ page }) => {
  await gotoClean(page, '/tools');
  await expect(page.getByRole('link', { name: /Card Wall/i })).toHaveAttribute('href', '/tools/card-wall');
});

test('the tools index features the tier list and label maker as tiles', async ({ page }) => {
  await gotoClean(page, '/tools');
  const featured = page.locator('.tools-featured .arche');
  await expect(featured).toHaveCount(2);
  await expect(featured.nth(0)).toHaveAttribute('href', '/tools/tier-list');
  await expect(featured.nth(1)).toHaveAttribute('href', '/tools/deck-box-labels');
  // Everything else is a plain row, not a tile.
  await expect(page.locator('.tools-more-item')).toHaveCount(4);
});

test('a tier list tile carries a placeholder until its art paints', async ({ page }) => {
  // Switching view rebuilds every tile, so its art starts from nothing. Holding
  // the thumbnails open is what makes that window observable: `vite preview`
  // runs no /thumbnails Function, so the art has to be served from here anyway.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.route('**/thumbnails/**', async route => {
    await new Promise(resolve => {
      setTimeout(resolve, 700);
    });
    await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
  });
  await gotoClean(page, '/tools/tier-list');
  await page.getByRole('tab', { name: 'Previews', exact: true }).click();
  const art = page.locator('.tl-prev img').first();
  await expect(art).toBeAttached();
  await expect(art).not.toHaveAttribute('data-loaded', '');
  expect(await art.evaluate(el => getComputedStyle(el).animationName)).toBe('skeleton-shimmer');
  // And the placeholder gets out of the way the moment the bitmap lands.
  await expect(art).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  expect(await art.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('hovering the Tools nav item reveals the two headline tools', async ({ page }, testInfo) => {
  // Desktop affordance only — phones get the /tools page instead.
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 640px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-menu');
  await expect(menu).toBeHidden();
  await page.getByRole('link', { name: 'Tools', exact: true }).hover();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Tier List Maker' })).toHaveAttribute('href', '/tools/tier-list');
  await expect(menu.getByRole('link', { name: 'Deck Box Label Maker' })).toHaveAttribute(
    'href',
    '/tools/deck-box-labels'
  );
});

test('the card wall mounts and paints its loop', async ({ page }) => {
  // No card art here: /thumbnails is a Pages Function and `vite preview` does
  // not run one, so every scan 404s and the wall draws its placeholder slots.
  // That is exactly the case worth smoke-testing — the animation loop has to
  // survive missing images rather than divide by a zero-sized tile.
  await gotoClean(page, '/tools/card-wall');
  await expect(page.getByRole('img', { name: /rows of scrolling Pokemon card art/i })).toBeVisible();
  await expect(page.locator('.cw-readout').first()).toContainText(/\d+ frames/);
  await expect(page.locator('.cw-field-label').filter({ hasText: 'Loop' })).toContainText(/\ds/);
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas.width === 0) {
      return null;
    }
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels ? new Set([...pixels.slice(0, 40_000)]).size : null;
  });
  expect(painted, 'the stage should have painted something with more than one value').toBeGreaterThan(1);
});

test('the earnings table re-ranks under each lens', async ({ page }) => {
  // Unlike the routes above, this page's data is a build artifact
  // (static/earnings.json), so it is served by the preview itself rather than
  // the fixture origin. Assertions stay structural — the numbers change every
  // time the scrape is re-run.
  await gotoClean(page, '/tools/earnings');
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  await expect(page.locator('thead th').last()).toHaveText('Career');

  await page.getByRole('tab', { name: 'Top seasons' }).click();
  await expect(page).toHaveURL(/lens=top-seasons/);
  await expect(page.locator('thead th').last()).toHaveText('Top seasons');
  // The top-seasons lens annotates each amount with the season it came from.
  await expect(page.locator('tbody tr').first().locator('.earnings-season')).toBeVisible();
});

test('an earnings row expands into its own breakdown', async ({ page }) => {
  await gotoClean(page, '/tools/earnings?lens=top-seasons');
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  // The per-event file is deliberately not fetched until a row is opened.
  await expect(page.locator('.row-expansion')).toHaveCount(0);

  // Driven by keyboard rather than click: the table header is sticky, so on a
  // short viewport whatever row Playwright scrolls to ends up underneath it and
  // pointer hit-testing fails. The caret is a real button, so this also covers
  // the keyboard path.
  const openRow = async (index: number) => {
    const caret = page.locator('tbody tr.is-link .row-caret').nth(index);
    await caret.focus();
    await page.keyboard.press('Enter');
  };

  await openRow(0);
  await expect(page.locator('.row-expansion')).toHaveCount(1);
  await expect(page.locator('.earnings-breakdown tr').first()).toBeVisible();

  // Opening another row replaces the first — only one panel at a time.
  await openRow(1);
  await expect(page.locator('.row-expansion')).toHaveCount(1);
});

test('social graphics fits long card names inside their cards', async ({ page }, testInfo) => {
  // The canvas is a fixed 1280px desktop composition; the mobile project gets
  // the "built for desktop" note instead, so there is nothing to measure.
  test.skip(testInfo.project.name !== 'desktop', 'canvas only renders on desktop');
  await gotoClean(page, '/tools/social-graphics');
  await page.locator('#sg-canvas').waitFor({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Every name slot is single-line and shrink-to-fit: overflow here means a
  // long name is spilling out of its card or being cut to an ellipsis.
  const overflow = await page.$$eval(
    '#sg-canvas .sg-hero-name, #sg-canvas .sg-row-name, #sg-canvas .sg-cell-name, #sg-canvas .sg-tail-name',
    els =>
      els
        .map(el => ({ name: el.textContent ?? '', over: el.scrollWidth - el.clientWidth }))
        .filter(entry => entry.over > 0)
  );
  expect(overflow, 'card names should be scaled down to fit their slot').toEqual([]);
  await expect(page.locator('#sg-canvas')).toContainText("Lillie's Determination");
});

test('a lazy route whose chunk a deploy removed recovers with one reload', async ({ page }) => {
  // A tab left open across a deploy still asks for the chunks its shell was
  // built with, and the server no longer has them: the stylesheet request
  // fails and Vite's preload helper throws. Simulate that for the first
  // request only, then let the retry through.
  let poisoned = false;
  await page.route('**/assets/SocialGraphicsPage-*.css', async route => {
    if (poisoned) {
      await route.continue();
      return;
    }
    poisoned = true;
    await route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>not found</title>' });
  });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/tools/social-graphics', { waitUntil: 'load' });
  // The reload is what makes the route render at all; without recovery the
  // page stays on its Suspense fallback forever.
  await expect(page.locator('.sg-controls, .sg-warning')).toBeVisible({ timeout: 15_000 });
  expect(poisoned, 'the stale-chunk response should have been served once').toBe(true);
  expect(errors, 'the preload failure should be handled, not thrown').toEqual([]);
});

test('an unknown route renders the not-found page rather than erroring', async ({ page }) => {
  await gotoClean(page, '/this-route-does-not-exist');
  await expect(page.locator('body')).toContainText(/not found|404/i);
});
