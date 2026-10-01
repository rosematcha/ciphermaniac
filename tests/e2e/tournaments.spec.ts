/**
 * The tournament pages against mocked functions: the public page shows the
 * current round's tables and a searchable field, opens a player's history,
 * ranks a combined pod per division, and never asks a signed-out player to
 * do more than sign in. The data is the hand-written mid-event .tdf fixture,
 * run through the same public-view code the function uses.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import { applyCommand } from '../../shared/tournament/commands';
import { seededRandom } from '../../shared/tournament/random';
import { parseTdf } from '../../shared/tournament/tdf';
import {
  applyPending,
  assignKeys,
  DEFAULT_SETTINGS,
  isSanctioned,
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
    if (url.pathname === `/api/tournaments/${CODE}/report`) {
      const claim = route.request().postDataJSON() as { popId?: string; lastName?: string };
      const player = tdf.players.find(p => p.id === claim.popId || p.lastName === claim.lastName);
      return player
        ? route.fulfill({ json: { key: keys[player.id], view } })
        : route.fulfill({ status: 404, json: { error: 'No player by that name is in this event' } });
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
  await expect(sheet.locator('.tm-history tbody tr')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'This is me' }).click();
  // Saying so takes proof: the Player ID at a sanctioned event, the last name at any other.
  const hedy = tdf.players.find(p => p.lastName === 'Lamarr');
  const [label, right, wrong] = isSanctioned(VIEW)
    ? ['Player ID', hedy?.id ?? '', '7200001']
    : ['Last name', 'Lamarr', 'Jackson'];
  await sheet.getByLabel(label).fill(wrong);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.locator('.tm-error')).toContainText('isn’t this player’s');
  await sheet.getByLabel(label).fill(right);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByRole('button', { name: 'This isn’t me' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tm-you-big')).toHaveText(/Table\s*2/);
  await expect(page.locator('.tm-you-who')).toContainText('Hedy Lamarr');
  expect(errors).toEqual([]);
});

/** The event's published file on the data origin: what the page reads first, and then polls. */
async function publish(page: Page, current: () => TournamentView) {
  await page.route(`**/tournaments/v1/${CODE}.json`, route => {
    const { viewer: _viewer, ...published } = current();
    return route.fulfill({ json: published, headers: { 'access-control-allow-origin': '*' } });
  });
}

/** The fixture with its first open table of round 2 won by player one, as the next version. */
function afterOneResult(): TournamentView {
  const next = structuredClone(VIEW);
  const open = next.tournament.pods[0]?.rounds.at(-1)?.matches.find(match => match.outcome === 'pending');
  if (!open) {
    throw new Error('the fixture has no open table');
  }
  open.outcome = 'p1';
  return { ...next, version: VIEW.version + 1 };
}

/** Word from the console in another tab that the event moved on, as lib/tournament/changes.ts sends it. */
const announce = (page: Page, version: number) =>
  page.evaluate(change => new BroadcastChannel('cm-tournament-changes').postMessage(change), { code: CODE, version });

test('a player opening the page reads the published file, and asks the functions for no event', async ({ page }) => {
  await mockApi(page);
  await publish(page, () => VIEW);
  const asked: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === `/api/tournaments/${CODE}`) {
      asked.push(request.url());
    }
  });
  await page.goto(`/t/${CODE}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
  expect(asked).toEqual([]);
});

test('a result coming in redraws its own table, and leaves the search and the other tables as they were', async ({
  page
}) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}`);
  const rows = page.locator('.tm-matches tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Playing' })).toHaveCount(2);
  const search = page.getByRole('searchbox', { name: 'Find a player' });
  await search.focus();
  // Marked, so a row or a search box drawn again from nothing shows as one that lost its mark.
  await page.locator('.tm-matches tbody tr, .tm-public-pairings input').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  view = afterOneResult();
  await announce(page, view.version);
  await expect(rows.filter({ hasText: 'Playing' })).toHaveCount(1);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('data-kept', '');
  await expect(page.locator('.tm-matches tbody tr[data-kept]')).toHaveCount(3);
});

