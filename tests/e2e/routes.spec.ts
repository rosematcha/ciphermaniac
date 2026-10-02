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

import { expect, type Route, test } from '@playwright/test';

/** Fail loudly if a page reaches production R2 — the fixture wiring is broken. */
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
  await page.route('**://r2.ciphermaniac.com/**', route => {
    throw new Error(`page requested production R2: ${route.request().url()}`);
  });
});

/**
 * Navigate and assert the page mounted without throwing.
 *
 * Deliberately not `networkidle`: a page streaming in hundreds of thumbnails
 * takes seconds to get there, and a test would wait on it having proven
 * nothing. Waiting for `main` to exist is both faster and a
 * stronger claim — the app actually rendered.
 */
async function gotoClean(page: import('@playwright/test').Page, path: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('main').first().waitFor({ state: 'attached', timeout: 15_000 });
  expect(errors, `uncaught page errors on ${path}`).toEqual([]);
}

test('home renders its meta summary @mobile', async ({ page }) => {
  await gotoClean(page, '/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('body')).toContainText(/Ciphermaniac|meta|deck/i);
});

test('home reads the published upcoming schedule without invoking the API @mobile', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.includes('upcoming')) {
      requests.push(path);
    }
  });
  await gotoClean(page, '/');
  await expect(page.getByRole('link', { name: /Regional Championship Toronto/ })).toBeVisible();
  expect(requests).toEqual(['/upcoming.json']);
});

test('cards index lists cards from the fixture master report @mobile', async ({ page }) => {
  await gotoClean(page, '/cards');
  // The fixture's top card. If the index rendered from real data this would be
  // whatever is hot today instead.
  await expect(page.locator('body')).toContainText("Boss's Orders");
});

test('a card page renders usage for its card', async ({ page }) => {
  await gotoClean(page, '/cards/MEG/114');
  await expect(page.locator('body')).toContainText("Boss's Orders");
});

test('card prices deep-link to the selected product through our TCGplayer affiliate account', async ({ page }) => {
  await gotoClean(page, '/cards/MEG/114');
  const price = page.locator('.price-link');
  await expect(price).toHaveText('$0.24 →');
  const target = new URL((await price.getAttribute('href'))!);
  expect(target.origin).toBe('https://partner.tcgplayer.com');
  expect(target.pathname).toBe('/c/6491809/1780961/21018');
  expect(target.searchParams.get('u')).toBe('https://www.tcgplayer.com/product/654453');
  await expect(price).toHaveAttribute('rel', /\bsponsored\b/);
  await expect(price).toHaveAttribute('title', /may earn a commission/);
});

test('prices without a shopping destination remain plain text', async ({ page }) => {
  await page.route('**/prices.json', route =>
    route.fulfill({ json: { cardPrices: { "Boss's Orders::MEG::114": { price: 0.24 } } } })
  );
  await gotoClean(page, '/cards/MEG/114');
  await expect(page.locator('.stat-value--price')).toContainText('$0.24');
  await expect(page.locator('.price-link')).toHaveCount(0);
  await expect(page.locator('.stat-value--price a')).toHaveCount(0);
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

/** Card-sized art: a 1px image under a `274w` srcset descriptor has a natural width of 0. */
const CARD_ART = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="644"/>';

test('card art stays hidden until it has decoded, then shows whole', async ({ page }) => {
  // A streaming image paints top-down and a failed source flashes its alt
  // text; both read as flicker. Holding the art open makes the pending window
  // observable — `vite preview` runs no /thumbnails Function, so the art has to
  // be served from here anyway.
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/thumbnails/**', async route => {
    await held;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: CARD_ART });
  });
  await gotoClean(page, '/cards/MEG/114');
  const hero = page.locator('.card-image-real img');
  await expect(hero).toBeAttached();
  await expect(hero).not.toHaveAttribute('data-loaded', '');
  await expect(hero).toHaveCSS('opacity', '0');
  // Above the fold, so it should not queue behind the printings strip.
  await expect(hero).toHaveAttribute('fetchpriority', 'high');

  release();
  await expect(hero).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  await expect(hero).toHaveCSS('opacity', '1');
});

test('card art already in memory shows at once instead of fading in again', async ({ page }) => {
  await page.route('**/thumbnails/**', route =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: CARD_ART })
  );
  await gotoClean(page, '/cards/MEG/114');
  await expect(page.locator('.card-image-real img')).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  await page.locator('.topnav').getByRole('link', { name: 'Archetypes', exact: true }).first().click();
  await expect(page.locator('.card-image-real')).toHaveCount(0);

  // Mutation callbacks run before the next paint, so whatever they see is
  // what the first frame of the returning hero would show.
  await page.evaluate(() => {
    const seen: (boolean | null)[] = [];
    (window as unknown as { heroSeen: typeof seen }).heroSeen = seen;
    new MutationObserver(() => {
      const hero = document.querySelector('.card-image-real img');
      if (hero && seen.length === 0) {
        seen.push(hero.hasAttribute('data-loaded'));
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.goBack();
  await expect(page.locator('.card-image-real img')).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as { heroSeen: boolean[] }).heroSeen)).toEqual([true]);
});

test('reused card art hides a failed source instead of showing it @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'quick rank is the phone layout, on the phone project');
  // Quick rank keeps one <img> and hands it the next card. When that card's
  // first source fails, the element drops the old art for a broken image, so
  // it has to go back to hidden until the retry lands. The tray requests the
  // same URLs, so every request is held until the test decides it: otherwise
  // the next card is already cached and nothing fails.
  type Verdict = 'serve' | 'fail';
  const held = new Map<string, Route[]>();
  const verdicts = new Map<string, Verdict>();
  const settle = (route: Route, verdict: Verdict) =>
    route.fulfill(
      verdict === 'serve' ? { status: 200, contentType: 'image/svg+xml', body: CARD_ART } : { status: 404, body: '' }
    );
  const decide = async (path: string, verdict: Verdict) => {
    verdicts.set(path, verdict);
    await Promise.all((held.get(path) ?? []).map(route => settle(route, verdict)));
    held.delete(path);
  };
  await page.route('**/thumbnails/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const verdict = verdicts.get(path);
    if (verdict) {
      await settle(route, verdict);
    } else {
      held.set(path, [...(held.get(path) ?? []), route]);
    }
  });
  await gotoClean(page, '/tools/tier-list');
  await page.getByRole('tab', { name: 'Card arts', exact: true }).click();
  await page.locator('.tl-rank').tap();
  const face = page.locator('.tl-queue .tl-qface img');
  await decide((await face.getAttribute('src'))!, 'serve');
  await expect(face).toHaveAttribute('data-loaded', '', { timeout: 10_000 });

  const first = await face.getAttribute('src');
  await page.locator('.tl-queue .tl-skip').tap();
  await expect(face).not.toHaveAttribute('src', first!);
  // Its first source fails; the XS retry stays held open.
  await decide((await face.getAttribute('src'))!, 'fail');
  await expect(face).toHaveAttribute('src', /\/thumbnails\/xs\//);
  await expect(face).not.toHaveAttribute('data-loaded', '');
  await expect(face).toHaveCSS('opacity', '0');
});

test('archetypes index lists archetypes @mobile', async ({ page }) => {
  const icons = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith('/assets/aaaaaaaaaaaa/archetype-icons.json')
  );
  await gotoClean(page, '/archetypes');
  expect((await icons).ok()).toBe(true);
  await expect(page.locator('body')).toContainText('Dragapult');
});

