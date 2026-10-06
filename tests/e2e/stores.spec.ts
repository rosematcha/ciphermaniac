/**
 * Stores and community organizers, against mocked functions: the apply
 * page's two ways in (a Community organizer at once, a store through its
 * Application with the league looked up), store settings (league nights,
 * staff and invites, details), a store's public page, joining from an invite
 * link, and starting a store's event from its pokemon.com listings.
 */

import { expect, type Page, test } from '@playwright/test';

import type { AccountRole } from '../../shared/accounts/roles';
import type { GivenRole, StoreRole } from '../../shared/accounts/stores';
import type {
  ApplicationState,
  LeagueFound,
  Listing,
  MyStore,
  PublicStore,
  StoreInvite,
  StoreMember
} from '../../shared/accounts/types';

const ME = {
  id: 'acct-1',
  name: 'Mary Jackson',
  avatar: null,
  popId: '7200001' as string | null,
  firstName: 'Mary',
  lastName: 'Jackson',
  birthDate: '1995',
  role: null as AccountRole | null,
  handle: 'mary',
  publicProfile: false,
  profileName: 'real' as 'real' | 'handle',
  providers: ['google'],
  stores: [] as MyStore[]
};

const MY_STORE: MyStore = {
  id: 'store-1',
  name: 'Combat Power Gaming',
  leagueId: '6238620',
  status: 'active',
  timeZone: 'America/Chicago',
  role: 'manager'
};

const MANAGER = { ...ME, stores: [MY_STORE] };

const NONE: ApplicationState = { application: null, proof: null, eligible: { profile: true } };

const FOUND: LeagueFound = {
  leagueId: '6238620',
  shop: 'COMBAT POWER GAMING',
  // As pokemon.com lists it, on one line; the city and region are the locator's own reading of the place.
  address: '4522 FREDERICKSBURG RD SUITE B64, SAN ANTONIO, TX 78201, US',
  city: 'Balcones Heights',
  region: 'Texas',
  cc: 'US',
  lat: 29.4928,
  lon: -98.552,
  timeZone: 'America/Chicago'
};

const STORE: PublicStore = {
  id: 'store-1',
  leagueId: '6238620',
  name: 'Combat Power Gaming',
  address: '4522 Fredericksburg Rd #B64',
  city: 'San Antonio',
  region: 'TX',
  postal: '78201',
  country: 'US',
  lat: 29.4928,
  lon: -98.552,
  timeZone: 'America/Chicago',
  website: 'https://combatpower.example',
  discord: 'https://discord.gg/combatpower',
  details: 'Cards, coffee and a big back room.',
  nights: [
    { id: 'wed', weekday: 3, time: '19:30', name: 'Locals', fee: '$5' },
    { id: 'sun', weekday: 0, time: '15:00', name: '', fee: '$5' }
  ],
  exceptions: [{ date: '2099-10-11', nightId: 'sun', time: null, note: 'League Cup' }],
  events: [
    {
      code: 'CUP111',
      name: 'Combat Power League Cup',
      startDate: '10/11/2099',
      startsAt: '2099-10-11T11:00',
      sanctioned: true,
      status: 'upcoming'
    }
  ]
};

const LISTINGS: Listing[] = [
  { sanctionId: '26-10-019101', kind: 'local', name: 'Combat Power Locals', date: '2099-10-07', time: '19:30' },
  { sanctionId: '26-10-007710', kind: 'cup', name: 'Combat Power League Cup', date: '2099-10-11', time: '11:00' }
];

const member = (id: string, name: string, role: StoreRole, hasPopId = true): StoreMember => ({
  id,
  name,
  role,
  hasPopId,
  addedAt: 0
});