test('a result coming in re-ranks the standings in place', async ({ page }) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}?tab=standings`);
  const rows = page.locator('.tm-standings tbody tr');
  await expect(rows).toHaveCount(8);
  const search = page.getByRole('searchbox', { name: 'Find a player' });
  await search.focus();
  await page.locator('.tm-standings tbody tr, .tm-standings-bar input').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  const before = await rows.allInnerTexts();
  view = afterOneResult();
  await announce(page, view.version);
  await expect.poll(() => rows.allInnerTexts()).not.toEqual(before);
  await expect(search).toBeFocused();
  await expect(page.locator('.tm-standings tbody tr[data-kept]')).toHaveCount(8);
});

test('a result coming in leaves the big screen’s other tables where they were', async ({ page }) => {
  let view = VIEW;
  await mockApi(page);
  await publish(page, () => view);
  await page.goto(`/t/${CODE}?screen=1`);
  const tables = page.locator('.tm-screen-tables li');
  await expect(tables).toHaveCount(4);
  await expect(page.locator('.tm-screen-tables li.is-done')).toHaveCount(1);
  await page.locator('.tm-screen-pod, .tm-screen-tables li').evaluateAll(els => {
    els.forEach(el => el.setAttribute('data-kept', ''));
  });
  view = afterOneResult();
  await announce(page, view.version);
  await expect(page.locator('.tm-screen-tables li.is-done')).toHaveCount(2);
  await expect(page.locator('.tm-screen-pod[data-kept]')).toHaveCount(1);
  await expect(page.locator('.tm-screen-tables li[data-kept]')).toHaveCount(3);
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
  // The home page offers sign-in at the top and again at the end.
  const google = page.getByRole('link', { name: 'Sign in with Google' }).first();
  await expect(google).toHaveAttribute('href', '/api/auth/login/google?next=%2Fhost');
  await expect(page.getByRole('link', { name: 'Sign in with Discord' }).first()).toBeVisible();
  // The server has to see the click: the client router must not take it as one of its own routes.
  const login = page.waitForRequest(
    request => request.isNavigationRequest() && new URL(request.url()).pathname === '/api/auth/login/google'
  );
  await google.click();
  await login;
});

async function mockOrganizer(page: Page) {
  const submissions: unknown[] = [];
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/me') {
      return route.fulfill({
        json: { user: { id: 'organizer', name: 'Organizer', role: 'organizer' }, providers: [] }
      });
    }
    if (pathname === '/api/tournaments' && route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { error: 'Fixture submission' } });
    }
    return route.fulfill({ json: { tournaments: [] } });
  });
  return submissions;
}

test('sanctioned setup requires Play! Tools confirmation; local setup skips it @mobile', async ({ page }) => {
  const submissions = await mockOrganizer(page);
  await page.goto('/host');
  await page.getByRole('button', { name: 'Start an event' }).click();
  const create = page.getByRole('button', { name: 'Create event' });
  const confirmation = page.getByRole('checkbox', { name: 'I’ve created this event in Play! Tools' });
  await expect(create).toBeDisabled();
  await page.getByRole('textbox', { name: 'Event name' }).fill('Tuesday League');
  await expect(create).toBeEnabled();
  await expect(confirmation).toHaveCount(0);
  const sanctioned = page.getByRole('tablist', { name: 'Sanctioned', exact: true });
  await sanctioned.getByRole('tab', { name: 'Yes', exact: true }).click();
  await expect(confirmation).not.toBeChecked();
  await expect(create).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Play! Tools', exact: true })).toHaveAttribute(
    'href',
    'https://play-tools.pokemon.com/'
  );
  await expect(page.getByRole('link', { name: 'Sanctioning guide' })).toHaveAttribute(
    'href',
    'https://play-tools.pokemon.com/guide'
  );
  // A programmatic submit must obey the same gate as the disabled button.
  await page.locator('.tm-setup').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true })));
  expect(submissions).toEqual([]);
  await confirmation.check();
  await expect(create).toBeEnabled();
  await confirmation.uncheck();
  await expect(create).toBeDisabled();
  await sanctioned.getByRole('tab', { name: 'No', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(create).toBeEnabled();
  await sanctioned.getByRole('tab', { name: 'Yes', exact: true }).click();
  await confirmation.check();
  await create.click();
  await expect(page.locator('.tm-error')).toHaveText('Fixture submission');
  expect(submissions).toEqual([
    expect.objectContaining({ name: 'Tuesday League', settings: expect.objectContaining({ sanctioned: true }) })
  ]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Start an event' }).click();
  await sanctioned.getByRole('tab', { name: 'Yes', exact: true }).click();
  await expect(confirmation).not.toBeChecked();
});

test('a TOM sanction ID shows an unchecked confirmation; an unsanctioned file skips it', async ({ page }) => {
  await mockOrganizer(page);
  // Use the upload fallback, so the test supplies a file without an OS picker.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
  await page.goto('/host');
  const buffer = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url));
  await page.locator('input[type="file"]').setInputFiles({ name: 'challenge.tdf', mimeType: 'text/xml', buffer });
  const confirmation = page.getByRole('checkbox', { name: 'I’ve created this event in Play! Tools' });
  const create = page.getByRole('button', { name: 'Create event' });
  await expect(confirmation).not.toBeChecked();
  await expect(create).toBeDisabled();
  await confirmation.check();
  await expect(create).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'local.tdf',
    mimeType: 'text/xml',
    buffer: Buffer.from(buffer.toString().replace('<id>26-09-000456</id>', '<id></id>'))
  });
  await expect(confirmation).toHaveCount(0);
  await expect(create).toBeEnabled();
});

test('the big screen hides the site chrome and shows a QR code to the event', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  // One row per table in order, then the bye: round 2 seats seven players at three tables.
  const rows = page.locator('.tm-screen-tables li');
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator('.tm-screen-table')).toHaveText('1');
  await expect(page.locator('.topnav')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Event page QR code' })).toBeVisible();
});

test('the big screen remembers two per row and cycles its scroll speed with S', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.getByRole('tab', { name: 'Slow' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('s');
  await expect(page.getByRole('tab', { name: 'Moderate' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Show two per row' }).click();
  await expect(page.locator('.tm-screen')).toHaveClass(/is-two/);
  await page.reload();
  await expect(page.locator('.tm-screen')).toHaveClass(/is-two/);
  await expect(page.getByRole('tab', { name: 'Moderate' })).toHaveAttribute('aria-selected', 'true');
});

test('before round 1 the big screen lists everyone registered, by last name', async ({ page }) => {
  const unpaired = { ...VIEW.tournament, pods: VIEW.tournament.pods.map(pod => ({ ...pod, rounds: [] })) };
  await mockApi(page, { ...VIEW, tournament: unpaired });
  await page.goto(`/t/${CODE}?screen=1`);
  const players = VIEW.tournament.players.filter(p => p.droppedAfter === null);
  await expect(page.locator('.tm-screen-registered li')).toHaveCount(players.length);
  await expect(page.locator('.tm-screen-registered li').first()).toHaveText('Frances Allen');
  await expect(page.locator('.tm-screen-status')).toHaveText(`Registration · ${players.length} players`);
});

test('before round 1 the public page lists everyone registered @mobile', async ({ page }) => {
  const unpaired = { ...VIEW.tournament, pods: VIEW.tournament.pods.map(pod => ({ ...pod, rounds: [] })) };
  await mockApi(page, { ...VIEW, tournament: unpaired });
  await page.goto(`/t/${CODE}`);
  const players = VIEW.tournament.players.filter(p => p.droppedAfter === null);
  await expect(page.locator('.tm-status')).toHaveText(`Registration · ${players.length} players`);
  await expect(page.locator('.tm-registered li')).toHaveCount(players.length);
});

test('the player sheet keeps Tab inside it until it closes', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/t/${CODE}`);
  await page.locator('.tm-matches tbody tr').first().getByRole('button').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
});

