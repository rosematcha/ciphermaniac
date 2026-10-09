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
const juniorChampion = CUP.pods[0]?.rounds.at(-1)?.matches[0]?.p1 ?? '';

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
  name: 'Mary Jackson',
  handle: 'mary',
  avatar: null,
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '02/27/1995',
  role: null as AccountRole | null,
  publicProfile: false,
  profileName: 'real' as 'real' | 'handle',
  providers: ['google'],
  stores: []
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
  await expect(rounds.nth(1)).toContainText('In progress');
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

test('History and Settings lead back to the dashboard, History to its Playing tab; signed out there is no way back @mobile', async ({
  page
}) => {
  await mockAccount(page);
  await publishCopies(page);
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await page.goto('/history');
  await expect(trail.getByRole('link', { name: 'Your events' })).toHaveAttribute('href', '/host?tab=playing');
  await expect(trail.locator('[aria-current="page"]')).toHaveText('History');
  await page.goto('/settings');
  await expect(trail.getByRole('link', { name: 'Your events' })).toHaveAttribute('href', '/host');
  await expect(trail.locator('[aria-current="page"]')).toHaveText('Settings');
  await page.unrouteAll();
  await mockAccount(page, null);
  await page.goto('/history');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  await expect(trail).toHaveCount(0);
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
    const handle = new URL(route.request().url()).pathname.split('/').pop();
    return handle === 'mary.j'
      ? route.fulfill({ json: { name: 'Mary Jackson', handle: 'mary.j', avatar: null, entries: ENTRIES } })
      : route.fulfill({ status: 404, json: { error: 'No such profile' } });
  });
  await page.goto('/u/Mary.J');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mary Jackson');
  await expect(page.locator('.tm-profile-hero .tm-status')).toHaveText('mary.j · 3 events');
  const rows = page.locator('.tm-hist tbody tr.is-link');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.tm-hist-place')).toHaveText('1st');
  await expect(page.locator('main').getByRole('button', { name: /Sign in|Save|Remove/ })).toHaveCount(0);
  await page.goto('/u/nobody');
  await expect(page.getByRole('heading', { name: /not found/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a profile’s badges sit under its name, the first six in the row and the rest behind +N @mobile', async ({
  page
}) => {
  const errors = await mockAccount(page, null);
  await publishCopies(page);
  const badges = [
    { key: 'creator' },
    { key: 'beta' },
    { key: 'played', count: 25, tier: 3 },
    { key: 'won', count: 1, tier: 1 },
    { key: 'organized', count: 12, tier: 2 },
    { key: 'staffed', count: 2, tier: 1 },
    { key: 'traveler', count: 4, tier: 1 },
    { key: 'bug', count: 1, tier: 1 }
  ];
  await page.route('**/api/profiles/**', route =>
    route.fulfill({ json: { name: 'Mary Jackson', handle: 'mary.j', avatar: null, entries: ENTRIES, badges } })
  );
  await page.goto('/u/mary.j');
  const row = page.locator('.tm-profile-hero .tm-badges');
  await expect(row.locator('.tm-badge')).toHaveCount(6);
  await expect(row.locator('.tm-badge-rule')).toHaveCount(1);
  const played = row.getByRole('note', { name: 'Played 25 events' });
  await played.click();
  await expect(played.getByRole('tooltip')).toBeVisible();
  const more = row.getByRole('button', { name: '2 more badges' });
  await expect(more).toHaveText('+2');
  await more.click();
  await expect(row.locator('.tm-badge-list li')).toHaveText(['Played in 4 cities', '1 accepted issue']);
  await page.keyboard.press('Escape');
  await expect(row.locator('.tm-badge-list')).toHaveCount(0);
  await expect(more).toBeFocused();
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
      if (body?.handle === 'taken') {
        return route.fulfill({ status: 409, json: { error: 'That username is taken' } });
      }
      current = { ...current, ...body };
      // A username's answer is the account as its request read it: the one the page opened with.
      return route.fulfill({ json: { user: body && 'handle' in body ? { ...user, ...body } : current } });
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
  await expect(page.getByRole('tablist', { name: 'Name shown' })).toHaveCount(0);
  await profile.getByRole('tab', { name: 'Enabled' }).click();
  await expect(page.getByRole('link', { name: /\/u\/mary$/ })).toHaveAttribute('href', '/u/mary');
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  expect(sent.find(s => s.method === 'PATCH')?.body).toEqual({ publicProfile: true });
  const shown = page.getByRole('tablist', { name: 'Name shown' });
  await expect(shown.getByRole('tab', { name: 'Real name' })).toHaveAttribute('aria-selected', 'true');
  await shown.getByRole('tab', { name: 'Username' }).click();
  await expect(shown.getByRole('tab', { name: 'Username' })).toHaveAttribute('aria-selected', 'true');
  expect(sent.filter(s => s.method === 'PATCH').at(-1)?.body).toEqual({ profileName: 'handle' });
  await profile.getByRole('tab', { name: 'Disabled' }).click();
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('This POP ID is on another account');
  await expect(alert.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', '/feedback?from=/settings');
});

test('Settings: the username is checked as it is typed, saved lowercased, and refused when taken @mobile', async ({
  page
}) => {
  const sent = await mockSettings(page, ME);
  await page.goto('/settings');
  const input = page.getByRole('textbox', { name: 'Username' });
  const save = page.getByRole('button', { name: 'Save username' });
  await expect(input).toHaveValue('mary');
  await expect(save).toBeDisabled();
  await input.fill('mary..j');
  await expect(page.getByRole('alert')).toHaveText('Put a letter or number between separators');
  await expect(save).toBeDisabled();
  await input.fill('taken');
  await save.click();
  await expect(page.getByRole('alert')).toHaveText('That username is taken');
  await page.getByRole('tablist', { name: 'Public profile' }).getByRole('tab', { name: 'Enabled' }).click();
  await input.fill('Mary.J');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await save.click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(sent.filter(s => s.method === 'PATCH').at(-1)?.body).toEqual({ handle: 'mary.j' });
  await expect(page.getByRole('link', { name: /\/u\/mary\.j$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('Settings shows an admin the way to the admin page, and the account button offers History', async ({ page }) => {
  await mockSettings(page, { ...ME, role: 'admin' });
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  await page.getByRole('link', { name: 'View history' }).click();
  await page.locator('.tm-account-strip').getByRole('button', { name: 'Account' }).click();
  await expect(page.locator('.tm-acct-menu').getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    '/history'
  );
});

// ---------- My data ----------

/** Settings' My data against a mocked account: the wipe answers a new username, and organizer history must wait. */
async function mockMyData(page: Page) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  let user: typeof ME | null = ME;
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as Record<string, unknown> | null;
    sent.push({ method: request.method(), url: url.pathname + url.search, body });
    if (url.pathname === '/api/me/data' && request.method() === 'GET') {
      return route.fulfill({
        body: '# Your data on Ciphermaniac\n',
        headers: {
          'content-type': 'text/markdown',
          'content-disposition': 'attachment; filename="ciphermaniac-mary.md"'
        }
      });
    }
    if (url.pathname === '/api/me/data') {
      const parts = (body?.parts ?? []) as string[];
      if (parts.includes('organizer')) {
        return route.fulfill({
          status: 409,
          json: {
            error: 'End your running events first',
            running: [{ code: 'LIVE01', name: 'Friday Cup' }],
            ownedStores: []
          }
        });
      }
      user = {
        ...ME,
        handle: 'quiet-otter-41',
        popId: null,
        firstName: null,
        lastName: null,
        birthDate: null
      } as never;
      return route.fulfill({ json: { user } });
    }
    if (url.pathname === '/api/me' && request.method() === 'DELETE') {
      user = null;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user, providers: ['google'] } });
    }
    if (url.pathname === '/api/applications/mine') {
      return route.fulfill({ json: { application: null } });
    }
    return route.fulfill({ json: {} });
  });
  return sent;
}