interface Asked {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

interface Options {
  user?: typeof ME | null;
  state?: ApplicationState;
  league?: { league: LeagueFound | null; taken: boolean } | 'fail';
  role?: StoreRole | null;
  listings?: Listing[];
  /** Who is in the store; an Owner, Mary as a Manager, and Sam as Staff unless said otherwise. */
  members?: StoreMember[];
}

/** The functions as the pages call them, holding a store's state as they would, and every ask they get. */
async function mock(page: Page, options: Options = {}) {
  const asks: Asked[] = [];
  let user = options.user === undefined ? ME : options.user;
  let state = options.state ?? NONE;
  let store = STORE;
  let members = options.members ?? [
    member('acct-0', 'Lee Owens', 'owner'),
    member('acct-1', 'Mary Jackson', 'manager'),
    member('acct-2', 'Sam Ortiz', 'staff', false)
  ];
  let invites: StoreInvite[] = [];
  await page.route('https://tile.openstreetmap.org/**', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    })
  );
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const { pathname } = url;
    const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : null;
    asks.push({ method, path: pathname, query: url.search, body });
    const key = `${method} ${pathname}`;
    if (key === 'GET /api/me') {
      return route.fulfill({ json: { user, providers: ['google', 'discord'] } });
    }
    if (key === 'GET /api/applications/mine') {
      return route.fulfill({ json: state });
    }
    if (method === 'GET' && pathname.startsWith('/api/leagues/')) {
      const league = options.league ?? { league: FOUND, taken: false };
      return league === 'fail'
        ? route.fulfill({ status: 503, json: { error: 'Stores are not available' } })
        : route.fulfill({ json: { leagueId: '6238620', ...league } });
    }
    if (key === 'POST /api/community') {
      user = user && { ...user, role: 'community' };
      return route.fulfill({ json: { user } });
    }
    if (key === 'POST /api/applications') {
      const application = {
        id: 'app-1',
        status: 'pending' as const,
        explanation: String(body?.explanation ?? ''),
        proofType: null,
        createdAt: Date.UTC(2026, 9, 4),
        decidedAt: null,
        note: null,
        store: null
      };
      state = { ...state, application };
      return route.fulfill({ status: 201, json: { application } });
    }
    if (key === 'GET /api/stores/store-1') {
      const role = options.role === undefined ? 'manager' : options.role;
      return route.fulfill({
        json: { store, role, ...(role ? { contact: { phone: '(210) 555-0100', email: 'hi@combat.example' } } : {}) }
      });
    }
    if (key === 'PATCH /api/stores/store-1') {
      const sent = body as { details: Record<string, string>; timeZone: string };
      store = { ...store, ...sent.details, timeZone: sent.timeZone };
      return route.fulfill({ json: { store: { ...store, status: 'active', ...sent.details } } });
    }
    if (key === 'PUT /api/stores/store-1/nights') {
      const sent = body as Pick<PublicStore, 'nights' | 'exceptions'>;
      store = { ...store, ...sent };
      return route.fulfill({ json: sent });
    }
    if (key === 'GET /api/stores/store-1/members') {
      return route.fulfill({ json: { members, invites } });
    }
    if (key === 'POST /api/stores/store-1/members') {
      // The token's hash starts with the id the list gives it, as the server names a link.
      invites = [
        { id: '2f237cea451ff8f2', role: body?.invite as GivenRole, createdAt: 0, expiresAt: Date.UTC(2099, 9, 11) }
      ];
      return route.fulfill({ status: 201, json: { token: 'k3QwP9zXr2' } });
    }
    if (key === 'PATCH /api/stores/store-1/members') {
      // Handing the store over makes the Owner before a Manager.
      const handing = body?.role === 'owner';
      members = members.map(m =>
        m.id === body?.user
          ? { ...m, role: body.role as StoreRole }
          : handing && m.role === 'owner'
            ? { ...m, role: 'manager' as const }
            : m
      );
      return route.fulfill({ json: { members, invites } });
    }
    if (key === 'DELETE /api/stores/store-1/members') {
      const gone = url.searchParams.get('user');
      members = members.filter(m => m.id !== gone);
      invites = invites.filter(i => i.id !== url.searchParams.get('invite'));
      return route.fulfill({ status: 204 });
    }
    if (key === 'GET /api/stores/store-1/listings') {
      return route.fulfill({ json: { listings: options.listings ?? LISTINGS } });
    }
    if (key === 'POST /api/stores/join') {
      return body?.token === 'good'
        ? route.fulfill({ json: { storeId: 'store-1' } })
        : route.fulfill({ status: 410, json: { error: 'This invite link was used or has run out' } });
    }
    if (key === 'GET /api/tournaments') {
      return route.fulfill({ json: { tournaments: [] } });
    }
    if (key === 'POST /api/tournaments') {
      return route.fulfill({ status: 201, json: { code: 'NEW001' } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return asks;
}

const sentTo = (asks: Asked[], method: string, path: string) =>
  asks.filter(a => a.method === method && a.path === path).map(a => a.body);

// ---------- Apply ----------

test('a player becomes a Community organizer from the first row, and goes on to their events @mobile', async ({
  page
}) => {
  const asks = await mock(page);
  await page.goto('/apply');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run events');
  await expect(page.getByRole('button', { name: 'Start running events' })).toHaveCount(0);
  await page.getByRole('radio', { name: /Community organizer/ }).check();
  await page.getByRole('button', { name: 'Start running events' }).click();
  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole('button', { name: 'Start an event' })).toBeVisible();
  expect(sentTo(asks, 'POST', '/api/community')).toHaveLength(1);
});

test('an account that already runs community events is offered the store row alone', async ({ page }) => {
  await mock(page, { user: { ...ME, role: 'community' } });
  await page.goto('/apply');
  await expect(page.locator('.tm-applicant-stage strong')).toHaveText('Community organizer');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Organized play location/ })).toBeVisible();
});

