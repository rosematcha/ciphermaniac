/**
 * Spectating against mocked functions: the public page narrows its pairings
 * to the tables still playing, to one deck, or to the players this device
 * follows, and a stream overlay shows one table on a transparent page. The
 * data is the hand-written mid-event .tdf fixture, run through the same
 * public-view code the function uses.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import { parseTdf } from '../../shared/tournament/tdf';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'WATCHR';
const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const keys = assignKeys(tdf, {});
const VIEW: TournamentView = {
  code: CODE,
  mode: 'tom',
  version: 4,
  updatedAt: 0,
  tournament: publicTournament(tdf, keys),
  pending: [],
  reports: [],
  divisions: publicDivisions(tdf, keys, Date.UTC(2026, 9, 3)),
  decks: publicDecks({ '7200001': 'Gardevoir ex' }, keys),
  settings: { ...DEFAULT_SETTINGS, deckVisibility: 'always' },
  viewer: { role: null, me: null, via: null, signedIn: false }
};
const round = VIEW.tournament.pods[0]?.rounds.at(-1);
const matches = round?.matches ?? [];
const playing = matches.filter(m => m.p2 !== null && m.outcome === 'pending');

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: VIEW });
  });
}

test('a spectator narrows the pairings to the tables playing, one deck, or the players they follow @mobile', async ({
  page
}) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows).toHaveCount(matches.length);
  await page.getByRole('tab', { name: 'Playing' }).click();
  await expect(rows).toHaveCount(playing.length);
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await page.getByRole('combobox', { name: 'Deck' }).selectOption('Gardevoir ex');
  await expect(rows).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Deck' }).selectOption('');
  await expect(rows).toHaveCount(matches.length);

  await expect(page.getByRole('tab', { name: /^Following/ })).toHaveCount(0);
  await rows.last().getByRole('button').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Follow' }).click();
  await expect(sheet.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'Following 1' }).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Following 1' })).toBeVisible();
});

test('a stream overlay shows one table on a transparent page, and says when it is not in play', async ({ page }) => {
  await mockApi(page);
  const [first] = playing;
  await page.goto(`/t/${CODE}?stream=table&table=${first?.table ?? 1}`);
  const bar = page.locator('.tm-stream-bar');
  await expect(bar.locator('.tm-stream-seat')).toHaveCount(2);
  await expect(bar).toContainText(`Table ${first?.table ?? 1}`);
  await expect(page.locator('.topnav')).toBeHidden();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgba(0, 0, 0, 0)');
  await page.goto(`/t/${CODE}?stream=table&table=99`);
  await expect(page.locator('.tm-stream-bar')).toHaveText('Table 99 is not in play');
});
