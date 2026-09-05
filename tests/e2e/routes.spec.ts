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

test('a player profile only offers decklists that exist', async ({ page }) => {
  await page.route('**/players/1272/profile.json', async route => {
    const response = await route.fetch();
    const profile = (await response.json()) as { tournaments: Array<{ deckId: string | null }> };
    profile.tournaments[0].deckId = null;
    await route.fulfill({ response, json: profile });
  });

  await gotoClean(page, '/players/1272');
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tournament history' }) });
  const rows = history.locator('tbody > tr');

  await expect(history.getByRole('columnheader')).toHaveCount(6);
  await expect(rows.first()).not.toHaveClass(/is-link/);
  await expect(rows.first().getByRole('button', { name: 'Show decklist' })).toHaveCount(0);
  await expect(rows.nth(1).getByRole('button', { name: 'Show decklist' })).toBeVisible();
});

test('a player profile expands a decklist from its caret', async ({ page }) => {
  await gotoClean(page, '/players/1272');
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tournament history' }) });
  const row = history.locator('tbody > tr').first();

  await row.getByRole('button', { name: 'Show decklist' }).click();
  await expect(history.locator('.row-expansion .deck-inline-list li').first()).toBeVisible();

  await row.getByRole('button', { name: 'Hide decklist' }).click();
  await expect(history.locator('.row-expansion')).toHaveCount(0);
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
  // Desktop affordance only — compact headers get the /tools page instead.
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-menu');
  await expect(menu).toBeHidden();
  await page.locator('.topnav').getByRole('link', { name: 'Tools', exact: true }).hover();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Tier List Maker' })).toHaveAttribute('href', '/tools/tier-list');
  await expect(menu.getByRole('link', { name: 'Deck Box Label Maker' })).toHaveAttribute(
    'href',
    '/tools/deck-box-labels'
  );
});

test('a narrow desktop viewport uses the compact two-tier header', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'this covers desktop browsers resized below the header breakpoint');
  await page.setViewportSize({ width: 700, height: 800 });
  await gotoClean(page, '/');

  const header = await page.locator('.topnav').evaluate(nav => {
    const styles = getComputedStyle(nav);
    return {
      gridTemplateAreas: styles.gridTemplateAreas,
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth
    };
  });
  expect(header.gridTemplateAreas).toContain('"links links"');
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
});

test('the footer uses a compact site map without overflowing narrow viewports', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'mobile') {
    await page.setViewportSize({ width: 700, height: 800 });
  }
  await gotoClean(page, '/');

  const footer = await page.locator('.site-footer').evaluate(element => {
    const links = [...element.querySelectorAll('.site-footer-links a')].map(link =>
      Math.round(link.getBoundingClientRect().top)
    );
    const note = element.querySelector('.site-footer-note')!.getBoundingClientRect();
    const toggle = element.querySelector('.chip')!.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      gridTemplateAreas: styles.gridTemplateAreas,
      linkRows: new Set(links).size,
      noteCenter: Math.round(note.top + note.height / 2),
      toggleCenter: Math.round(toggle.top + toggle.height / 2),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    };
  });

  expect(footer.gridTemplateAreas).toContain('"links links"');
  expect(footer.linkRows).toBe(2);
  expect(footer.noteCenter).toBe(footer.toggleCenter);
  expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
});

test('the Tools menu closes once the pointer leaves, even after a click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-menu');
  const tools = page.locator('.topnav').getByRole('link', { name: 'Tools', exact: true });
  await tools.click();
  await expect(page).toHaveURL(/\/tools$/);
  // The clicked anchor still holds DOM focus, so the menu must not be pinned
  // open by it — only hover and keyboard focus may hold it.
  await page.mouse.move(0, 300);
  await expect(menu).toBeHidden();
});