/** Opens the store form and looks the league up by its pokemon.com page. */
async function lookUp(page: Page) {
  await page.getByRole('radio', { name: /Organized play location/ }).check();
  await page
    .getByLabel('League ID or pokemon.com league page')
    .fill('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/');
  await page.getByRole('button', { name: 'Look up' }).click();
}

test('a store application starts from the league, prefilled, and sends what the functions read @mobile', async ({
  page
}) => {
  const asks = await mock(page);
  await page.goto('/apply');
  await lookUp(page);
  await expect(page.locator('.tm-apply-found')).toContainText('Combat Power Gaming');
  await expect(page.locator('.tm-apply-found')).toContainText(
    '4522 Fredericksburg Rd Suite B64, San Antonio, TX 78201'
  );
  await expect(page.locator('.tm-apply-found')).toContainText('League 6238620 · Central Time');
  await expect(page.getByLabel('Store name')).toHaveValue('Combat Power Gaming');
  await expect(page.getByLabel('Address')).toHaveValue('4522 Fredericksburg Rd Suite B64');
  await expect(page.getByLabel('City')).toHaveValue('San Antonio');
  await expect(page.getByLabel('Postal code')).toHaveValue('78201');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('alert')).toHaveText('Say how you run the store');
  await page.getByLabel('How you run it').selectOption('owner');
  await page.getByRole('checkbox', { name: /certified Play! Pokémon organizer/ }).check();
  await page.getByLabel('Website').fill('combatpower.example');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('Starts with https://')).toBeVisible();
  await page.getByLabel('Website').fill('https://combatpower.example');
  await page.getByRole('button', { name: 'Add a league night' }).click();
  await page.getByLabel('League night 1 day').selectOption('Wednesday');
  await page.getByLabel('League night 1 start').fill('19:30');
  await page.getByLabel('League night 1 fee').fill('$5');
  await page.getByLabel('Note').fill('I own the store.');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  const [sent] = sentTo(asks, 'POST', '/api/applications') as {
    store: Record<string, unknown>;
    explanation: string;
    proof: boolean;
  }[];
  expect(sent?.explanation).toBe('I own the store.');
  expect(sent?.proof).toBe(false);
  expect(sent?.store).toMatchObject({
    leagueId: '6238620',
    place: { lat: FOUND.lat, lon: FOUND.lon, timeZone: 'America/Chicago' },
    timeZone: 'America/Chicago',
    relationship: 'owner',
    certified: true,
    details: {
      name: 'Combat Power Gaming',
      address: '4522 Fredericksburg Rd Suite B64',
      city: 'San Antonio',
      region: 'TX',
      postal: '78201',
      country: 'US',
      website: 'https://combatpower.example'
    },
    nights: [{ weekday: 3, time: '19:30', name: '', fee: '$5' }]
  });
});