test('a first load that fails offers Retry, which loads the event', async ({ page }) => {
  await mockApi(page);
  let failing = true;
  await page.route(`**/api/tournaments/${CODE}`, route =>
    failing ? route.fulfill({ status: 500, json: { error: 'Something went wrong' } }) : route.fallback()
  );
  await page.goto(`/t/${CODE}`);
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  failing = false;
  await retry.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture Challenge & Friends');
});

const TDF_SOURCE = readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8');

/** A signed-in organizer's console for the TOM event, with a browser that can link files. */
/** The console's copy of the TOM event the file below holds. */
const tomManage = () => ({
  ...VIEW,
  tournament: tdf,
  decks: {},
  settings: DEFAULT_SETTINGS,
  role: 'owner',
  staffToken: 'invite'
});

type Answer = { status: number; json: unknown };
type SyncAnswer = Answer | null;

/**
 * A console following a linked file; `sync` answers each sync, and null leaves
 * one hanging; `pairing` answers each ask for the next round.
 */
async function tomConsole(
  page: Page,
  sync: (body: string) => SyncAnswer | Promise<SyncAnswer>,
  { manage = tomManage(), pairing }: { manage?: unknown; pairing?: (body: unknown) => Answer } = {}
) {
  await page.addInitScript(source => {
    const file = { modified: 1, lost: false, text: source };
    Object.assign(window, {
      tdfFile: file,
      showOpenFilePicker: async () => [
        {
          name: 'event.tdf',
          getFile: async () => {
            if (file.lost) {
              throw new DOMException('The file cannot be read', 'NotAllowedError');
            }
            return new File([file.text], 'event.tdf', { lastModified: file.modified });
          },
          createWritable: async () => ({
            write: async (text: string) => {
              file.text = text;
              file.modified += 1;
            },
            close: async () => undefined
          }),
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted'
        }
      ]
    });
  }, TDF_SOURCE);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      const account = { ...user, birthDate: null, role: 'organizer', publicSlug: null, providers: ['dev'] };
      return route.fulfill({ json: { user: account, providers: ['dev'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/sync`) {
      return Promise.resolve(sync(route.request().postData() ?? '')).then(answer =>
        answer ? route.fulfill(answer) : undefined
      );
    }
    if (url.pathname === `/api/tournaments/${CODE}/pairing` && pairing) {
      return route.fulfill(pairing(route.request().postDataJSON()));
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await page.getByRole('button', { name: 'Link .tdf file' }).click();
}

test('a TOM console stops following its file when another copy was synced over it', async ({ page }) => {
  await tomConsole(page, () => ({ status: 409, json: { error: 'The site has a different copy of this event.' } }));
  await expect(page.getByText('The site has a different copy of this event.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect event.tdf' })).toBeVisible();
});

test('a TOM console holds off results when the browser takes back the file', async ({ page }) => {
  await tomConsole(page, () => ({ status: 200, json: { ...tomManage(), version: 5, revision: 'next' } }));
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { tdfFile: { lost: boolean } }).tdfFile.lost = true;
  });
  await expect(page.getByRole('button', { name: 'Reconnect event.tdf' })).toBeVisible();
});

const synced = () => ({ status: 200, json: { ...tomManage(), version: 5, revision: 'next' } });

test('a TOM console gives up on a sync that hangs and sends the file again', async ({ page }) => {
  await page.clock.install();
  let syncs = 0;
  await tomConsole(page, () => (++syncs === 1 ? null : synced()));
  await expect.poll(() => syncs).toBe(1);
  await page.clock.fastForward(31_000);
  await expect(page.getByText('Could not send the .tdf: The site took too long to answer')).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.getByText('The site took too long to answer')).toBeHidden();
  expect(syncs).toBeGreaterThan(1);
});

test('a TOM console reads the file again for a refresh pressed while a sync is under way', async ({ page }) => {
  const bodies: string[] = [];
  let release = () => undefined as void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await tomConsole(page, async body => {
    bodies.push(body);
    if (bodies.length === 2) {
      await held;
    }
    return synced();
  });
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('Fixture Challenge', 'Saved Once');
    file.modified = 2;
  });
  await expect.poll(() => bodies.length).toBe(2);
  // TOM saves again within the same modified time, which only a refresh picks up.
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string } }).tdfFile;
    file.text = file.text.replace('Saved Once', 'Saved Twice');
  });
  await page.getByRole('button', { name: 'Refresh .tdf' }).first().click();
  release();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toContain('Saved Twice');
});

test('a TOM console says when the file TOM saved does not parse', async ({ page }) => {
  await tomConsole(page, synced);
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await page.evaluate(() => {
    const file = (window as unknown as { tdfFile: { text: string; modified: number } }).tdfFile;
    file.text = file.text.replace('outcome="1"', 'outcome="4"');
    file.modified = 2;
  });
  await expect(page.getByText('Could not parse the .tdf: Unknown match outcome "4"')).toBeVisible();
});

test('a TOM console pairs the next round into the file once every result is in', async ({ page }) => {
  const pod = tdf.pods[0]!;
  const round = pod.rounds.at(-1)!;
  const pending = round.matches
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({
      pod: pod.category,
      round: round.number,
      table: m.table,
      p1: m.p1,
      p2: m.p2,
      outcome: 'p1' as const,
      at: 0
    }));
  const settled = () => ({ status: 200, json: { ...tomManage(), pending, version: 5, revision: 'next' } });
  const asked: unknown[] = [];
  // The site pairs over the results entered on it, as the pairing function does for a TOM event.
  const paired = applyCommand(
    applyPending(tdf, pending),
    { type: 'pairRound', pod: pod.category },
    { now: 0, localTime: '09/30/2026 13:00:00', season: 2027, random: seededRandom(7) }
  );
  const pairing = (body: unknown) => {
    asked.push(body);
    return paired.ok
      ? { status: 200, json: { tournament: paired.tournament } }
      : { status: 400, json: { error: paired.error } };
  };
  await tomConsole(page, settled, { manage: { ...tomManage(), pending }, pairing });
  await expect(page.getByRole('button', { name: 'Write 2 results to .tdf' })).toBeVisible();
  const sent = page.waitForRequest(
    request => request.url().endsWith('/sync') && request.postDataJSON().tournament.pods[0].rounds.length === 3
  );
  await page.getByRole('button', { name: 'Pair round 3' }).click();
  const ask = page.getByRole('group', { name: 'Pair into the .tdf' });
  await expect(ask).toContainText('Close the event in TOM before writing, then reopen the file in TOM.');
  await ask.getByRole('button', { name: 'Pair round 3' }).click();
  const followed = await sent;
  expect(asked).toEqual([expect.objectContaining({ pod: pod.category, base: 'next' })]);
  expect(followed.postDataJSON().base).toBe('next');
  const written = parseTdf(
    await page.evaluate(() => (window as unknown as { tdfFile: { text: string } }).tdfFile.text)
  );
  const [, second, third] = written.pods[0]!.rounds;
  expect(second?.matches.every(m => m.outcome !== 'pending')).toBe(true);
  expect(third?.number).toBe(3);
  expect(third?.matches.filter(m => m.p2 !== null).every(m => m.outcome === 'pending')).toBe(true);
});

test('a TOM console offers no next round once TOM has finalized the file', async ({ page }) => {
  const finalized = parseTdf(readFileSync(new URL('../fixtures/tdf/cup-finalized.tdf', import.meta.url), 'utf8'));
  const done = { ...tomManage(), tournament: finalized };
  await tomConsole(page, () => ({ status: 200, json: { ...done, version: 5, revision: 'next' } }), { manage: done });
  await expect(page.getByRole('button', { name: 'Refresh .tdf' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pair / })).toHaveCount(0);
});