test('keyboard focus opens the Tools menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-menu');
  // Tab in from the neighbouring link: :focus-visible only matches when the
  // browser saw a keyboard interaction, which a bare focus() does not give us.
  const nav = page.locator('.topnav');
  await nav.getByRole('link', { name: 'Players', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Tools', exact: true })).toBeFocused();
  await expect(menu).toBeVisible();
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

test('a tier-list tile always has artwork, even with no sprite to show', async ({ page }) => {
  // Both sprite sources cut off, which is the worst case and the one the
  // fixture run is already in: every chip has to fall through to the committed
  // Substitute doll rather than render an empty box nobody can identify or,
  // with labels off, reliably grab.
  await page.route('**://r2.limitlesstcg.net/**', route => route.abort());
  await gotoClean(page, '/tools/tier-list');

  const tiles = page.locator('.tl-tray .tl-item');
  await expect(tiles.first()).toBeVisible({ timeout: 15_000 });
  const withoutArt = await page.evaluate(
    () => [...document.querySelectorAll('.tl-tray .tl-item')].filter(t => !t.querySelector('img')).length
  );
  expect(withoutArt, 'every tile should carry an icon or the substitute').toBe(0);

  // Labels off is the touch-target case: the chip is only its sprite, so the
  // sprite grows and the chip takes a 44px floor.
  await page.locator('.tl-conf .chip', { hasText: 'Labels' }).click();
  await expect(page.locator('body')).not.toHaveClass(/tl-labels/);
  const smallest = await page.evaluate(() =>
    Math.min(
      ...[...document.querySelectorAll('.tl-tray .tl-ico')].map(chip => {
        const box = chip.getBoundingClientRect();
        return Math.min(box.width, box.height);
      })
    )
  );
  expect(smallest, 'every unlabelled chip should be a 44px target').toBeGreaterThanOrEqual(44);
});

test('a past format ranks its own archetypes and keeps the previews toggle', async ({ page }) => {
  // The past formats are bundled, not fetched, so this needs no fixture. Their
  // snapshot carries the cards each archetype's decklists were built around, so
  // the toggle survives the format change rather than vanishing with it.
  await gotoClean(page, '/tools/tier-list');
  await expect(page.getByRole('tab', { name: 'Previews', exact: true })).toBeVisible();

  await page.locator('.tl-conf select.sel').selectOption('2016');
  await expect(page.getByRole('tab', { name: 'Previews', exact: true })).toBeVisible();
  await expect(page.locator('.tl-tray .tl-item').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tl-tray')).toContainText('Night March');
  expect(new URL(page.url()).searchParams.get('format')).toBe('2016');
});

test('previews survive a format change and draw the cards of the new one', async ({ page }) => {
  await gotoClean(page, '/tools/tier-list');
  await page.getByRole('tab', { name: 'Previews', exact: true }).click();
  await expect(page.locator('.tl-tray .tl-prev').first()).toBeAttached({ timeout: 15_000 });

  await page.locator('.tl-conf select.sel').selectOption('ex');
  // A vintage format's art comes off pokemontcg.io rather than the Limitless
  // CDN, so this is also the check that that source is wired up at all.
  await expect(page.locator('.tl-tray .tl-prev').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('.tl-tray .tl-noart')).toHaveCount(0);
});

test('the card picker is one box: the current card idle, a search once focused', async ({ page }) => {
  // The picker stands for the card being ranked and only becomes a search
  // while it has focus. Closing without choosing has to put the name back, or
  // the toolbar is left with a blank field standing for nothing.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.route('**/thumbnails/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: pixel }));
  await gotoClean(page, '/tools/tier-list');
  await page.getByRole('tab', { name: 'Card arts', exact: true }).click();

  const box = page.locator('.tl-picker input');
  // Richest card first, and its art sits in the field beside the name.
  await expect(box).toHaveValue('Rare Candy');
  await expect(page.locator('.tl-picker .tl-combo-lead img')).toBeAttached();
  await expect(page.locator('.tl-tray .tl-item')).toHaveCount(5);

  await box.focus();
  await expect(box).toHaveValue('');
  const list = page.locator('.tl-picker .tl-list');
  await expect(list.locator('li.cur')).toContainText('Rare Candy');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(box).toHaveValue('Rare Candy');

  // Below the browse floor but above the rank floor: findable by typing only.
  await box.focus();
  await box.fill('swi');
  await list.getByRole('option', { name: /Switch/ }).click();
  await expect(box).toHaveValue('Switch');
  await expect(page.locator('.tl-tray .tl-item')).toHaveCount(4);
});

test('an unknown route renders the not-found page rather than erroring', async ({ page }) => {
  await gotoClean(page, '/this-route-does-not-exist');
  await expect(page.locator('body')).toContainText(/not found|404/i);
});

test('the exported board carries tier names, not the tier controls', async ({ page }) => {
  // The JPG is a rasterise of this very node, so anything on screen at export
  // time lands in the image. The controls sit ON the plate and are merely
  // hover-hidden — which hides nothing on a phone, and phones shipped exports
  // with four buttons where the tier letter belonged.
  await gotoClean(page, '/tools/tier-list');
  const plate = page.locator('.tl-board .tl-plate').first();
  await expect(plate).toBeVisible();

  const shown = await plate.evaluate(el => {
    const board = el.closest('.tl-board') as HTMLElement;
    board.dataset.exporting = '';
    const tools = getComputedStyle(el.querySelector('.tl-tools')!).display;
    const name = getComputedStyle(el.querySelector('.tl-plate-name')!).display;
    delete board.dataset.exporting;
    return { tools, name };
  });
  expect(shown.tools).toBe('none');
  expect(shown.name).not.toBe('none');
});

test.describe('theme', () => {
  // Nothing stored, and an OS asking for dark.
  test.use({ colorScheme: 'dark' });

  test('a first visit follows the system, and the footer toggle overrides it', async ({ page }) => {
    await gotoClean(page, '/tools');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'dark');

    // The button names the mode it switches TO, so in the dark it offers light.
    const toggle = page.locator('.site-footer .chip');
    await expect(toggle).toHaveText('Light mode');
    await toggle.click();
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'light');
    await expect(toggle).toHaveText('Dark mode');

    // A deliberate choice outlives the page, and beats the OS on the next one.
    await gotoClean(page, '/trends');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'light');
    await expect(page.locator('.site-footer .chip')).toHaveText('Dark mode');
  });

  test('the stored mode is on the document before the app boots', async ({ page }) => {
    // The bundle is a module script: waiting for it to set the attribute means
    // showing a dark-mode user a white page first.
    await page.addInitScript(() => localStorage.setItem('cm:mode', 'dark'));
    await page.goto('/tools');
    await page.route('**/*.js', route => route.abort());
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'dark');
  });
});