test('Settings: My data exports the parts ticked as a Markdown download @mobile', async ({ page }) => {
  const sent = await mockMyData(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Export data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export data' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(5);
  await expect(dialog.getByRole('button', { name: 'Download all' })).toBeEnabled();
  await dialog.getByRole('checkbox', { name: /^Account/ }).uncheck();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('ciphermaniac-mary.md');
  expect(sent.find(s => s.url.startsWith('/api/me/data'))?.url).toBe(
    '/api/me/data?parts=profile,username,events,organizer'
  );
  await expect(dialog).toBeHidden();
});

test('Settings: a wipe is chosen, reviewed, then sent, and says what holds it up @mobile', async ({ page }) => {
  const sent = await mockMyData(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Wipe data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Wipe data' });
  const review = dialog.getByRole('button', { name: 'Review' });
  await expect(review).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /^Organizer history/ }).check();
  await review.click();
  await dialog.getByRole('button', { name: 'Wipe 1' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('End your running events first');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Friday Cup' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('checkbox', { name: /^Organizer history/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /^Username/ }).check();
  await dialog.getByRole('checkbox', { name: /^Profile/ }).check();
  await review.click();
  await dialog.getByRole('button', { name: 'Wipe 2' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.filter(s => s.method === 'POST').at(-1)?.body).toEqual({ parts: ['profile', 'username'] });
  await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue('quiet-otter-41');
});

test('Settings: deleting asks for the username typed out, then signs out @mobile', async ({ page }) => {
  const sent = await mockMyData(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  const remove = dialog.getByRole('button', { name: 'Delete account' });
  await expect(remove).toBeDisabled();
  await dialog.getByRole('textbox').fill('mar');
  await expect(remove).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  await dialog.getByRole('textbox').fill('mary');
  await remove.click();
  await expect(page).toHaveURL(/\/$/);
  expect(sent.find(s => s.method === 'DELETE')?.body).toEqual({ confirm: 'mary' });
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
async function mockEvent(
  page: Page,
  t: Tournament,
  options: {
    sanctioned: boolean;
    user: typeof ME | null;
    linked?: boolean;
    refuse?: boolean;
    /** The account holds the player's seat already, so a device asking with it is given no token. */
    tokenless?: boolean;
  }
) {
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
  let linked = options.linked ?? (options.sanctioned && Boolean(options.user));
  let reporter = true;
  let held: Promise<void> | null = null;
  await page.route(`**/tournaments/v1/${code}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    asks.push({ method: request.method(), path: pathname, body: request.postDataJSON() as unknown });
    if (pathname === '/api/me') {
      return route.fulfill({ json: { user: options.user, providers: ['google', 'discord'] } });
    }
    if (pathname === `/api/tournaments/${code}/report`) {
      if ((options.refuse || !reporter) && (request.postDataJSON() as { result?: string }).result) {
        return route.fulfill({ status: 403, json: { error: 'Someone else is already reporting for this player.' } });
      }
      linked = Boolean(options.user);
      return route.fulfill({
        json: {
          key: keys[ash],
          view: published,
          reporter,
          linked: linked && reporter,
          ...(options.tokenless || !reporter ? {} : { reportToken: 'seat' })
        }
      });
    }
    if (pathname === `/api/tournaments/${code}/claim`) {
      linked = false;
      return route.fulfill({ status: 204 });
    }
    if (pathname === `/api/tournaments/${code}`) {
      const via = options.sanctioned ? 'pop' : 'claim';
      const claim = options.sanctioned ? { popId: '1001' } : { lastName: 'Ketchum', firstName: 'Ash' };
      const viewer = linked
        ? { role: null, me: keys[ash], via, claim, signedIn: true }
        : { role: null, me: null, via: null, signedIn: true };
      // A held read answers as the account stood when it was asked.
      const wait = held;
      held = null;
      await wait;
      return route.fulfill({ json: { ...published, viewer } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return {
    code,
    asks,
    /** Staff release the player, or the account's Claim is made on another device. */
    setLinked: (value: boolean) => {
      linked = value;
    },
    /** Staff reset reporting for the player, and another device took the seat. */
    takeSeat: () => {
      reporter = false;
    },
    /** Holds the next read of the view until the returned function lets it go. */
    holdNextRead: () => {
      let release = () => undefined as void;
      held = new Promise(resolve => {
        release = resolve;
      });
      return release;
    }
  };
}

/** The tab hidden and shown again, as when the player comes back to it from another app. */
const showAgain = (page: Page) =>
  page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

/** The full reads of the event page's API copy: who the viewer is. */
const viewReads = (asks: { method: string; path: string }[], code: string) =>
  asks.filter(a => a.method === 'GET' && a.path === `/api/tournaments/${code}`).length;

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

test('an event’s player is led back to the dashboard’s Playing tab, a stranger to the dashboard’s own pick', async ({
  page
}) => {
  const { code } = await mockEvent(page, roundOne(true), { sanctioned: true, user: { ...ME, popId: '1001' } });
  await page.goto(`/t/${code}`);
  const back = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Your events' });
  await expect(page.locator('.tm-you-who')).toContainText('Ash Ketchum');
  await expect(back).toHaveAttribute('href', '/host?tab=playing');
  await page.unrouteAll();
  await mockEvent(page, roundOne(true), { sanctioned: true, user: { ...ME, popId: '9999' }, linked: false });
  await page.goto(`/t/${code}`);
  await expect(back).toHaveAttribute('href', '/host');
});

test('a Claim released or made elsewhere reaches the open page when it is shown again, at most every half minute', async ({
  page
}) => {
  await page.clock.install();
  const { code, asks, setLinked } = await mockEvent(page, roundOne(false), {
    sanctioned: false,
    user: { ...ME, popId: null },
    linked: true
  });
  await page.goto(`/t/${code}`);
  await expect(page.locator('.tm-you-who')).toContainText('Linked to your account');
  setLinked(false);
  await showAgain(page);
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  const reads = viewReads(asks, code);
  setLinked(true);
  await showAgain(page);
  await page.clock.runFor(1000);
  expect(viewReads(asks, code), 'shown again within the half minute, nothing more is asked').toBe(reads);
  await page.clock.runFor(30_000);
  await showAgain(page);
  await expect(page.locator('.tm-you-who')).toContainText('Linked to your account');
});

test('a report refused as not the player’s asks again who the viewer is', async ({ page }) => {
  const { code, asks } = await mockEvent(page, roundOne(true), {
    sanctioned: true,
    user: { ...ME, popId: '1001' },
    refuse: true
  });
  await page.goto(`/t/${code}`);
  await page.getByRole('button', { name: 'Report result' }).click();
  const reads = viewReads(asks, code);
  await page.getByRole('button', { name: 'I won' }).click();
  await expect(page.getByRole('alert')).toContainText('Someone else is already reporting');
  await expect.poll(() => viewReads(asks, code)).toBe(reads + 1);
});

test('a report refused once another device took the seat asks for it again, and stops offering to report', async ({
  page
}) => {
  const { code, asks, takeSeat } = await mockEvent(page, roundOne(true), {
    sanctioned: true,
    user: { ...ME, popId: '1001' },
    tokenless: true
  });
  await page.goto(`/t/${code}`);
  await page.getByRole('button', { name: 'Report result' }).click();
  takeSeat();
  await showAgain(page);
  await page.getByRole('button', { name: 'I won' }).click();
  await expect(page.locator('p.tm-you-panel')).toContainText('Someone else is already reporting');
  await expect(page.getByRole('button', { name: 'I won' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Report result' })).toHaveCount(0);
  const seatAsks = asks.filter(a => a.path.endsWith('/report') && !(a.body as { result?: string }).result);
  expect(seatAsks.map(a => (a.body as { popId?: string }).popId)).toEqual(['1001', '1001']);
});

test('an account whose POP ID is no longer the player’s stops being shown as them on this device', async ({ page }) => {
  const { code, setLinked } = await mockEvent(page, roundOne(true), {
    sanctioned: true,
    user: { ...ME, popId: '1001' }
  });
  await page.goto(`/t/${code}`);
  await expect(page.getByRole('button', { name: 'Report result' })).toBeVisible();
  setLinked(false);
  await showAgain(page);
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  await expect(page.locator('.tm-you-who')).toHaveCount(0);
});

test('a read of who the viewer is that lands after they unlink does not link them again', async ({ page }) => {
  const { code, holdNextRead } = await mockEvent(page, roundOne(false), {
    sanctioned: false,
    user: { ...ME, popId: null },
    linked: true
  });
  await page.goto(`/t/${code}`);
  const who = page.locator('.tm-you-who');
  await expect(who).toContainText('Linked to your account');
  const release = holdNextRead();
  const read = page.waitForRequest(
    r => r.method() === 'GET' && new URL(r.url()).pathname === `/api/tournaments/${code}`
  );
  await showAgain(page);
  await read;
  await who.getByRole('button', { name: 'Not you?' }).click();
  await page.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  const answered = page.waitForResponse(r => new URL(r.url()).pathname === `/api/tournaments/${code}`);
  release();
  await (await answered).finished();
  await page.evaluate(
    () =>
      new Promise(resolve => {
        setTimeout(resolve, 100);
      })
  );
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toBeVisible();
  await expect(page.getByText('Linked to your account')).toHaveCount(0);
});

/** The result reports the page sent: what they said and the token with it. */
const reportsSent = (asks: { path: string; body: unknown }[]) =>
  asks
    .filter(a => a.path.endsWith('/report') && (a.body as { result?: string }).result)
    .map(a => {
      const { popId, lastName, firstName, reportToken } = a.body as Record<string, unknown>;
      return { popId, lastName, firstName, reportToken: reportToken ?? null };
    });

test('on a device that never asked, an account linked by its Claim reports as its player without the question @mobile', async ({
  page
}) => {
  const { code, asks } = await mockEvent(page, roundOne(false), {
    sanctioned: false,
    user: { ...ME, popId: null },
    linked: true,
    tokenless: true
  });
  await page.goto(`/t/${code}`);
  await expect(page.locator('.tm-you-who')).toContainText('Linked to your account');
  await expect(page.getByRole('heading', { name: 'Which player are you?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByRole('button', { name: 'I won' }).click();
  await expect
    .poll(() => reportsSent(asks))
    .toEqual([{ popId: undefined, lastName: 'Ketchum', firstName: 'Ash', reportToken: null }]);
});

test('on a device that never asked, an account that holds its player’s seat by POP ID reports without a token', async ({
  page
}) => {
  const { code, asks } = await mockEvent(page, roundOne(true), {
    sanctioned: true,
    user: { ...ME, popId: '1001' },
    tokenless: true
  });
  await page.goto(`/t/${code}`);
  await expect(page.locator('.tm-you-who')).toContainText('Ash Ketchum');
  await page.getByRole('button', { name: 'Report result' }).click();
  await page.getByRole('button', { name: 'I won' }).click();
  await expect
    .poll(() => reportsSent(asks))
    .toEqual([{ popId: '1001', lastName: undefined, firstName: undefined, reportToken: null }]);
  await expect(page.getByText('Someone else is already reporting')).toHaveCount(0);
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

/**
 * An event taking decklists, whose functions hold a list for each of its two
 * players, each read by whose it is and no token; the signed-in account owns
 * the first, until `claim` makes its Claim the second's (unsanctioned).
 */
async function mockOwnList(page: Page, sanctioned: boolean) {
  const code = 'DECKS2';
  const players = [
    { firstName: 'Mary', lastName: 'Jackson', popId: '1001', deck: '60 Grass Energy' },
    { firstName: 'Ash', lastName: 'Ketchum', popId: '1002', deck: '60 Fire Energy' }
  ];
  const t = run(
    emptyTournament({ name: 'Cup' }),
    ...players.map(
      ({ firstName, lastName, popId }) =>
        ({ type: 'addPlayer', player: { firstName, lastName, ...(sanctioned ? { id: popId } : {}) } }) as Command
    )
  );
  const keys = assignKeys(t, {});
  const published: PublishedView = {
    code,
    mode: 'swiss',
    version: 1,
    updatedAt: 0,
    tournament: publicTournament(t, keys, !sanctioned),
    pending: [],
    reports: [],
    divisions: {},
    decks: {},
    settings: { ...DEFAULT_SETTINGS, decklists: 'open', sanctioned }
  };
  const listOf = (player: (typeof players)[number]) => ({
    popId: sanctioned ? player.popId : '',
    firstName: player.firstName,
    lastName: player.lastName,
    birthDate: sanctioned ? '02/27/1995' : '',
    deck: player.deck,
    archetype: null,
    submittedAt: 0,
    problems: [],
    registered: true,
    fromList: true,
    locked: true
  });
  let owned = 0;
  const viewerOf = (index: number) => {
    const { firstName, lastName, popId } = players[index]!;
    const me = keys[t.players[index]!.id];
    return sanctioned
      ? { role: null, me, via: 'pop', claim: { popId }, signedIn: true }
      : { role: null, me, via: 'claim', claim: { firstName, lastName }, signedIn: true };
  };
  const lists: { method: string; query: Record<string, string> }[] = [];
  await page.route(`**/tournaments/v1/${code}.json`, route =>
    route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } })
  );
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: { ...ME, popId: sanctioned ? '1001' : null }, providers: [] } });
    }
    if (url.pathname === `/api/tournaments/${code}/decklists`) {
      const query = Object.fromEntries(url.searchParams);
      lists.push({ method: request.method(), query });
      const asked = players.findIndex(player =>
        sanctioned
          ? query.popId === player.popId
          : query.lastName === player.lastName && query.firstName === player.firstName
      );
      const own = asked === owned && !query.token;
      if (request.method() === 'DELETE') {
        return route.fulfill({ status: own ? 204 : 409, json: own ? undefined : { error: 'Locked' } });
      }
      return route.fulfill({ json: { decklists: [], mine: own ? listOf(players[asked]!) : null } });
    }
    return route.fulfill({ json: { ...published, viewer: viewerOf(owned) } });
  });
  return {
    code,
    lists,
    /** The account's Claim made the second player's, on another device. */
    claim: () => {
      owned = 1;
    }
  };
}

for (const sanctioned of [true, false]) {
  test(`on a device that kept no list, the account sees and withdraws its own, ${sanctioned ? 'by its POP ID' : 'by its Claim'}`, async ({
    page
  }) => {
    const { code, lists } = await mockOwnList(page, sanctioned);
    await page.goto(`/t/${code}?tab=decklist`);
    await expect(page.locator('.tm-decklist-status')).toContainText('Submitted');
    await expect(page.locator('#deck-list')).toHaveValue('60 Grass Energy');
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page
      .getByRole('group', { name: 'Withdraw your decklist?' })
      .getByRole('button', { name: 'Withdraw' })
      .click();
    await expect(page.locator('.tm-decklist-status')).toContainText('Not submitted');
    const owner = sanctioned ? { popId: '1001' } : { firstName: 'Mary', lastName: 'Jackson' };
    expect(lists.map(ask => ask.method)).toEqual(['GET', 'DELETE']);
    for (const ask of lists) {
      expect(ask.query).toMatchObject(owner);
      expect(ask.query.token).toBeUndefined();
    }
  });
}

test('a list whose owner changes while the form is being edited shows the new owner’s, and withdraws theirs', async ({
  page
}) => {
  const { code, lists, claim } = await mockOwnList(page, false);
  await page.goto(`/t/${code}?tab=decklist`);
  const deck = page.locator('#deck-list');
  await expect(deck).toHaveValue('60 Grass Energy');
  await deck.fill('59 Grass Energy');
  claim();
  await showAgain(page);
  await expect(deck).toHaveValue('60 Fire Energy');
  await expect(page.locator('.tm-known')).toContainText('Ash Ketchum');
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('group', { name: 'Withdraw your decklist?' }).getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.locator('.tm-decklist-status')).toContainText('Not submitted');
  expect(lists.filter(ask => ask.method === 'DELETE').map(ask => ask.query)).toEqual([
    { popId: '', firstName: 'Ash', lastName: 'Ketchum' }
  ]);
});

// ---------- The dashboard (/host signed in) ----------

const SUMMARY = {
  code: 'OWNED1',
  name: 'Thursday Locals',
  startDate: '09/24/2026',
  mode: 'swiss',
  players: 12,
  rounds: 4,
  finished: true,
  role: 'owner',
  updatedAt: 0
};

/** The account's History, as mockAccount gives it, and the events it runs. */
async function mockDashboard(page: Page, user: typeof ME, events: (typeof SUMMARY)[] = []) {
  const errors = await mockAccount(page, user);
  await publishCopies(page);
  await page.route('**/api/tournaments', route => route.fulfill({ json: { tournaments: events } }));
  await page.route('**/api/applications/mine', route =>
    route.fulfill({ json: { application: null, proof: null, eligible: { profile: true, email: true } } })
  );
  return errors;
}

test('the dashboard of a player who runs nothing is its Playing tab alone, the live match first @mobile', async ({
  page
}) => {
  const errors = await mockDashboard(page, ME);
  await page.goto('/host');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Playing');
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.tm-account-strip')).toHaveCount(0);
  const live = page.locator('.tm-dash-live');
  await expect(live).toContainText('Fixture Challenge & Friends · Round 2');
  await expect(live).toContainText('vs ');
  await expect(live.getByRole('link', { name: 'Your match' })).toHaveAttribute('href', '/t/LIVE01');
  const cup = page.locator('.tm-hist tbody tr.is-link', { hasText: 'Fixture Cup' });
  await expect(cup.locator('.tm-hist-place')).toHaveText('1st');
  // Decks are sprites alone here; their names stay in the tooltip and for assistive tech.
  await expect(page.locator('.tm-hist-icons .tm-hist-deck-name').first()).toBeHidden();
  await expect(page).toHaveTitle('Playing — Ciphermaniac');
  expect(errors).toEqual([]);
});

test('the dashboard’s account menu holds the account’s pages, and the way to apply only for a player', async ({
  page
}) => {
  await mockDashboard(page, ME);
  await page.goto('/host');
  const button = page.getByRole('button', { name: 'Account' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  for (const [name, href] of [
    ['History', '/history'],
    ['Settings', '/settings'],
    ['Apply to organize', '/apply']
  ]) {
    await expect(page.locator('.tm-acct-menu').getByRole('link', { name })).toHaveAttribute('href', href);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.tm-acct-menu')).toHaveCount(0);
  await page.unrouteAll();
  await mockDashboard(page, { ...ME, role: 'community' });
  await page.goto('/host');
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.locator('.tm-acct-menu').getByRole('link', { name: 'Apply to organize' })).toHaveCount(0);
});

test('an organizer who plays has both tabs, opens on the match being played, and keeps the tab in the address', async ({
  page
}) => {
  await mockDashboard(page, { ...ME, role: 'community' }, [SUMMARY]);
  await page.goto('/host');
  const tabs = page.locator('.tm-dash-tabs');
  await expect(tabs.getByRole('tab')).toHaveText(['Playing1', 'Organizing']);
  await expect(tabs.getByRole('tab', { name: /Playing/ })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Organizing' }).click();
  await expect(page).toHaveURL(/\/host\?tab=organizing$/);
  await expect(page.getByRole('button', { name: 'Start an event' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Thursday Locals' })).toHaveAttribute('href', '/host/OWNED1');
  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'Organizing' })).toHaveAttribute('aria-selected', 'true');
});

test('on a phone the dashboard’s tabs move to a bar along the bottom, and the heading names the open one @mobileOnly', async ({
  page
}) => {
  await mockDashboard(page, { ...ME, role: 'community' }, [SUMMARY]);
  await page.goto('/host?tab=organizing');
  await expect(page.locator('.tm-dash-tabs')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organizing');
  const bar = page.locator('.tm-dash-bar');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  // Scrolled to the end, the site's foot clears the bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const foot = await page.getByRole('button', { name: /mode$/ }).boundingBox();
  expect((foot?.y ?? 0) + (foot?.height ?? 0)).toBeLessThanOrEqual(box?.y ?? 0);
  await bar.getByRole('tab', { name: /Playing/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Playing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a player whose Application is pending has the Organizing tab, which a reload keeps, with where it stands', async ({
  page
}) => {
  await mockDashboard(page, ME);
  await page.route('**/api/applications/mine', route =>
    route.fulfill({
      json: {
        application: {
          id: 'app-1',
          status: 'pending',
          explanation: '',
          proofType: null,
          createdAt: 0,
          decidedAt: null,
          note: null,
          store: null
        },
        proof: null,
        eligible: { profile: true, email: true }
      }
    })
  );
  await page.goto('/host?tab=organizing');
  await expect(page.locator('.tm-dash-tabs').getByRole('tab', { name: 'Organizing' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.locator('.tm-applicant-line')).toHaveText('Application pending');
});

test('the dashboard’s tabs move with the arrow keys, and name the panel they open', async ({ page }) => {
  await mockDashboard(page, { ...ME, role: 'community' }, [SUMMARY]);
  await page.goto('/host');
  const tabs = page.locator('.tm-dash-tabs');
  await tabs.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Organizing' })).toBeFocused();
  await expect(page).toHaveURL(/tab=organizing/);
  await expect(page.getByRole('tabpanel', { name: 'Organizing' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab', { name: /Playing/ })).toBeFocused();
});