test('typing another league after a lookup puts the form away until it is looked up', async ({ page }) => {
  await mock(page);
  await page.goto('/apply');
  await lookUp(page);
  await expect(page.getByLabel('Store name')).toBeVisible();
  await page.getByLabel('League ID or pokemon.com league page').fill('6238621');
  await expect(page.getByLabel('Store name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send application' })).toHaveCount(0);
});

test('a league that already has a store goes no further, and a bad ID is refused before it is asked', async ({
  page
}) => {
  const asks = await mock(page, { league: { league: null, taken: true } });
  await page.goto('/apply');
  await page.getByRole('radio', { name: /Organized play location/ }).check();
  await page.getByLabel('League ID or pokemon.com league page').fill('not a league');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('#apply-league-error')).toHaveText('Enter the league ID, or paste its pokemon.com page');
  expect(asks.some(a => a.path.startsWith('/api/leagues/'))).toBe(false);
  await page.getByLabel('League ID or pokemon.com league page').fill('6238620');
  await page.getByLabel('League ID or pokemon.com league page').press('Enter');
  await expect(page.locator('#apply-league-error')).toHaveText('That league already has a store');
  await expect(page.getByLabel('Store name')).toHaveCount(0);
});

test('a league the locator does not know leaves the details to type, with no place', async ({ page }) => {
  const asks = await mock(page, { league: { league: null, taken: false } });
  await page.goto('/apply');
  await lookUp(page);
  await expect(page.locator('.tm-apply-found')).toHaveCount(0);
  await expect(page.getByLabel('Store name')).toHaveValue('');
  await page.getByLabel('How you run it').selectOption('organizer');
  await page.getByRole('checkbox', { name: /certified/ }).check();
  await page.getByLabel('Store name').fill('Combat Power Gaming');
  await page.getByLabel('Address').fill('4522 Fredericksburg Rd');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.locator('.tm-applicant')).toContainText('Application pending');
  const [sent] = sentTo(asks, 'POST', '/api/applications') as { store: { place: unknown; leagueId: string } }[];
  expect(sent?.store.place).toBeNull();
  expect(sent?.store.leagueId).toBe('6238620');
});

// ---------- Store settings ----------

test('store settings: league nights and the dates that differ save together', async ({ page }) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Combat Power Gaming');
  const nav = page.getByRole('navigation', { name: 'Store settings' });
  await expect(nav.getByRole('button', { name: 'League nights' })).toHaveAttribute('aria-current', 'page');
  // In the order of the week: Sunday's night first.
  await expect(page.getByLabel('League night 1 day')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('League night 2 start').fill('18:30');
  await page.getByRole('button', { name: 'Add a date' }).click();
  await page.getByLabel('Date 2 day').fill('2099-11-25');
  await page.getByLabel('Date 2 change').selectOption('moved');
  await page.getByLabel('Date 2 new start').fill('17:00');
  await page.getByLabel('Date 2 note').fill('Holiday');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  const [sent] = sentTo(asks, 'PUT', '/api/stores/store-1/nights') as Pick<PublicStore, 'nights' | 'exceptions'>[];
  expect(sent?.nights.map(n => `${n.id} ${n.weekday} ${n.time}`)).toEqual(['sun 0 15:00', 'wed 3 18:30']);
  expect(sent?.exceptions).toEqual([
    { date: '2099-10-11', nightId: 'sun', time: null, note: 'League Cup' },
    { date: '2099-11-25', nightId: null, time: '17:00', note: 'Holiday' }
  ]);
});