test('archetype thumbnails take the smallest tier that covers their slot', async ({ page }) => {
  // Fixed tiers had home's stories fetch SM and its archetype tiles XS of the
  // same art. With a `sizes` hint both resolve to XS at 1x, so it is one file.
  // Served art, or the srcset pick fails over to the XS retry and proves nothing.
  await page.route('**/thumbnails/**', route =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: CARD_ART })
  );
  await gotoClean(page, '/archetypes');
  const art = page.locator('.arche-thumb img').first();
  await expect(art).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  expect(await art.evaluate(el => (el as HTMLImageElement).currentSrc)).toMatch(/\/thumbnails\/xs\//);
});

test('an archetype page renders its card list', async ({ page }) => {
  await gotoClean(page, '/archetypes/Dragapult');
  await expect(page.locator('body')).toContainText('Dragapult');
  await expect(page.locator('.card-tile, .card-row, [data-card]').first()).toBeVisible({ timeout: 10_000 });
});

test('a scope deep link loads the selected tournament', async ({ page }) => {
  await gotoClean(page, '/archetypes?scope=2026-06-12-international-championship-new-orleans');
  await expect(page.locator('body')).toContainText('Event Dragapult');
});

test('the tournament selector writes scope history and omits the default', async ({ page }) => {
  await gotoClean(page, '/archetypes');
  await page.locator('.t-selector-trigger').click();
  await page.getByRole('button', { name: /New Orleans Internationals/ }).click();
  await expect(page).toHaveURL(/scope=2026-06-12-international-championship-new-orleans/);

  await page.locator('.t-selector-trigger').click();
  await page.getByRole('button', { name: /Online events/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('scope')).toBe(false);
});

test('a legacy archetype tournament link is adopted and rewritten', async ({ page }) => {
  const event = '2026-06-12, International Championship New Orleans';
  await gotoClean(page, `/archetypes/Dragapult?tour=${encodeURIComponent(event)}`);
  await expect(page.locator('body')).toContainText('Dragapult ex');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('scope'))
    .toBe('2026-06-12-international-championship-new-orleans');
  expect(new URL(page.url()).searchParams.has('tour')).toBe(false);
});

test('archetype matchups show ranges for rows and the card lens', async ({ page }) => {
  await gotoClean(page, '/archetypes/Dragapult?tab=matchups');
  await expect(page.locator('.mu-gauge[title^="95% interval"]').first()).toBeVisible();

  await page.getByText('Compare with a specific card').click();
  await page.getByRole('button', { name: /Unfair Stamp/ }).click();
  await expect(page.locator('.r2-lens-hint')).toContainText('95% interval');
});

/** Hold every request matching `pattern` until the returned release is called. */
async function holdRequests(page: import('@playwright/test').Page, pattern: string): Promise<() => Promise<void>> {
  const held: Route[] = [];
  let released = false;
  await page.route(pattern, route => (released ? route.continue() : void held.push(route)));
  return async () => {
    released = true;
    await Promise.all(held.splice(0).map(route => route.continue()));
  };
}

/**
 * Scroll the archetype tabs up under the sticky nav and open `tab`. Returns the
 * scroll offset the switch has to keep.
 */
