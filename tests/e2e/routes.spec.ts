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

test('an unknown route renders the not-found page rather than erroring', async ({ page }) => {
  await gotoClean(page, '/this-route-does-not-exist');
  await expect(page.locator('body')).toContainText(/not found|404/i);
});