test('store settings: removing a night a date named turns the date to every night that day', async ({ page }) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings');
  await expect(page.getByLabel('Date 1 night')).toHaveValue('sun');
  await page.getByLabel('League night 1 remove').click();
  await expect(page.getByLabel('Date 1 night')).toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const [sent] = sentTo(asks, 'PUT', '/api/stores/store-1/nights') as Pick<PublicStore, 'nights' | 'exceptions'>[];
  expect(sent?.nights.map(n => n.id)).toEqual(['wed']);
  expect(sent?.exceptions[0]?.nightId).toBeNull();
});

test('store settings: a manager who makes themselves staff goes on to the store page', async ({ page }) => {
  await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings?section=staff');
  const table = page.locator('.tm-store-staff');
  await table.locator('tr', { hasText: 'Sam Ortiz' }).getByRole('button', { name: 'Make manager' }).click();
  await table.locator('tr', { hasText: 'Mary Jackson' }).getByRole('button', { name: 'Make staff' }).click();
  await expect(page).toHaveURL(/\/stores\/store-1$/);
});

test('store settings: staff change role, invite links show once and withdraw', async ({ page }) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings?section=staff');
  const table = page.locator('.tm-store-staff');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const sam = table.locator('tr', { hasText: 'Sam Ortiz' });
  await expect(sam).toContainText('None');
  await sam.getByRole('button', { name: 'Make manager' }).click();
  await expect(sam.getByRole('button', { name: 'Make staff' })).toBeVisible();
  expect(sentTo(asks, 'PATCH', '/api/stores/store-1/members')).toEqual([{ user: 'acct-2', role: 'manager' }]);

  await page.getByRole('button', { name: 'Invite staff' }).click();
  const link = page.getByLabel('Staff invite link');
  await expect(link).toHaveValue(/\/stores\/join\?invite=k3QwP9zXr2$/);
  expect(sentTo(asks, 'POST', '/api/stores/store-1/members')).toEqual([{ invite: 'staff' }]);
  await page.locator('.tm-store-invite').getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.locator('.tm-store-invite')).toHaveCount(0);
  expect(asks.filter(a => a.method === 'DELETE').map(a => a.query)).toEqual(['?invite=2f237cea451ff8f2']);

  await sam.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('group', { name: 'Remove Sam Ortiz?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
});