async function openArchetypeTab(page: import('@playwright/test').Page, tab: string): Promise<number> {
  // Short enough that a panel's loading state still leaves room for the
  // offset; a page collapsed to the app fallback does not, and clamps it.
  await page.setViewportSize({ width: 1280, height: 480 });
  await expect(page.locator('.card-tile, .card-row, [data-card]').first()).toBeVisible({ timeout: 10_000 });
  const scrollY = await page.evaluate(() => {
    // Clear of the nav, or the click would scroll the tab out from under it.
    const navBottom = document.querySelector('.topnav')!.getBoundingClientRect().bottom;
    const toolbar = document.querySelector('.arche-toolbar')!;
    window.scrollTo(0, toolbar.getBoundingClientRect().top + window.scrollY - navBottom - 8);
    return window.scrollY;
  });
  expect(scrollY, 'the hero should push the tabs below the fold').toBeGreaterThan(0);
  await page.getByRole('tab', { name: tab, exact: true }).click();
  return scrollY;
}

/** The page shell stayed mounted: a page-wide fallback would replace the hero. */
async function expectShellKept(page: import('@playwright/test').Page, scrollY: number): Promise<void> {
  await expect(page.locator('.arche-title')).toBeAttached();
  await expect(page.locator('.error-fallback')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
}

test('the Filters tab loads its decks under its own skeleton, keeping the page and scroll', async ({ page }) => {
  const release = await holdRequests(page, '**/archetypes/Dragapult/decks.json');
  await gotoClean(page, '/archetypes/Dragapult');
  const scrollY = await openArchetypeTab(page, 'Filters');

  await expect(page.locator('.advanced-panel .skeleton')).toBeVisible();
  await expect(page.locator('.advanced-panel')).toContainText('Loading deck data');
  await expectShellKept(page, scrollY);

  await release();
  await expect(page.locator('.fb-count b')).toBeVisible();
  await expect(page.locator('.advanced-panel .skeleton')).toHaveCount(0);
});

test('a failed deck fetch costs the Filters tab, not the page', async ({ page }) => {
  await page.route('**/archetypes/Dragapult/decks.json', route => route.fulfill({ status: 500, body: '' }));
  await gotoClean(page, '/archetypes/Dragapult');
  const scrollY = await openArchetypeTab(page, 'Filters');

  await expect(page.locator('.advanced-panel')).toContainText('Decks unavailable for this archetype.');
  await expectShellKept(page, scrollY);
});

test('the Matchups tab loads under its own skeleton, keeping the page and scroll', async ({ page }) => {
  const releaseProfiles = await holdRequests(page, '**/matchupProfiles.json');
  const releaseTrends = await holdRequests(page, '**/archetypes/Dragapult/trends.json');
  await gotoClean(page, '/archetypes/Dragapult');
  const scrollY = await openArchetypeTab(page, 'Matchups');

  await expect(page.locator('.matchups > .skeleton')).toBeVisible();
  await expectShellKept(page, scrollY);

  await releaseProfiles();
  await releaseTrends();
  await expect(page.locator('.mu-gauge[title^="95% interval"]').first()).toBeVisible();
});

test('a failed card-lens fetch settles the lens instead of the page', async ({ page }) => {
  await page.route('**/archetypes/Dragapult/decks.json', route => route.fulfill({ status: 500, body: '' }));
  await gotoClean(page, '/archetypes/Dragapult?tab=matchups');
  await expect(page.locator('.mu-gauge').first()).toBeVisible();

  await page.getByText('Compare with a specific card').click();
  await page.getByRole('button', { name: /Unfair Stamp/ }).click();
  await expect(page.getByText('Not enough games to compare.')).toBeVisible();
  await expect(page.getByText('Loading match data…')).toHaveCount(0);
  await expect(page.locator('.error-fallback')).toHaveCount(0);
});

test('trends renders its chart and preserves vertical touch scrolling @mobile', async ({ page }) => {
  await page.route('**/trends.json', route =>
    route.fulfill({
      json: {
        trendReport: {
          series: [
            {
              base: 'Dragapult',
              displayName: 'Dragapult',
              avgShare: 25,
              timeline: [
                { date: '2026-09-01', share: 20 },
                { date: '2026-09-02', share: 30 }
              ]
            }
          ]
        },
        cardTrends: { rising: [], falling: [] }
      }
    })
  );
  await gotoClean(page, '/trends');
  const chart = page.locator('.trend-chart');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveCSS('display', 'block');
  await expect(chart).toHaveCSS('touch-action', 'pan-y');
  await expect(page.locator('.trends-chart-card')).toHaveCSS('border-top-width', '1px');
});

test('players index ranks the fixture players with a rank switch', async ({ page }) => {
  await gotoClean(page, '/players');
  await expect(page.locator('body')).toContainText(/Gabriel|player/i);
  const bar = page.locator('.players-bar');
  await expect(bar.getByRole('tab', { name: 'Day 2s' })).toHaveAttribute('aria-selected', 'true');
  // Rank, player, events, Day 2s, top cuts, titles, win rate. The last two are
  // hidden by CSS below 900px, so the mobile project counts the same seven.
  await expect(page.locator('.players-table thead th')).toHaveCount(7);

  await bar.getByRole('tab', { name: 'Win %' }).click();
  await expect(page).toHaveURL(/sort=winPct/);
  await expect(page.locator('.players-table th[aria-sort="descending"]')).toHaveText(/Win %/);
});

test('a player profile renders their history as the first tab @mobile', async ({ page }) => {
  await gotoClean(page, '/players/1272');
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.history-table thead th')).toHaveCount(6);
  await expect(page.locator('.history-table tbody > tr').first()).toContainText('New Orleans');
});

test('an opened event switches between its decklist and its rounds', async ({ page }) => {
  await gotoClean(page, '/players/1272');
  // The caret is desktop chrome; the row itself is the toggle at every width.
  const row = page.locator('.history-table tbody > tr').first();

  await row.locator('.history-name').click();
  const detail = page.locator('.row-expansion .event-detail');
  await expect(detail.getByRole('tab', { name: 'Decklist' })).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.deck-inline-list li').first()).toBeVisible();

  await detail.getByRole('tab', { name: 'Rounds' }).click();
  await expect(detail.locator('.round').first()).toContainText('R1');
  await expect(detail.locator('.rounds-drop')).toContainText('Dropped after round 7');

  await row.locator('.history-name').click();
  await expect(page.locator('.row-expansion')).toHaveCount(0);
});

test('an event without a decklist opens on its rounds', async ({ page }) => {
  await page.route('**/players/aaaaaaaaaaaa/1272/profile.json', async route => {
    const response = await route.fetch();
    const profile = (await response.json()) as { tournaments: Array<{ deckId: string | null }> };
    profile.tournaments[0].deckId = null;
    await route.fulfill({ response, json: profile });
  });

  await gotoClean(page, '/players/1272');
  await page.locator('.history-table tbody > tr').first().locator('.history-name').click();
  const detail = page.locator('.row-expansion .event-detail');
  await expect(detail.getByRole('tab', { name: 'Rounds' })).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.round').first()).toBeVisible();
});

test('Chris Franco has a shout-out in the Orlando event details', async ({ page }) => {
  await page.route('**/players/aaaaaaaaaaaa/2037/profile.json', async route => {
    const response = await route.fetch({ url: route.request().url().replace('/2037/', '/999/') });
    await route.fulfill({ response });
  });

  await gotoClean(page, '/players/2037');
  const row = page.locator('.history-table tbody > tr').filter({ hasText: 'Orlando' });
  await row.locator('.history-name').click();
  await expect(page.getByRole('link', { name: "Anyone you'd like to shout out?" })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=SpkkypxnGTs&t=13369s'
  );
});

test('the Decks tab groups events under their deck', async ({ page }) => {
  await gotoClean(page, '/players/1272?tab=decks');
  await expect(page.getByRole('tab', { name: 'Decks' })).toHaveAttribute('aria-selected', 'true');
  const groups = page.locator('.deck-group');
  await expect(groups.first()).toHaveClass(/open/);
  await expect(groups.first().locator('.history-table tbody > tr').first()).toBeVisible();
});

test('a profile cached before rounds existed still renders', async ({ page }) => {
  // R2 serves profile bodies for six hours, so a visitor can land on one written
  // before the aggregator started emitting `rounds`.
  await page.route('**/players/aaaaaaaaaaaa/1272/profile.json', async route => {
    const response = await route.fetch();
    const profile = (await response.json()) as Record<string, unknown>;
    delete profile.rounds;
    await route.fulfill({ response, json: profile });
  });

  await gotoClean(page, '/players/1272?tab=matchups');
  await expect(page.getByRole('heading', { name: /No round data/ })).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('.history-table tbody > tr').first().getByRole('button', { name: 'Show details' }).click();
  const detail = page.locator('.row-expansion .event-detail');
  await detail.getByRole('tab', { name: 'Rounds' }).click();
  await expect(detail.getByText('No round data published for this event.')).toBeVisible();
});

test('the Matchups tab rolls the rounds up', async ({ page }) => {
  await gotoClean(page, '/players/1272?tab=matchups');
  await expect(page.getByRole('heading', { name: /Decks faced/ })).toBeVisible();
  // The phase splits lead the tab as a ruled band: label, rate, record.
  await expect(page.locator('.phase-band .phase-figure').first()).toContainText('Day 1');
});

test('career matchup records survive switching profile tabs', async ({ page }) => {
  await gotoClean(page, '/players/1272?tab=matchups');
  const table = page.locator('.matchup-table');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  const records = await table.innerText();
  const phases = await page.locator('.phase-band').innerText();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByRole('tab', { name: 'Decks', exact: true }).click();
  await page.getByRole('tab', { name: 'Matchups', exact: true }).click();
  await expect(table).toHaveText(records, { useInnerText: true });
  await expect(page.locator('.phase-band')).toHaveText(phases, { useInnerText: true });
});

test('missing rounds do not wait for the lazy decklist request', async ({ page }) => {
  await page.route('**/players/aaaaaaaaaaaa/1272/profile.json', async route => {
    const response = await route.fetch();
    const profile = (await response.json()) as Record<string, unknown>;
    delete profile.rounds;
    await route.fulfill({ response, json: profile });
  });
  let releaseDecks: () => void = () => undefined;
  const decksReady = new Promise<void>(resolve => {
    releaseDecks = resolve;
  });
  await page.route('**/players/aaaaaaaaaaaa/1272/decks.json', async route => {
    await decksReady;
    await route.continue();
  });
  try {
    await gotoClean(page, '/players/1272');
    await page.locator('.history-table tbody > tr').first().locator('.history-name').click();
    const detail = page.locator('.row-expansion .event-detail');
    await expect(detail.locator('.skeleton')).toBeVisible();
    await detail.getByRole('tab', { name: 'Rounds' }).click();
    await expect(detail.getByText('No round data published for this event.')).toBeVisible();
    await expect(detail.locator('.skeleton')).toHaveCount(0);
  } finally {
    releaseDecks();
  }
});

test('compare pairs two players on the events they both attended', async ({ page }) => {
  await gotoClean(page, '/players/compare?a=1272&b=999');

  const shared = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Shared events' }) });
  // Four events in common; Gabriel finished higher at three of them.
  await expect(shared.locator('tbody > tr')).toHaveCount(4);
  await expect(shared.locator('.compare-h2h')).toContainText('3-1');
  // The event column carries its own date, so there is no separate date column.
  // Counted in the DOM rather than by role: a phone hides the two deck columns,
  // and a hidden cell has no columnheader role.
  await expect(shared.locator('thead th')).toHaveCount(5);
});

test('compare asks for two players before it compares anything', async ({ page }) => {
  await gotoClean(page, '/players/compare');
  await expect(page.getByText('Choose two players.')).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(2);
});

test('tournaments index renders the catalog @mobile', async ({ page }) => {
  await gotoClean(page, '/events/majors');
  await expect(page.locator('main')).toBeVisible();
});

test('old tournaments and events paths redirect, keeping their query', async ({ page }) => {
  await gotoClean(page, '/tournaments?from=home');
  await expect(page).toHaveURL(/\/events\/majors\?from=home$/);
  await gotoClean(page, '/events?r=25');
  await expect(page).toHaveURL(/\/events\/locator\?r=25$/);
});

test('the events tab opens a menu of majors and the locator', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/events/majors');
  const tab = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Events', exact: true });
  await expect(tab).toHaveAttribute('href', '/events/locator');
  await expect(tab).toHaveClass(/active/);
  await tab.hover();
  await expect(page.getByRole('link', { name: 'Major Events' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Event Locator' })).toHaveAttribute('href', '/events/locator');
});

test('the tools index links to the card wall', async ({ page }) => {
  await gotoClean(page, '/tools');
  await expect(page.getByRole('link', { name: /Card Wall/i })).toHaveAttribute('href', '/tools/card-wall');
});

test('the tools index features the tier list, label maker and pack EV as tiles @mobile', async ({ page }) => {
  await gotoClean(page, '/tools');
  const featured = page.locator('.tools-featured .arche');
  await expect(featured).toHaveCount(3);
  await expect(featured.nth(0)).toHaveAttribute('href', '/tools/tier-list');
  await expect(featured.nth(1)).toHaveAttribute('href', '/tools/deck-box-labels');
  await expect(featured.nth(2)).toHaveAttribute('href', '/tools/pack-ev');
  // Everything else is a plain row, not a tile.
  await expect(page.locator('.tools-more-item')).toHaveCount(6);
  await expect(page.locator('.tools-more-item', { hasText: 'Run an Event' })).toHaveAttribute('href', '/host');
  await expect(page.locator('.tools-more-item', { hasText: 'Set Impact' })).toHaveAttribute(
    'href',
    '/tools/set-impact'
  );
});

test('set impact ranks sets by lifetime and keeps its toggles in the URL', async ({ page }) => {
  await gotoClean(page, '/tools/set-impact');
  const rows = page.locator('.set-impact-table tbody tr');
  await expect(rows.first()).toBeVisible();
  // Ranked sets lead in order; sets seen at too few majors follow, greyed.
  const lifetimes = await page.locator('tr:not(.is-unranked) .set-impact-value').allTextContents();
  const values = lifetimes.map(Number);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await expect(page.locator('tr.is-unranked').first()).toBeVisible();
  const last = page.locator('.set-impact-table tbody tr.is-link').last();
  await expect(last).toHaveClass(/is-unranked/);
  await page.getByRole('tab', { name: 'Keeps it legal' }).click();
  await expect(page).toHaveURL(/[?&]attr=legal/);
  await page.getByRole('button', { name: /^Set/ }).click();
  const names = await page.locator('td.set-impact-name').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test('set impact explains its figures without sorting on a tap', async ({ page }) => {
  await gotoClean(page, '/tools/set-impact');
  const tip = page.locator('th .info-tip:visible').first();
  await tip.click();
  await expect(tip.locator('.info-tip-bubble')).toBeVisible();
  await expect(page.locator('th[aria-sort="descending"]')).toHaveClass(/set-impact-lifetime/);
});

test('set impact opens a picked set in the panel @mobile', async ({ page }) => {
  await gotoClean(page, '/tools/set-impact');
  const panel = page.locator('.set-impact-panel:visible, .set-impact-inline:visible').first();
  const first = await page.locator('.set-impact-pick').first().textContent();
  await expect(panel.locator('h2')).toContainText((first ?? '').trim().split(/\s+[A-Z0-9]{2,4}$/)[0]);
  const third = page.locator('.set-impact-pick').nth(2);
  const name = ((await third.textContent()) ?? '').trim();
  await third.click();
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.set-impact-panel:visible h2, .set-impact-inline:visible h2').first()).toContainText(
    name.replace(/\s+[A-Z0-9]{2,4}$/, '')
  );
  await expect(page.locator('.set-impact-card:visible').first()).toBeVisible();
});

test('pack EV sets a pack opened against a pack sealed, and opens packs @mobile', async ({ page }) => {
  await gotoClean(page, '/tools/pack-ev');
  // Nothing is open until a set is picked.
  await expect(page.locator('.packev-band')).toHaveCount(0);
  await page.locator('.packev-index tbody tr').first().click();
  const band = page.locator('.packev-band').first();
  // Fixture: a trimmed Twilight Masquerade, whose $9.09 single undercuts the box's $9.89 a pack.
  await expect(band).toContainText('$9.09');
  await expect(page.locator('main')).toContainText('Pinsir');
  await page.getByRole('button', { name: 'Open a box' }).click();
  const opener = page.locator('.packev-opener');
  await expect(opener.locator('.packev-band')).toContainText('36');
  // Thirty-six singles, not the $356.09 box.
  await expect(opener.locator('.packev-band')).toContainText('$327.24');
  // Eleven cards a pack land somewhere: stacked as hits, or in the bulk pile.
  await expect(opener.locator('.packev-bulk summary')).toContainText(/\d+ cards/);
  await opener.locator('.packev-bulk summary').click();
  await expect(opener.locator('.packev-grid.is-tiny .packev-tile').first()).toBeVisible();
});

test('pack EV warms hit art before a rip, at the URLs the hit tiles request', async ({ page }) => {
  const warmed: string[] = [];
  await page.route('https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/**', route => {
    warmed.push(route.request().url());
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    });
  });
  await gotoClean(page, '/tools/pack-ev');
  await page.locator('.packev-index tbody tr').first().click();
  const opener = page.locator('.packev-opener');
  await opener.scrollIntoViewIfNeeded();
  await expect.poll(() => warmed.length).toBeGreaterThan(0);
  expect(warmed.every(url => url.endsWith('_R_EN_SM.png'))).toBe(true);

  await page.getByRole('button', { name: 'Open a case' }).click();
  const hitArt = opener.locator('.packev-grid:not(.is-tiny) img');
  await expect(hitArt.first()).toBeVisible();
  const sources = await hitArt.evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
  expect(sources.filter(source => !warmed.includes(source))).toEqual([]);
});

test('a tier list tile carries a placeholder until its art paints @mobile', async ({ page }) => {
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
  // The shimmer is painted on the image, so pending art here must stay visible.
  await expect(art).toHaveCSS('opacity', '1');
  // And the placeholder gets out of the way the moment the bitmap lands.
  await expect(art).toHaveAttribute('data-loaded', '', { timeout: 10_000 });
  expect(await art.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('hovering the Tools nav item reveals the headline tools, the tier list first', async ({ page }, testInfo) => {
  // Desktop affordance only — compact headers get the /tools page instead.
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-item', { has: page.locator('a[href="/tools"]') }).locator('.topnav-menu');
  await expect(menu).toBeHidden();
  await page.locator('.topnav').getByRole('link', { name: 'Tools', exact: true }).hover();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link').first()).toHaveText('Tier List Maker');
  await expect(menu.getByRole('link', { name: 'Tier List Maker' })).toHaveAttribute('href', '/tools/tier-list');
  await expect(menu.getByRole('link', { name: 'Deck Box Label Maker' })).toHaveAttribute(
    'href',
    '/tools/deck-box-labels'
  );
  await expect(menu.getByRole('link', { name: 'Pack EV' })).toHaveAttribute('href', '/tools/pack-ev');
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

test('the top archetypes grid stops at two rows @mobile', async ({ page }) => {
  await gotoClean(page, '/');
  const grid = page.locator('.top-archetypes .gallery-grid');
  await expect(grid.locator('.arche:not(.arche-skeleton)').first()).toBeVisible();

  const layout = await grid.evaluate(element => {
    const shown = [...element.children].filter(child => child.getClientRects().length > 0);
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      rendered: element.children.length,
      shown: shown.length,
      rows: new Set(shown.map(card => Math.round(card.getBoundingClientRect().top))).size
    };
  });
  expect(layout.rows).toBeLessThanOrEqual(2);
  expect(layout.shown).toBe(Math.min(layout.rendered, layout.columns * 2));
});

test('the footer keeps its links on their own row without overflowing narrow viewports @mobile', async ({
  page
}, testInfo) => {
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
  expect(footer.linkRows).toBe(1);
  expect(footer.noteCenter).toBe(footer.toggleCenter);
  expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
});

test('the footer spans the page column instead of shrinking to its content @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'the wide row only exists above 900px');
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoClean(page, '/about');

  const widths = await page.evaluate(() => ({
    page: Math.round(document.querySelector('main.page')!.getBoundingClientRect().width),
    footer: Math.round(document.querySelector('.site-footer')!.getBoundingClientRect().width)
  }));
  expect(widths.footer).toBe(widths.page);
});

test('short pages fill one viewport without adding empty scroll space @mobile', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ['/feedback', '/not-a-real-route']) {
      await gotoClean(page, path);
      const footer = page.locator('.site-footer');
      await expect(footer).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
      await expect
        .poll(() => footer.evaluate(element => Math.round(element.getBoundingClientRect().bottom)))
        .toBe(viewport.height);
    }
  }
});

test('the Tools menu closes once the pointer leaves, even after a click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'the nav menu is hidden below 900px');
  await gotoClean(page, '/');
  const menu = page.locator('.topnav-item', { has: page.locator('a[href="/tools"]') }).locator('.topnav-menu');
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
  const menu = page.locator('.topnav-item', { has: page.locator('a[href="/tools"]') }).locator('.topnav-menu');
  // Shift-Tab back from the search box: :focus-visible only matches when the
  // browser saw a keyboard interaction, which a bare focus() does not give us.
  // Not forward from Events: whether a bare focus() opens its own menu varies
  // by browser build, and an open menu takes the next Tab.
  const nav = page.locator('.topnav');
  await page.locator('.gsearch-input').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(nav.getByRole('link', { name: 'Tools', exact: true })).toBeFocused();
  await expect(menu).toBeVisible();
});

test('the card wall mounts and paints its loop @mobile', async ({ page }) => {
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

test('social graphics fits long card names inside their cards @mobile', async ({ page }, testInfo) => {
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

test('a tier-list tile always has artwork, even with no sprite to show @mobile', async ({ page }) => {
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
  // Every format now comes from the fetched snapshot, so this reads the fixture's
  // own past format rather than a bundled one. Its archetypes carry the cards
  // their decklists were built around, so the toggle survives the format change
  // rather than vanishing with it.
  await gotoClean(page, '/tools/tier-list');
  await expect(page.getByRole('tab', { name: 'Previews', exact: true })).toBeVisible();

  await page.locator('.tl-conf select.sel').selectOption('ex');
  await expect(page.getByRole('tab', { name: 'Previews', exact: true })).toBeVisible();
  await expect(page.locator('.tl-tray .tl-item').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tl-tray')).toContainText('Synthetic Vintage Deck');
  expect(new URL(page.url()).searchParams.get('format')).toBe('ex');
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

  test('a first visit follows the system, and the footer toggle overrides it @mobile', async ({ page }) => {
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
    // Let the route chunk land first: aborting it mid-load fires the preload
    // recovery, whose own reload races this one and detaches the frame.
    await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible();
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

test('on a touch pointer a tier shows its tools on tap, and hides them again @mobile', async ({ page }, testInfo) => {
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
  // The hero, not the tray heading: on a phone the tray is docked and its
  // heading carries the handle that stands the dock up, so a tap there is a
  // tap on something rather than the "anywhere else" this is asserting.
  await page.locator('.hero h1').tap();
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

test('on a touch pointer the second tap opens the tier editor, and a rename lands on the plate @mobile', async ({
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

test('on a touch pointer the export is shown on screen rather than navigated to @mobile', async ({
  page
}, testInfo) => {
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

/* ---------------------------------------------------------------------------
   The phone layout of the tier list.

   Under 720px the tray leaves the flow and docks to the bottom edge, the three
   actions ride the dock, and a tap on a tile followed by a tap on a tier does
   what a drag does. The layout it replaced put the tray 470px below the board
   and ran it for 1,100px, which made the page's only interaction a drag across
   most of a 2,200px document with the target off screen for most of it.
   --------------------------------------------------------------------------- */

test('on a phone the tray docks to the bottom edge and carries the actions @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the phone layout, on the phone project');
  await gotoClean(page, '/tools/tier-list');
  await expect(page.locator('.tl-tray .tl-item').first()).toBeVisible();

  const tray = page.locator('.tl-tray');
  await expect(tray).toHaveCSS('position', 'fixed');
  // Reset/Share/Export are on the dock, not eight hundred pixels below it.
  await expect(page.locator('.tl-dockbar .tl-actions .tl-btn')).toHaveCount(3);
  await expect(page.locator('.tl-conf .tl-actions')).toHaveCount(0);

  // The dock rests at two rows of the pile and stands up to show the rest.
  const height = async () => (await tray.boundingBox())!.height;
  const resting = await height();
  await page.locator('.tl-grip').tap();
  await expect.poll(height).toBeGreaterThan(resting);
  await page.locator('.tl-grip').tap();
  await expect.poll(height).toBe(resting);
});

test('on a phone a tap picks a tile up and a tap on a tier places it @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the phone layout, on the phone project');
  await gotoClean(page, '/tools/tier-list');
  const tile = page.locator('.tl-tray .tl-item').first();
  await expect(tile).toBeVisible();
  const name = await tile.locator('.cap').textContent();
  const unranked = page.locator('.tl-tray h4 span').first();
  const before = Number(await unranked.textContent());

  await tile.tap();
  // The dock says what is held, in the slot the actions were using.
  await expect(page.locator('.tl-dockbar')).toContainText(`Place ${name} in a tier`);
  await expect(tile).toHaveClass(/tl-held/);

  const second = page.locator('.tl-board .tl-row[data-row]').nth(1);
  await second.tap();
  await expect(second.locator('.tl-item')).toHaveCount(1);
  await expect(unranked).toHaveText(String(before - 1));
  // Nothing is held afterwards, so the actions come back.
  await expect(page.locator('.tl-dockbar .tl-actions .tl-btn')).toHaveCount(3);

  // Tapping the held tile again puts it down rather than placing it twice.
  const next = page.locator('.tl-tray .tl-item').first();
  await next.tap();
  await next.tap();
  await expect(page.locator('.tl-dockbar .tl-actions .tl-btn')).toHaveCount(3);
  await expect(unranked).toHaveText(String(before - 1));
});

test('on a phone quick rank empties the pile one archetype at a time @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the phone layout, on the phone project');
  await gotoClean(page, '/tools/tier-list');
  await expect(page.locator('.tl-tray .tl-item').first()).toBeVisible();
  const unranked = page.locator('.tl-tray h4 span').first();
  const before = Number(await unranked.textContent());

  await page.locator('.tl-rank').tap();
  const queue = page.locator('.tl-queue');
  await expect(queue).toBeVisible();
  await expect(queue.locator('.tl-qhead span')).toHaveText(`${before} left`);

  // Skip rotates the pile rather than dropping anything out of it.
  const first = await queue.locator('.tl-qface b').textContent();
  await queue.locator('.tl-skip').tap();
  await expect(queue.locator('.tl-qface b')).not.toHaveText(first ?? '');
  await expect(queue.locator('.tl-qhead span')).toHaveText(`${before} left`);

  await queue.locator('.tl-platebtn').first().tap();
  await expect(queue.locator('.tl-qhead span')).toHaveText(`${before - 1} left`);
  await expect(unranked).toHaveText(String(before - 1));

  await queue.getByRole('button', { name: 'Done' }).tap();
  await expect(queue).toHaveCount(0);
  await expect(page.locator('.tl-board .tl-row[data-row]').first().locator('.tl-item')).toHaveCount(1);
});

test('on a desktop a click on a tile is not a placement', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the pointer that drags, on the desktop project');
  // Tap-to-place exists because dragging on a phone is expensive. With a mouse
  // it would mean a stray click arms a placement the user never asked for.
  await gotoClean(page, '/tools/tier-list');
  const tile = page.locator('.tl-tray .tl-item').first();
  await expect(tile).toBeVisible();
  await tile.click();

  await expect(page.locator('body')).not.toHaveClass(/tl-placing/);
  await expect(tile).not.toHaveClass(/tl-held/);
  // And the actions stay in the toolbar where a desktop expects them.
  await expect(page.locator('.tl-conf .tl-actions .tl-btn')).toHaveCount(3);
  await expect(page.locator('.tl-rank')).toHaveCount(0);
});

test('feedback shows its fields once a type is picked, and sends what was asked @mobile', async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route('**/api/feedback', async route => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await gotoClean(page, '/feedback?from=%2Fcards');
  await expect(page.locator('#feedback-message')).toHaveCount(0);

  await page.getByRole('radio', { name: /Something’s wrong/ }).check();
  await expect(page.locator('#feedback-page')).toHaveValue('');
  await page.getByRole('button', { name: 'Use /cards' }).click();
  await expect(page.locator('#feedback-page')).toHaveValue('/cards');
  await expect(page.getByRole('button', { name: 'Use /cards' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#feedback-message-error')).toHaveText('Required');

  await page.locator('#feedback-message').fill('Dusknoir count is doubled');
  await page.getByRole('checkbox', { name: 'Include my browser, device, and OS' }).check();
  await expect(page.locator('.feedback-env-list')).toContainText('Browser');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();
  expect(sent).toMatchObject({ type: 'wrong', message: 'Dusknoir count is doubled', page: '/cards' });
  expect((sent as { environment?: { browser?: string } } | null)?.environment?.browser).toBeTruthy();
});

test('the footer feedback link carries the page it was clicked from', async ({ page }) => {
  await gotoClean(page, '/cards');
  await page.locator('.site-footer').getByRole('link', { name: 'Feedback' }).click();
  await expect(page).toHaveURL(/\/feedback\?from=%2Fcards$/);
  await expect(page.getByRole('radio', { name: /Something to say/ })).toBeVisible();
});

test('tier renames preserve tray tiles and avoid repositioning the editor', async ({ page }) => {
  await gotoClean(page, '/tools/tier-list');
  const tile = page.locator('.tl-tray .tl-item').first();
  await expect(tile).toBeVisible();
  await tile.evaluate(node => node.setAttribute('data-render-probe', 'retained'));
  const plate = page.locator('.tl-plate').first();
  await plate.hover();
  await plate.locator('[data-tier-id]').click();
  const panel = page.locator('.tl-pop');
  await expect(panel).toBeVisible();
  await panel.evaluate(async node => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
    const measure = node.getBoundingClientRect.bind(node);
    node.dataset.measurements = '0';
    node.getBoundingClientRect = () => {
      node.dataset.measurements = String(Number(node.dataset.measurements) + 1);
      return measure();
    };
  });
  await panel.locator('input').fill('Top');
  await expect(plate.locator('.tl-plate-name')).toHaveText('Top');
  await expect(tile).toHaveAttribute('data-render-probe', 'retained');
  await expect(panel).toHaveAttribute('data-measurements', '0');
});

test('saving a custom archetype preserves fetched tiles and both artwork modes', async ({ page }) => {
  await gotoClean(page, '/tools/tier-list');
  const tile = page.locator('.tl-tray .tl-item').first();
  await expect(tile).toBeVisible();
  await tile.evaluate(node => node.setAttribute('data-render-probe', 'retained'));
  const before = await page.locator('.tl-tray .tl-item').count();
  await page.locator('[data-addarch]').click();
  const panel = page.locator('.tl-pop');
  await panel.getByPlaceholder('Archetype name').fill('Test deck');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.tl-tray .tl-item')).toHaveCount(before + 1);
  await expect(tile).toHaveAttribute('data-render-probe', 'retained');
  await expect(page.locator('.tl-tray')).toContainText('Test deck');
  await page.getByRole('tab', { name: 'Previews', exact: true }).click();
  await expect(page.locator('.tl-tray .tl-item')).toHaveCount(before + 1);
  await expect(page.locator('.tl-tray')).toContainText('Test deck');
});

test('archetype list renders and sorts 39 embedded rates without matchup downloads', async ({ page }) => {
  const index = Array.from({ length: 39 }, (_, i) => ({
    name: `deck_${i}`,
    label: `Deck ${i}`,
    deckCount: 100,
    percent: 1 / 39,
    thumbnails: [],
    winRateAggregate: { wins: 50 + i, losses: 50 - i, ties: 0, games: 100, winRate: 50 + i }
  }));
  await page.addInitScript(() => localStorage.setItem('cm:archetypesView', 'list'));
  await page.route('**/archetypes/index.json', route => route.fulfill({ json: index }));
  const matchupRequests: string[] = [];
  page.on('request', request => {
    if (/\/archetypes\/[^/]+\/trends\.json|\/matchupProfiles\.json/.test(request.url())) {
      matchupRequests.push(request.url());
    }
  });
  await gotoClean(page, '/archetypes');
  const rows = page.locator('.arche-list tbody tr');
  await expect(rows).toHaveCount(39);
  await expect(rows.first()).toContainText('50.0%');
  await page.getByRole('button', { name: 'Win rate' }).click();
  await expect(rows.first()).toContainText('Deck 38');
  await expect(rows.first()).toContainText('88.0%');
  await page.getByPlaceholder('Search archetypes by name...').fill('Deck 38');
  await expect(rows).toHaveCount(1);
  await page.getByRole('tab', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.gallery-grid')).toBeVisible();
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(rows.first()).toContainText('88.0%');
  expect(matchupRequests).toEqual([]);
});
