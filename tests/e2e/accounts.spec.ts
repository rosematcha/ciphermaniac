/**
 * The player-account pages against mocked functions and mocked public
 * copies: History lists the account's events with the place and record read
 * from each event's copy, and a row opens to its rounds; a public profile
 * shows the same, read-only. The events are the hand-written mid-event .tdf
 * fixture and a finished event with a top cut, run through the same
 * public-view code the functions publish with.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, type Route, test } from '@playwright/test';

import type { HistoryEntry } from '../../shared/accounts/types';
import { parseTdf } from '../../shared/tournament/tdf';
import type { Tournament } from '../../shared/tournament/types';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type PublishedView,
  type TournamentSettings
} from '../../shared/tournament/view';
import { juniorsCutApart } from '../__utils__/divisionCuts';

const CHALLENGE = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const CUP = juniorsCutApart();

/** An event's public copy, as the functions publish it. */
function copyOf(
  code: string,
  t: Tournament,
  event: { mode: 'swiss' | 'tom'; settings?: Partial<TournamentSettings>; decks?: Record<string, string> }
) {
  const keys = assignKeys(t, {});
  const view: PublishedView = {
    code,
    mode: event.mode,
    version: 3,
    updatedAt: 0,
    tournament: publicTournament(t, keys),
    pending: [],
    reports: [],
    divisions: publicDivisions(t, keys, Date.UTC(2026, 9, 3)),
    decks: publicDecks(event.decks ?? {}, keys),
    settings: { ...DEFAULT_SETTINGS, ...event.settings }
  };
  return { view, keys };
}

const LIVE = copyOf('LIVE01', CHALLENGE, {
  mode: 'tom',
  decks: { '7200001': 'Gardevoir ex', '7200002': 'Dragapult ex' },
  settings: { deckVisibility: 'always', format: 'Standard' }
});
const DONE = copyOf('CUP001', CUP, { mode: 'swiss', settings: { finished: true } });
const juniorChampion = CUP.pods.find(p => p.category === 'junior')?.rounds.at(-1)?.matches[0]?.p1 ?? '';

const ENTRIES: HistoryEntry[] = [
  {
    code: 'LIVE01',
    key: LIVE.keys['7200001'] ?? '',
    name: 'Fixture Challenge & Friends',
    startDate: '10/03/2026',
    startsAt: '',
    format: 'Standard',
    mode: 'tom',
    status: 'live'
  },
  {
    code: 'GONE01',
    key: '42',
    name: 'An event whose copy lost the player',
    startDate: '09/20/2026',
    startsAt: '',
    format: 'Standard',
    mode: 'swiss',
    status: 'finished'
  },
  {
    code: 'CUP001',
    key: DONE.keys[juniorChampion] ?? '',
    name: 'Fixture Cup',
    startDate: '09/12/2026',
    startsAt: '',
    format: 'Standard',
    mode: 'swiss',
    status: 'finished'
  }
];

const ME = {
  id: 'acct-1',
  name: 'Mary',
  avatar: null,
  popId: '7200001',
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null,
  publicSlug: null,
  providers: ['google']
};

const COPIES: Record<string, PublishedView> = {
  LIVE01: LIVE.view,
  CUP001: DONE.view,
  GONE01: { ...DONE.view, code: 'GONE01' }
};

/** The events' public copies on the data origin; the ones read are counted by code. */
async function publishCopies(page: Page) {
  const read: string[] = [];
  await page.route('**/tournaments/v1/*.json', (route: Route) => {
    const code = /(\w+)\.json$/.exec(route.request().url())?.[1] ?? '';
    read.push(code);
    const copy = COPIES[code];
    return copy
      ? route.fulfill({ json: copy, headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ status: 404, body: 'missing', headers: { 'access-control-allow-origin': '*' } });
  });
  return read;
}

async function mockAccount(page: Page, user: typeof ME | null = ME) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user, providers: ['google', 'discord'] } });
    }
    if (pathname === '/api/history') {
      return user
        ? route.fulfill({ json: { entries: ENTRIES } })
        : route.fulfill({ status: 401, json: { error: 'Sign in first' } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return errors;
}

test('History lists the account’s events with place and record from each copy, and opens one to its rounds @mobile', async ({
  page
}) => {
  const errors = await mockAccount(page);
  const read = await publishCopies(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('History');
  const rows = page.locator('.tm-hist tbody tr.is-link');
  // The copy with no player under the entry's key leaves no row.
  await expect(rows).toHaveCount(2);
  const live = rows.filter({ hasText: 'Fixture Challenge & Friends' });
  await expect(live.locator('.tm-flag')).toHaveText('In progress');
  await expect(live.locator('.tm-hist-place')).toHaveText('1st');
  await expect(live.locator('.tm-hist-record')).toHaveText('1-0-0');
  await expect(live.locator('.tm-hist-sub')).toContainText('Standard · Masters');
  const cup = rows.filter({ hasText: 'Fixture Cup' });
  await expect(cup.locator('.tm-hist-place')).toHaveText('1st');
  await expect(cup.locator('.tm-hist-sub')).toContainText('Juniors');
  await cup.getByRole('button', { name: 'Show rounds' }).click();
  const rounds = page.locator('.tm-hist-rounds li');
  await expect(rounds).toHaveCount(3);
  await expect(rounds.nth(1)).toContainText('Semifinals');
  await expect(rounds.nth(2)).toContainText('Final');
  await expect(page.getByRole('link', { name: 'Event page' })).toHaveAttribute('href', '/t/CUP001');
  await cup.getByRole('button', { name: 'Hide rounds' }).click();
  await expect(rounds).toHaveCount(0);
  await live.click();
  await expect(rounds.first()).toContainText('Dorothy Vaughan');
  await expect(rounds.nth(1)).toContainText('Playing');
  expect([...new Set(read)].sort()).toEqual(['CUP001', 'GONE01', 'LIVE01']);
  expect(errors).toEqual([]);
});

test('History signed out offers sign-in, and asks for no History', async ({ page }) => {
  let asked = false;
  await mockAccount(page, null);
  page.on('request', request => {
    asked ||= new URL(request.url()).pathname === '/api/history';
  });
  await page.goto('/history');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', /next=%2Fhistory/);
  expect(asked).toBe(false);
});

test('History with no events says so', async ({ page }) => {
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    return pathname === '/api/me'
      ? route.fulfill({ json: { user: ME, providers: [] } })
      : route.fulfill({ json: { entries: [] } });
  });
  await page.goto('/history');
  await expect(page.locator('.tm-empty')).toHaveText('No events yet');
});

test('a public profile shows the name and History read-only, and an unknown address is not found @mobile', async ({
  page
}) => {
  const errors = await mockAccount(page, null);
  await publishCopies(page);
  await page.route('**/api/profiles/**', route => {
    const slug = new URL(route.request().url()).pathname.split('/').pop();
    return slug === 'ABCD2345'
      ? route.fulfill({ json: { name: 'Mary Jackson', avatar: null, entries: ENTRIES } })
      : route.fulfill({ status: 404, json: { error: 'No such profile' } });
  });
  await page.goto('/u/abcd2345');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mary Jackson');
  const rows = page.locator('.tm-hist tbody tr.is-link');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.tm-hist-place')).toHaveText('1st');
  await expect(page.locator('main').getByRole('button', { name: /Sign in|Save|Remove/ })).toHaveCount(0);
  await page.goto('/u/NOPE2345');
  await expect(page.getByRole('heading', { name: /not found/ })).toBeVisible();
  expect(errors).toEqual([]);
});