test('store settings: a Manager can do nothing to the Owner’s row, or hand the store over', async ({ page }) => {
  await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings?section=staff');
  const owner = page.locator('.tm-store-staff tr', { hasText: 'Lee Owens' });
  await expect(owner).toContainText('Owner');
  await expect(owner.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make owner' })).toHaveCount(0);
});

test('store settings: the Owner hands the store over, asked first, and stays on as a Manager free to leave', async ({
  page
}) => {
  const asks = await mock(page, {
    user: { ...ME, stores: [{ ...MY_STORE, role: 'owner' }] },
    role: 'owner',
    members: [member('acct-1', 'Mary Jackson', 'owner'), member('acct-2', 'Sam Ortiz', 'staff')]
  });
  await page.goto('/stores/store-1/settings?section=staff');
  const table = page.locator('.tm-store-staff');
  const mary = table.locator('tr', { hasText: 'Mary Jackson' });
  const sam = table.locator('tr', { hasText: 'Sam Ortiz' });
  await expect(mary.getByRole('button', { name: 'Leave' })).toHaveCount(0);
  await sam.getByRole('button', { name: 'Make owner' }).click();
  await expect(sam).toContainText('Make Sam Ortiz the owner?');
  expect(sentTo(asks, 'PATCH', '/api/stores/store-1/members')).toEqual([]);
  await sam.getByRole('button', { name: 'Make owner' }).click();
  await expect(sam.locator('td').nth(1)).toHaveText('Owner');
  await expect(mary.locator('td').nth(1)).toHaveText('Manager');
  await expect(mary.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expect(sam.getByRole('button')).toHaveCount(0);
  expect(sentTo(asks, 'PATCH', '/api/stores/store-1/members')).toEqual([{ user: 'acct-2', role: 'owner' }]);
});

test('store settings: details save with the store’s place kept', async ({ page }) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings');
  await page.getByRole('navigation', { name: 'Store settings' }).getByRole('button', { name: 'Details' }).click();
  await expect(page).toHaveURL(/section=details/);
  await expect(page.getByLabel('Phone')).toHaveValue('(210) 555-0100');
  await page.getByLabel('Store name').fill('Combat Power Games');
  await page.getByLabel('About the store').fill('Open late.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Combat Power Games');
  const [sent] = sentTo(asks, 'PATCH', '/api/stores/store-1') as {
    details: Record<string, string>;
    place: unknown;
    timeZone: string;
  }[];
  expect(sent?.details).toMatchObject({
    name: 'Combat Power Games',
    details: 'Open late.',
    email: 'hi@combat.example'
  });
  expect(sent?.place).toEqual({ lat: STORE.lat, lon: STORE.lon, timeZone: 'America/Chicago' });
});

test('store settings: staff who are not managers are sent to the store page', async ({ page }) => {
  await mock(page, { user: { ...ME, stores: [{ ...MY_STORE, role: 'staff' }] }, role: 'staff' });
  await page.goto('/stores/store-1/settings');
  await expect(page.getByText('Only this store’s managers can change it.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Store page' })).toHaveAttribute('href', '/stores/store-1');
  await expect(page.getByRole('navigation', { name: 'Store settings' })).toHaveCount(0);
});

