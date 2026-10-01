/**
 * The player-account pages against mocked functions and mocked public
 * copies: History lists the account's events with the place and record read
 * from each event's copy, and a row opens to its rounds; a public profile
 * shows the same, read-only; Settings turns the profile on and points a POP
 * ID clash to feedback; and the event page knows a signed-in player by their
 * POP ID or their Claim, which they can undo. The events are the
 * hand-written mid-event .tdf fixture and Swiss events built with the shared
 * commands, run through the same public-view code the functions publish with.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, type Route, test } from '@playwright/test';

import type { AccountRole } from '../../shared/accounts/roles';
import type { HistoryEntry } from '../../shared/accounts/types';
import { applyCommand, type Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { seededRandom } from '../../shared/tournament/random';
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
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null as AccountRole | null,
  publicSlug: null as string | null,
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

/** Settings against a mocked account, recording what the page sends. */
async function mockSettings(page: Page, user: typeof ME) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let current = user;
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const body = request.postDataJSON() as Record<string, unknown> | null;
    sent.push({ method: request.method(), path: pathname, body });
    if (pathname === '/api/me' && request.method() === 'PATCH') {
      current = { ...current, publicSlug: body?.publicProfile ? 'ABCD2345' : null };
      return route.fulfill({ json: { user: current } });
    }
    if (pathname === '/api/me' && request.method() === 'PUT') {
      return route.fulfill({
        status: 409,
        json: { error: 'This POP ID is on another account', popIdTaken: true }
      });
    }
    return route.fulfill({ json: { user: current, providers: ['google', 'discord'] } });
  });
  return sent;
}

test('Settings: the public profile switch shows its link, and a POP ID clash points to feedback @mobile', async ({
  page
}) => {
  const sent = await mockSettings(page, ME);
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'View history' })).toHaveAttribute('href', '/history');
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  const profile = page.getByRole('tablist', { name: 'Public profile' });
  await profile.getByRole('tab', { name: 'On' }).click();
  await expect(page.getByRole('link', { name: /\/u\/ABCD2345$/ })).toHaveAttribute('href', '/u/ABCD2345');
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  expect(sent.find(s => s.method === 'PATCH')?.body).toEqual({ publicProfile: true });
  await profile.getByRole('tab', { name: 'Off' }).click();
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('This POP ID is on another account');
  await expect(alert.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', '/feedback?from=/settings');
});

test('Settings shows an admin the way to the admin page, and the strip offers History', async ({ page }) => {
  await mockSettings(page, { ...ME, role: 'admin' });
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  await page.getByRole('link', { name: 'View history' }).click();
  await expect(page.locator('.tm-account-strip').getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    '/history'
  );
});

// ---------- The event page: a signed-in player ----------

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    return result.tournament;
  }, tournament);
}

/** A Swiss event of four with round 1 paired, its players known by Player ID at a sanctioned one. */
function roundOne(sanctioned: boolean): Tournament {
  const names = [
    ['Ash', 'Ketchum', '1001'],
    ['Misty', 'Waterflower', '1002'],
    ['Brock', 'Harrison', '1003'],
    ['Gary', 'Oak', '1004']
  ];
  const adds = names.map(
    ([firstName, lastName, id]) =>
      ({ type: 'addPlayer', player: { firstName, lastName, ...(sanctioned ? { id } : {}) } }) as Command
  );
  return run(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'masters' });
}

