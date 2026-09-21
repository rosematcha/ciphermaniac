/**
 * The live event's two run-level behaviours, against stubbed pairings.
 *
 * Live artifacts are minute-by-minute rather than part of a data release, so
 * they are not in the fixture set; each test serves its own small event, dated
 * around today so the schedule counts it as on.
 *
 * What is under test: filling in a whole run's decks goes out as one request,
 * and a player whose run has ended still has the event on their profile.
 */

import { expect, type Page, test } from '@playwright/test';

const SLUG = 'testville-2027';
const RUNNER = 'Ryan Ferry';
/** A player the fixture player index knows, so the profile page has a career to sit on. */
const DROPPER = 'Gabriel Smart';
const ROUNDS = 6;
const DROPPED_AT = 3;

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

interface Seat {
  name: string;
  country: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  result?: 'win' | 'loss';
  dropped?: true;
}

const seat = (name: string, wins: number, extra: Partial<Seat> = {}): Seat => ({
  name,
  country: 'US',
  wins,
  losses: 0,
  ties: 0,
  points: wins * 3,
  ...extra
});

/**
 * One round: the runner beats a fresh opponent every round, and the dropper
 * plays until the round they drop in and is unpaired after it.
 */
function round(n: number) {
  const matches = [
    {
      table: n,
      seats: [seat(RUNNER, n - 1, { result: 'win' }), seat(`Opponent ${n}`, 0, { result: 'loss' })],
      complete: true
    }
  ];
  if (n <= DROPPED_AT) {
    matches.push({
      table: 100 + n,
      seats: [
        seat(DROPPER, n - 1, { result: 'loss', ...(n === DROPPED_AT ? { dropped: true as const } : {}) }),
        seat(`Rival ${n}`, n - 1, { result: 'win' })
      ],
      complete: true
    });
  }
  return { round: n, updatedAt: new Date().toISOString(), unreadable: 0, matches };
}

/** Serves the event's artifacts, and keeps whatever the page posts to the report endpoint. */
async function stubEvent(page: Page, index: Record<string, unknown> = {}): Promise<{ posted: unknown[] }> {
  const posted: unknown[] = [];
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    if (url.pathname.endsWith('/live/v1/schedule.json')) {
      return route.fulfill({
        json: {
          generatedAt: new Date().toISOString(),
          events: [
            {
              slug: SLUG,
              name: 'Testville Regional',
              kind: 'regional',
              rk9Id: 'TV1',
              pod: 2,
              firstDay: day(-1),
              lastDay: day(1)
            }
          ]
        }
      });
    }
    if (url.pathname.endsWith(`/live/v1/${SLUG}/index.json`)) {
      return route.fulfill({
        json: {
          slug: SLUG,
          rk9Id: 'TV1',
          name: 'Testville Regional',
          round: ROUNDS,
          matches: 1,
          hash: 'abc',
          playing: 0,
          updatedAt: new Date().toISOString(),
          ...index
        }
      });
    }
    const pairing = /\/live\/v1\/.*\/r(\d+)\.json$/.exec(url.pathname);
    if (pairing) {
      return route.fulfill({ json: round(Number(pairing[1])) });
    }
    if (url.pathname.endsWith(`/live/v1/${SLUG}/reports.json`)) {
      return route.fulfill({ status: 404, body: 'absent' });
    }
    if (url.pathname === '/api/live/report') {
      const body = request.postDataJSON() as { reports: { seat: string; archetype: string }[] };
      posted.push(body);
      return route.fulfill({
        json: { archetypes: Object.fromEntries(body.reports.map(r => [r.seat, r.archetype])) }
      });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`page requested external resource: ${url.href}`);
    }
    return route.continue();
  });
  return { posted };
}

test('a whole run of decks is picked in the panel and sent as one request', async ({ page }) => {
  const { posted } = await stubEvent(page);
  await page.goto(`/live/${SLUG}?player=${encodeURIComponent(RUNNER)}&cc=US`, { waitUntil: 'load' });

  const panel = page.locator('.live-run-actions');
  await expect(panel.getByRole('button', { name: 'Report run' })).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Report run' }).click();

  // The player's own seat, then one row per opponent played.
  const pickers = page.locator('.run-report .round');
  await expect(pickers).toHaveCount(ROUNDS + 1);
  await expect(pickers.first()).toContainText(RUNNER);
  await expect(pickers.nth(1)).toContainText('Opponent 1');

  // Both labels are in the fixture icon map, which is what the picker offers.
  const pick = async (index: number, query: string) => {
    const row = pickers.nth(index);
    const box = row.getByRole('combobox');
    await box.click();
    await box.fill(query);
    // An option is named for its deck and, when it has one, its meta share.
    await row.getByRole('option', { name: new RegExp(`^${query}( \\d+%)?$`) }).click();
    await expect(box).toHaveValue(query);
  };
  await pick(0, 'Dragapult Dusknoir');
  await pick(1, 'Dragapult');

  const send = page.getByRole('button', { name: /^Report 2 decks$/ });
  await expect(send).toBeEnabled();
  await send.click();

  await expect.poll(() => posted.length).toBe(1);
  const [batch] = posted as [{ reports: { seat: string; archetype: string; slug: string }[] }];
  expect(batch.reports.map(report => report.seat)).toEqual(['ryan ferry|US', 'opponent 1|US']);
  expect(batch.reports.every(report => report.slug === SLUG)).toBe(true);
  await expect(page.locator('.run-report')).toHaveCount(0);
});

test('a player who dropped still has the live event on their profile', async ({ page }) => {
  await stubEvent(page);
  await page.goto('/players/1272', { waitUntil: 'load' });

  // The run stays, and it ends where they did: the rounds after it are the
  // event carrying on without them, not rows to mark as missing.
  const run = page.locator('.live-run');
  await expect(run.locator('.live-rounds .round')).toHaveCount(DROPPED_AT, { timeout: 15_000 });
  await expect(run).toContainText(`Rival ${DROPPED_AT}`);
  await expect(run).not.toContainText('Not found');
});

test('a finished event names its top cut rounds, and says it is over', async ({ page }) => {
  await stubEvent(page, { cut: { from: ROUNDS - 1, size: 4 }, finished: true });
  await page.goto(`/live/${SLUG}`, { waitUntil: 'load' });
  await expect(page.locator('.hero-meta')).toContainText('Finished', { timeout: 15_000 });
  await expect(page.locator('.round-step-label')).toHaveText('Final');

  await page.goto(`/live/${SLUG}?player=${encodeURIComponent(RUNNER)}&cc=US`, { waitUntil: 'load' });
  const rows = page.locator('.live-rounds .round-n');
  await expect(rows).toHaveCount(ROUNDS, { timeout: 15_000 });
  await expect(rows.nth(ROUNDS - 3)).toHaveText(`R${ROUNDS - 2}`);
  await expect(rows.nth(ROUNDS - 2)).toHaveText('Top 4');
  await expect(rows.nth(ROUNDS - 1)).toHaveText('Final');
});