test('store settings on a phone: the sections are tabs, and nothing scrolls sideways @mobileOnly', async ({ page }) => {
  await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1/settings');
  const nav = page.getByRole('navigation', { name: 'Store settings' });
  const [first, last] = await Promise.all([
    nav.getByRole('button', { name: 'League nights' }).boundingBox(),
    nav.getByRole('button', { name: 'Details' }).boundingBox()
  ]);
  expect(Math.abs((first?.y ?? 0) - (last?.y ?? 1))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

// ---------- The store's page and joining it ----------

test('a store page shows where it is, its league nights and its upcoming events @mobile', async ({ page }) => {
  await mock(page, { user: null, role: null });
  await page.goto('/stores/store-1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Combat Power Gaming');
  await expect(page.locator('.tm-storepage-address')).toContainText('San Antonio, TX 78201');
  await expect(page.getByRole('link', { name: 'combatpower.example' })).toHaveAttribute(
    'href',
    'https://combatpower.example'
  );
  await expect(page.getByRole('link', { name: 'Directions to Combat Power Gaming' })).toBeVisible();
  const nights = page.locator('.tm-storepage-nights');
  await expect(nights.locator('li').first()).toContainText('Sundays');
  await expect(nights.locator('li').first()).toContainText('3:00 PM');
  await expect(nights).toContainText('Sun, Oct 11');
  await expect(nights).toContainText('League Cup');
  await expect(page.getByRole('link', { name: 'Combat Power League Cup' })).toHaveAttribute('href', '/t/CUP111');
  await expect(page.getByRole('link', { name: 'Store settings' })).toHaveCount(0);
  // Nothing runs past the page's own width, the events table included (the page clips what does).
  const spill = await page.locator('.tm-storepage').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(spill).toBeLessThanOrEqual(0);
  const sunday = await nights.locator('li').first().boundingBox();
  expect((sunday?.x ?? 0) + (sunday?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
});

test('a manager sees the way to the store’s settings from its page', async ({ page }) => {
  await mock(page, { user: MANAGER });
  await page.goto('/stores/store-1');
  await expect(page.getByRole('link', { name: 'Store settings' })).toHaveAttribute('href', '/stores/store-1/settings');
});

test('an invite link joins the store and goes on to its page; a used one says so', async ({ page }) => {
  const asks = await mock(page);
  await page.goto('/stores/join?invite=good');
  await expect(page).toHaveURL(/\/stores\/store-1$/);
  expect(sentTo(asks, 'POST', '/api/stores/join')).toEqual([{ token: 'good' }]);
  await page.goto('/stores/join?invite=old');
  await expect(page.getByRole('alert')).toHaveText('This invite link was used or has run out');
});

test('signed out, an invite link offers sign-in that comes back to it', async ({ page }) => {
  await mock(page, { user: null });
  await page.goto('/stores/join?invite=good');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
    'href',
    /next=%2Fstores%2Fjoin%3Finvite%3Dgood/
  );
});

// ---------- Starting a store's event ----------

test('a store event starts from a listing, which fills the setup and sends its sanction ID @mobile', async ({
  page
}) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/host');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const picker = page.getByRole('group', { name: 'On pokemon.com' });
  await expect(picker.getByRole('radio', { name: 'Not listed here' })).toBeChecked();
  await picker.getByRole('radio', { name: /Combat Power League Cup/ }).check();
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue('Combat Power League Cup');
  await expect(page.getByLabel('Starts')).toHaveValue('2099-10-11T11:00');
  await expect(page.locator('.tm-set-row', { hasText: 'Sanction ID' })).toContainText('26-10-007710');
  await expect(page.getByRole('tab', { name: 'League Cup' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('checkbox', { name: /created this event in Play! Tools/ })).toBeChecked();
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/host\/NEW001/);
  const [sent] = sentTo(asks, 'POST', '/api/tournaments') as Record<string, unknown>[];
  expect(sent).toMatchObject({
    name: 'Combat Power League Cup',
    store: 'store-1',
    sanctionId: '26-10-007710',
    eventType: 'cup',
    settings: { startsAt: '2099-10-11T11:00', sanctioned: true }
  });
});

test('Not listed here keeps what was typed and sends no sanction ID', async ({ page }) => {
  const asks = await mock(page, { user: MANAGER });
  await page.goto('/host');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const picker = page.getByRole('group', { name: 'On pokemon.com' });
  await picker.getByRole('radio', { name: /Combat Power Locals/ }).check();
  await expect(page.locator('.tm-set-row', { hasText: 'Sanction ID' })).toContainText('Local');
  await picker.getByRole('radio', { name: 'Not listed here' }).check();
  await expect(page.locator('.tm-set-row', { hasText: 'Sanction ID' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Event name' })).toHaveValue('Combat Power Locals');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/host\/NEW001/);
  const [sent] = sentTo(asks, 'POST', '/api/tournaments') as Record<string, unknown>[];
  expect(sent?.sanctionId).toBeUndefined();
});

test('an event run under the account’s own name offers no listings', async ({ page }) => {
  const asks = await mock(page, { user: { ...MANAGER, role: 'community' } });
  await page.goto('/host');
  await page.getByRole('button', { name: 'Start an event' }).click();
  await expect(page.getByRole('group', { name: 'On pokemon.com' })).toBeVisible();
  await page.getByLabel('Run as').selectOption({ label: 'Mary Jackson' });
  await expect(page.getByRole('group', { name: 'On pokemon.com' })).toHaveCount(0);
  expect(asks.filter(a => a.path.endsWith('/listings'))).toHaveLength(1);
});

test('store settings’ Start an event opens the setup as the store, and /host links to settings', async ({ page }) => {
  await mock(page, { user: { ...MANAGER, role: 'community' } });
  await page.goto('/stores/store-1/settings');
  await page.getByRole('link', { name: 'Start an event' }).click();
  await expect(page).toHaveURL(/\/host\?new=store-1$/);
  await expect(page.getByLabel('Run as')).toHaveValue('store-1');
  await expect(page.getByRole('group', { name: 'On pokemon.com' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole('link', { name: 'Combat Power Gaming settings' })).toHaveAttribute(
    'href',
    '/stores/store-1/settings'
  );
});