/**
 * Playwright's device descriptors do not move the hover media queries, and the
 * touch behaviour lives entirely inside one — so it is emulated explicitly.
 */
async function touchOnly(page: import('@playwright/test').Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'hover', value: 'none' },
      { name: 'any-hover', value: 'none' },
      { name: 'pointer', value: 'coarse' }
    ]
  });
}

test('on a touch pointer a tier shows its tools on tap, and hides them again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the touch affordance, on the touch project');
  await touchOnly(page);
  await gotoClean(page, '/tools/tier-list');

  const tools = (nth: number) => page.locator('.tl-plate').nth(nth).locator('.tl-tools');
  await expect(tools(0)).toHaveCSS('opacity', '0');

  await page.locator('.tl-plate').nth(0).tap();
  await expect(tools(0)).toHaveCSS('opacity', '1');
  // One plate at a time, and a tap anywhere else puts them all away.
  await page.locator('.tl-plate').nth(2).tap();
  await expect(tools(0)).toHaveCSS('opacity', '0');
  await expect(tools(2)).toHaveCSS('opacity', '1');
  await page.locator('.tl-tray h4').tap();
  await expect(tools(2)).toHaveCSS('opacity', '0');

  // The tap that reveals must not also press what it reveals: the tools land
  // under the finger, and the click ending that same tap used to hit whichever
  // button was there — deleting the tier the user had only meant to open.
  const names = () => page.locator('.tl-plate-name').allTextContents();
  const before = await names();
  await page.locator('.tl-plate').nth(1).tap();
  expect(await names()).toEqual(before);

  // The second tap does act.
  await page.locator('.tl-plate').nth(1).locator('[data-move$=":-1"]').tap();
  await expect.poll(names).toEqual([before[1], before[0], ...before.slice(2)]);
});

test('on a touch pointer the second tap opens the tier editor, and a rename lands on the plate', async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the touch affordance, on the touch project');
  await touchOnly(page);
  await gotoClean(page, '/tools/tier-list');

  const plate = page.locator('.tl-plate').nth(0);
  const before = await plate.locator('.tl-plate-name').textContent();
  await plate.tap();
  await plate.locator('[data-tier-id]').tap();

  const field = page.locator('.tl-pop input');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(before ?? '');
  await field.fill('Top');
  await expect(plate.locator('.tl-plate-name')).toHaveText('Top');
  // Acting on a tool puts the tools away, so the name is readable again.
  await expect(plate.locator('.tl-tools')).toHaveCSS('opacity', '0');
});

test('on a touch pointer the export is shown on screen rather than navigated to', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the touch affordance, on the touch project');
  // A download link in an in-app browser navigates to the file — the report
  // was "I click the button and the page just reloads itself".
  await touchOnly(page);
  await gotoClean(page, '/tools/tier-list');
  await expect(page.locator('.tl-tray .tl-item').first()).toBeVisible();

  await page.locator('.tl-actions .tl-btn.primary').tap();
  const shot = page.locator('.tl-shot img');
  await expect(shot).toBeVisible({ timeout: 25_000 });
  await expect(shot).toHaveAttribute('src', /^blob:/);
  expect(new URL(page.url()).pathname).toBe('/tools/tier-list');
  // The board is handed back exactly as it was.
  await expect(page.locator('.tl-board')).not.toHaveAttribute('data-exporting');
  expect(await page.locator('.tl-board').evaluate(el => (el as HTMLElement).style.width)).toBe('');

  await page.locator('.tl-shot-bar .tl-btn', { hasText: 'Done' }).tap();
  await expect(page.locator('.tl-shot')).toHaveCount(0);
});