/** The event page's API for an event where players report: the view, who the viewer is, and the asks it gets. */
async function mockEvent(page: Page, t: Tournament, options: { sanctioned: boolean; user: typeof ME | null }) {
  const code = 'LEAGUE';
  const keys = assignKeys(t, {});
  const published: PublishedView = {
    code,
    mode: 'swiss',
    version: 2,
    updatedAt: 0,
    tournament: publicTournament(t, keys, !options.sanctioned),
    pending: [],
    reports: [],
    divisions: publicDivisions(t, keys, Date.UTC(2026, 9, 3)),
    decks: {},
    settings: { ...DEFAULT_SETTINGS, sanctioned: options.sanctioned, playerReporting: true }
  };
  const asks: { method: string; path: string; body: unknown }[] = [];
  const ash = t.players.find(p => p.lastName === 'Ketchum')?.id ?? '';
  let linked = options.sanctioned && Boolean(options.user);
  await page.route(`**/tournaments/v1/${code}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    asks.push({ method: request.method(), path: pathname, body: request.postDataJSON() as unknown });
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user: options.user, providers: ['google', 'discord'] } });
    }
    if (pathname === `/api/tournaments/${code}/report`) {
      linked = Boolean(options.user);
      return route.fulfill({
        json: { key: keys[ash], view: published, reporter: true, linked, reportToken: 'seat' }
      });
    }
    if (pathname === `/api/tournaments/${code}/claim`) {
      linked = false;
      return route.fulfill({ status: 204 });
    }
    if (pathname === `/api/tournaments/${code}`) {
      const via = options.sanctioned ? 'pop' : 'claim';
      const viewer = { role: null, me: linked ? keys[ash] : null, via: linked ? via : null, signedIn: true };
      return route.fulfill({ json: { ...published, viewer } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return { code, asks };
}

test('signed in at an unsanctioned event, answering the question links the player, and Not you? undoes it @mobile', async ({
  page
}) => {
  const { code, asks } = await mockEvent(page, roundOne(false), { sanctioned: false, user: { ...ME, popId: null } });
  await page.goto(`/t/${code}`);
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  await page.getByLabel('Last name').fill('Ketchum');
  await page.getByRole('button', { name: 'Find my match' }).click();
  const who = page.locator('.tm-you-who');
  await expect(who).toContainText('Ash K.');
  await expect(who).toContainText('Linked to your account');
  await who.getByRole('button', { name: 'Not you?' }).click();
  await page.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.path)).toEqual([`/api/tournaments/${code}/claim`]);
});

test('signed in at a sanctioned event as the player by POP ID, there is no question to answer', async ({ page }) => {
  const { code, asks } = await mockEvent(page, roundOne(true), {
    sanctioned: true,
    user: { ...ME, popId: '1001' }
  });
  await page.goto(`/t/${code}`);
  await expect(page.locator('.tm-you-who')).toContainText('Ash Ketchum');
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toHaveCount(0);
  await expect(page.locator('.tm-you-who').getByRole('button', { name: 'Not you?' })).toHaveCount(0);
  // The account takes the reporting seat for its player, once, by its POP ID.
  await expect
    .poll(() => asks.filter(a => a.path.endsWith('/report')).map(a => (a.body as { popId?: string }).popId))
    .toEqual(['1001']);
  await expect(page.getByRole('button', { name: 'Report result' })).toBeVisible();
});

test('signed out, the question offers sign-in that comes back to the event', async ({ page }) => {
  const { code } = await mockEvent(page, roundOne(false), { sanctioned: false, user: null });
  await page.goto(`/t/${code}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
    'href',
    `/api/auth/login/google?next=%2Ft%2F${code}`
  );
});

test('a signed-in player saves the POP ID their decklist went in under to their account', async ({ page }) => {
  const code = 'DECKS1';
  const t = run(emptyTournament({ name: 'Cup' }));
  const keys = assignKeys(t, {});
  const published: PublishedView = {
    code,
    mode: 'swiss',
    version: 1,
    updatedAt: 0,
    tournament: publicTournament(t, keys),
    pending: [],
    reports: [],
    divisions: {},
    decks: {},
    settings: { ...DEFAULT_SETTINGS, decklists: 'open' }
  };
  const profile = { popId: '1001', firstName: 'Mary', lastName: 'Jackson', birthDate: '02/27/1995' };
  const mine = {
    ...profile,
    deck: '60 Grass Energy',
    archetype: null,
    submittedAt: 0,
    problems: [],
    registered: true,
    fromList: true,
    locked: true
  };
  const saved: unknown[] = [];
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`cm-decklist:${code}`, JSON.stringify({ profile, token: 'kept' })]
  );
  await page.route(`**/tournaments/v1/${code}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/me' && request.method() === 'PUT') {
      saved.push(request.postDataJSON());
      return route.fulfill({ json: { user: { ...ME, ...profile } } });
    }
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user: { ...ME, popId: null }, providers: [] } });
    }
    if (pathname === `/api/tournaments/${code}/decklists`) {
      return route.fulfill({ json: { mine } });
    }
    return route.fulfill({ json: { ...published, viewer: { role: null, me: null, via: null, signedIn: true } } });
  });
  await page.goto(`/t/${code}?tab=decklist`);
  await page.getByRole('button', { name: 'Save to my account' }).click();
  await expect(page.locator('.tm-known').getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Save to my account' })).toHaveCount(0);
  expect(saved).toEqual([profile]);
});
