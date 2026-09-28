/**
 * The tournament pages against mocked functions: the public page shows the
 * current round's tables and a searchable field, opens a player's history,
 * ranks a combined pod per division, and never asks a signed-out player to
 * do more than sign in. The data is the hand-written mid-event .tdf fixture,
 * run through the same public-view code the function uses.
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

const CODE = 'ABCDEF';
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
  settings: { ...DEFAULT_SETTINGS, details: 'Doors at 11', deckVisibility: 'always' },
  viewer: { role: null, me: null, signedIn: false }
};

async function mockApi(page: Page, view: TournamentView = VIEW) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: ['google', 'discord'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return errors;
}

test('the public page shows the round, finds a player and opens their history @mobile', async ({ page }) => {
  const errors = await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
  await expect(page.locator('.tm-details')).toHaveText('Doors at 11');
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Find a player' }).fill('lamarr');
  await expect(rows).toHaveCount(1);
  await rows
    .first()
    .getByRole('button', { name: /Hedy Lamarr/ })
    .click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Hedy Lamarr');
  await expect(sheet.locator('.tm-history li')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'This is me' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tm-you')).toContainText('Table 2');
  expect(errors).toEqual([]);
});

test('standings rank a combined pod per division', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?tab=standings`);
  await expect(page.locator('.tm-subhead')).toHaveText(['Juniors', 'Masters']);
  await expect(page.locator('.tm-standings').last().locator('tbody tr')).toHaveCount(7);
});

test('a signed-out organizer is offered sign-in, not a console @mobile', async ({ page }) => {
  await mockApi(page);
  await page.goto('/host');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
    'href',
    '/api/auth/login/google?next=%2Fhost'
  );
  await expect(page.getByRole('link', { name: 'Continue with Discord' })).toBeVisible();
  // The server has to see the click: the client router must not take it as one of its own routes.
  const login = page.waitForRequest(
    request => request.isNavigationRequest() && new URL(request.url()).pathname === '/api/auth/login/google'
  );
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await login;
});

test('the big screen hides the site chrome and shows a QR code to the event', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  // One row per player, alphabetical by last name: seven players are in round 2.
  await expect(page.locator('.tm-screen-list li')).toHaveCount(7);
  await expect(page.locator('.tm-screen-name').first()).toHaveText('Frances Allen');
  await expect(page.locator('.topnav')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Event page QR code' })).toBeVisible();
});

test('before round 1 the big screen lists everyone registered, by last name', async ({ page }) => {
  const unpaired = { ...VIEW.tournament, pods: VIEW.tournament.pods.map(pod => ({ ...pod, rounds: [] })) };
  await mockApi(page, { ...VIEW, tournament: unpaired });
  await page.goto(`/t/${CODE}?screen=1`);
  const players = VIEW.tournament.players.filter(p => p.droppedAfter === null);
  await expect(page.locator('.tm-screen-registered li')).toHaveCount(players.length);
  await expect(page.locator('.tm-screen-name').first()).toHaveText('Frances Allen');
  await expect(page.locator('.tm-screen-round')).toHaveText(`${players.length} registered`);
});
