/**
 * A Swiss event's console and big screen against mocked functions: a double
 * click on a player records their win at once, the console's head offers the
 * top cut, another round and ending the event once the planned rounds are
 * played, decks are named from the pairings, the big screen marks each
 * table's winner as results come in, and staff can unlink a player from an
 * account at an unsanctioned event.
 * The event is built with the same shared commands the functions apply.
 */

import { expect, type Page, test } from '@playwright/test';

import { applyCommand, type Command } from '../../shared/tournament/commands';
import type { PlayerReport } from '../../shared/tournament/reports';
import { emptyTournament } from '../../shared/tournament/create';
import { seededRandom } from '../../shared/tournament/random';
import type { Match, Tournament } from '../../shared/tournament/types';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDivisions,
  publicTournament,
  type TournamentSettings,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'SWISS2';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  let current = tournament;
  for (const command of commands) {
    const ctx = { now: 0, localTime: '09/29/2026 10:00:00', season: 2027, random: seededRandom(3) };
    const result = applyCommand(current, command, ctx);
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    current = result.tournament;
  }
  return current;
}

/** Every open table of the latest round won by the player at seat one. */
function reportAll(t: Tournament): Tournament {
  const pod = t.pods[0];
  const round = pod?.rounds.at(-1);
  const reports: Command[] = (round?.matches ?? [])
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({
      type: 'reportResult',
      pod: pod?.category ?? 'masters',
      round: round?.number ?? 0,
      ...m,
      outcome: 'p1'
    }));
  return run(t, ...reports);
}

/** An unsanctioned event of `players`, with `rounds` played and one more paired when `paired`. */
function event(players: number, rounds: number, paired: boolean): Tournament {
  const adds: Command[] = Array.from({ length: players }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  let t = run(emptyTournament({ name: 'Friday League' }), ...adds);
  for (let r = 0; r < rounds; r += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  return paired ? run(t, { type: 'pairRound', pod: 'masters' }) : t;
}

const settingsOf = (patch: Partial<TournamentSettings>): TournamentSettings => ({
  ...DEFAULT_SETTINGS,
  sanctioned: false,
  ...patch
});

/** The console's API: the event as staff see it, and every command and deck sent recorded. */
async function mockConsole(
  page: Page,
  tournament: Tournament,
  settings: TournamentSettings,
  reports: readonly PlayerReport[] = []
) {
  const sent: Command[] = [];
  const decks: unknown[] = [];
  const manage = {
    code: CODE,
    mode: 'swiss',
    version: 3,
    updatedAt: 0,
    tournament,
    pending: [],
    reports,
    settings,
    decks: {},
    role: 'owner',
    staffToken: 'invite',
    store: 'store-1'
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      const account = {
        ...user,
        birthDate: null,
        role: 'community',
        stores: [],
        handle: 'organizer',
        publicProfile: false,
        profileName: 'real',
        providers: ['dev']
      };
      return route.fulfill({ json: { user: account, providers: ['dev'] } });
    }
    if (url.pathname === `/api/tournaments/${CODE}/manage`) {
      return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/commands`) {
      sent.push((route.request().postDataJSON() as { command: Command }).command);
      return route.fulfill({ json: manage });
    }
    if (url.pathname === `/api/tournaments/${CODE}/decks`) {
      decks.push(route.request().postDataJSON());
      return route.fulfill({ json: manage });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  return Object.assign(sent, { decks });
}

test('a double click on a player records their win without asking', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({}));
  const table = t.pods[0]?.rounds[0]?.matches[0];
  const winner = page.getByRole('button', { name: 'Report Player' }).first();
  await winner.dblclick();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ type: 'reportResult', round: 1, table: table?.table, p1: table?.p1, outcome: 'p1' });
  await expect(page.getByRole('button', { name: 'Record' })).toHaveCount(0);
});

test('a result shows in its row while it is on its way, and its answer is not read a second time', async ({ page }) => {
  const t = event(8, 0, true);
  const table = t.pods[0]?.rounds[0]?.matches[0];
  if (!table) {
    throw new Error('no table');
  }
  await mockConsole(page, t, settingsOf({}));
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows).toHaveCount(4);
  let answer = () => undefined as void;
  const held = new Promise<void>(resolve => {
    answer = resolve;
  });
  const reads: string[] = [];
  await page.route(`**/api/tournaments/${CODE}/manage*`, route => {
    reads.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/tournaments/${CODE}/commands`, async route => {
    await held;
    const tournament = run(t, { type: 'reportResult', pod: 'masters', round: 1, ...table, outcome: 'p1' });
    const manage = { code: CODE, mode: 'swiss', version: 4, updatedAt: 0, tournament, pending: [], reports: [] };
    return route.fulfill({
      json: { ...manage, settings: settingsOf({}), decks: {}, role: 'owner', staffToken: 'invite', store: 'store-1' }
    });
  });
  await rows.evaluateAll(els => els.forEach(el => el.setAttribute('data-kept', '')));
  await page.getByRole('button', { name: 'Report Player' }).first().dblclick();
  // Followed by its number: once its result is in, the table moves under Done.
  const first = rows.filter({ has: page.locator('td.tm-table-col', { hasText: new RegExp(`^${table.table}$`) }) });
  await expect(first.locator('.tm-result-label')).toHaveText('1–0');
  await expect(first.locator('.tm-mark.is-unconfirmed')).toHaveText([/^W/, /^L/]);
  answer();
  await expect(first.locator('.tm-mark.is-win')).toHaveText('W');
  await expect(first.locator('.tm-mark.is-unconfirmed')).toHaveCount(0);
  await expect(page.locator('.tm-matches tbody tr[data-kept]:not(.tm-group-row)')).toHaveCount(3);
  expect(reads).toEqual([]);
});

test('after the planned rounds the console offers the top cut, another round and ending the event', async ({
  page
}) => {
  // Sixteen players play five rounds and a top 4, as Play! Pokémon recommends.
  await mockConsole(page, event(16, 5, false), settingsOf({}));
  await expect(page.getByText('Round 5 of 5 complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start top cut' })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Top cut size' })).toHaveValue('4');
  await expect(page.getByRole('button', { name: 'Pair round 6' })).toBeVisible();
  await page.getByRole('button', { name: 'End event' }).click();
  await expect(page.getByText('End the event?')).toBeVisible();
});

test('every Swiss round ends with another round, the top cut and ending the event, in that order', async ({ page }) => {
  // Sixteen players plan five rounds, so after round 2 another round is the step.
  await mockConsole(page, event(16, 2, false), settingsOf({}));
  const acts = page.locator('.tm-next-acts');
  await expect(acts.getByRole('button')).toHaveText(['Pair round 3', 'Start top cut', 'End event']);
  await expect(acts.getByRole('button', { name: 'Pair round 3' })).toHaveClass(/btn-primary/);
  await expect(acts.getByRole('button', { name: 'Start top cut' })).toHaveClass(/btn-secondary/);
  await expect(acts.getByRole('button', { name: 'End event' })).toHaveClass(/btn-secondary/);
});

test("an open table shows its players' reports in its one row, and a lone report can be accepted", async ({ page }) => {
  const t = event(8, 0, true);
  const [lone, disputed] = t.pods[0]?.rounds[0]?.matches ?? [];
  if (!lone?.p2 || !disputed?.p2) {
    throw new Error('the event has no first two tables');
  }
  const report = (m: Match, by: string, outcome: PlayerReport['outcome']): PlayerReport => ({
    pod: 'masters',
    round: 1,
    table: m.table,
    p1: m.p1,
    p2: m.p2 ?? '',
    by,
    outcome,
    at: 0
  });
  await mockConsole(page, t, settingsOf({ playerReporting: true }), [
    report(lone, lone.p2, 'p2'),
    report(disputed, disputed.p1, 'p1'),
    report(disputed, disputed.p2, 'p2')
  ]);
  const rows = page.locator('.tm-matches tbody tr');
  const first = rows.filter({ has: page.locator('.tm-result-label.is-reported:not(.is-problem)') });
  await expect(first.locator('.tm-result-label')).toHaveText(/^Reported\. Reported: .+ wins$/);
  await expect(first.locator('.tm-tag')).toHaveAttribute('title', 'Reported: won');
  const second = rows.filter({ has: page.locator('.tm-result-label.is-problem') });
  await expect(second.locator('.tm-result-label')).toHaveText(/^Disputed\. Reports differ\./);
  await expect(second.locator('.tm-tag.is-problem')).toHaveCount(2);
  await expect(second.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await first.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
  await expect(page.locator('.tm-result.is-asking .tm-result-label')).toHaveText(/ wins\?$/);
});

test('a capped league ends after its rounds instead of pairing on', async ({ page }) => {
  const sent = await mockConsole(page, event(6, 3, false), settingsOf({ roundCap: 3 }));
  await expect(page.getByText('Round 3 of 3 complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'End event' })).toHaveClass(/btn-primary/);
  await page.getByRole('button', { name: 'Pair round 4' }).click();
  await expect.poll(() => sent.map(c => c.type)).toEqual(['pairRound']);
});

test('the last planned round waits on its open tables before the decision', async ({ page }) => {
  await mockConsole(page, event(6, 2, true), settingsOf({ roundCap: 3 }));
  await expect(page.getByRole('button', { name: 'End event' })).toBeDisabled();
  await expect(page.getByText('3 tables open')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair round 4' })).toHaveCount(0);
});

test('with decklists off the console has no Decklists tab', async ({ page }) => {
  await mockConsole(page, event(4, 0, false), settingsOf({}));
  await expect(page.getByRole('tab', { name: 'Pairings' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Decklists' })).toHaveCount(0);
});

test('decks are named from the pairings, and a name the list lacks is taken as typed', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({ deckVisibility: 'always' }));
  await page.getByRole('button', { name: 'Enter decks' }).click();
  const picker = page.getByRole('combobox', { name: 'Deck' }).first();
  await picker.fill('Homebrew Box');
  await expect(page.getByRole('option', { name: /Homebrew Box/ })).toBeVisible();
  await picker.press('Enter');
  await expect
    .poll(() => sent.decks)
    .toEqual([{ playerId: t.pods[0]?.rounds[0]?.matches[0]?.p1, archetype: 'Homebrew Box' }]);
});

test('a deck list opened in the last row is drawn whole, not cut off at the table', async ({ page }) => {
  // The tables clip their overflow, and the list used to hang inside them: in
  // the bottom row it showed as a sliver under the field.
  await mockConsole(page, event(8, 0, true), settingsOf({ deckVisibility: 'always' }));
  await page.getByRole('button', { name: 'Enter decks' }).click();
  await page.getByRole('combobox', { name: 'Deck' }).last().focus();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const drawn = await list.evaluate(el => {
    const r = el.getBoundingClientRect();
    const corners: [number, number][] = [
      [r.left + 4, r.top + 4],
      [r.right - 4, r.bottom - 4]
    ];
    return {
      tall: r.height > 100,
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
      uncovered: corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
    };
  });
  expect(drawn).toEqual({ tall: true, onScreen: true, uncovered: true });
});

test('a Pokémon no archetype list names is offered with its sprite', async ({ page }) => {
  const t = event(8, 0, true);
  const sent = await mockConsole(page, t, settingsOf({ deckVisibility: 'always' }));
  await page.getByRole('button', { name: 'Enter decks' }).click();
  const picker = page.getByRole('combobox', { name: 'Deck' }).first();
  await picker.fill('Tyrantrum');
  const option = page.getByRole('option', { name: /Tyrantrum/ });
  await expect(option).toHaveCount(1);
  await expect(option).not.toContainText('Custom');
  await expect(option.locator('img[src$="/tyrantrum.png"]')).toHaveCount(1);
  await picker.press('Enter');
  await expect
    .poll(() => sent.decks)
    .toEqual([{ playerId: t.pods[0]?.rounds[0]?.matches[0]?.p1, archetype: 'Tyrantrum' }]);
});

test('the big screen marks who won each finished table', async ({ page }) => {
  let t = event(8, 0, true);
  const first = t.pods[0]?.rounds[0]?.matches[0];
  if (!first) {
    throw new Error('no table');
  }
  t = run(t, { type: 'reportResult', pod: 'masters', round: 1, ...first, outcome: 'p2' });
  const keys = assignKeys(t, {});
  const view: TournamentView = {
    code: CODE,
    mode: 'swiss',
    version: 2,
    updatedAt: 0,
    tournament: publicTournament(t, keys, true),
    pending: [],
    reports: [],
    divisions: publicDivisions(t, keys, 0),
    decks: {},
    settings: settingsOf({}),
    viewer: { role: null, me: null, via: null, signedIn: false }
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-status')).toContainText('Round 1 of 3');
  const done = page.locator('.tm-screen-tables li.is-done');
  await expect(done).toHaveCount(1);
  await expect(done.locator('.tm-screen-seat.is-win')).toHaveCount(1);
  await expect(done.locator('.tm-screen-seat.is-out')).toHaveCount(1);
  // The second seat won: its mark faces it, on the right.
  await expect(done.locator('.tm-screen-score .tm-screen-mark')).toHaveText(['L', 'W']);
  await expect(page.locator('.tm-screen-mark')).toHaveCount(2);
});

test('on a phone a roster question takes its own line instead of squeezing the name', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockConsole(page, event(4, 0, false), settingsOf({ playerReporting: true }));
  // A phone's tabs sit in the bar along the bottom.
  await page.getByRole('navigation', { name: 'Event sections' }).getByRole('button', { name: 'Players' }).click();
  await page.getByRole('button', { name: 'Reset reporting' }).first().click();
  const question = page.getByRole('group', { name: /Let another device report for/ });
  await expect(question).toBeVisible();
  const row = page.locator('.tm-roster tbody tr').filter({ has: question });
  const asked = await question.boundingBox();
  expect((asked?.x ?? 0) + (asked?.width ?? Infinity)).toBeLessThanOrEqual(360);
  const name = await row.locator('.tm-who').boundingBox();
  expect(name?.width ?? 0).toBeGreaterThan(120);
});

test('a division cut stays in the shared pod and pairs the next bracket round', async ({ page }) => {
  // TOM combines five Juniors and ten Seniors in category 10; Seniors then cut to their own top four.
  const adds: Command[] = [...Array(5).fill('2016'), ...Array(10).fill('2012')].map((year: string, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test', birthDate: `02/27/${year}` }
  }));
  let t = run(emptyTournament({ name: 'Friday League' }), ...adds, { type: 'pairRound', pod: 'mixed' });
  t = run(reportAll(t), { type: 'startTopCut', pod: 'mixed', size: 4, division: 'senior' });
  await mockConsole(page, t, settingsOf({}));
  await expect(page.getByRole('tablist', { name: 'Division' })).toHaveCount(0);
  await expect(page.locator('.tm-hero')).toContainText('Semifinals');
  await expect(page.getByRole('button', { name: 'Pair the final' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Pair round/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Division to cut' })).toHaveCount(0);
  const finished = reportAll(t);
  const sent = await mockConsole(page, finished, settingsOf({}));
  await page.getByRole('button', { name: 'Pair the final' }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: 'pairRound', pod: 'mixed' });
});

test('at an unsanctioned event where players do not report, staff can unlink a player from an account', async ({
  page
}) => {
  const released: string[] = [];
  page.on('request', request => {
    if (request.method() === 'DELETE') {
      released.push(new URL(request.url()).search);
    }
  });
  const t = event(4, 0, false);
  await mockConsole(page, t, settingsOf({ playerReporting: false }));
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByRole('button', { name: 'Reset reporting' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlink account' }).first().click();
  await page
    .getByRole('group', { name: /from their account\?$/ })
    .getByRole('button', { name: 'Unlink' })
    .click();
  await expect.poll(() => released).toEqual([`?player=${t.players[0]?.id ?? ''}`]);
});

/** An event's latest round with its first `done` tables won by their first seat. */
function partlyPlayed(players: number, rounds: number, done: number): Tournament {
  const t = event(players, rounds, true);
  const round = t.pods[0]?.rounds.at(-1);
  if (round) {
    round.matches = round.matches.map((m, i) => (i < done ? { ...m, outcome: 'p1' } : m));
  }
  return t;
}

test('while a round plays, its tables in progress lead under their heading and the finished follow', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 1, 1), settingsOf({}));
  const box = page.locator('.tm-matches');
  await expect(box.locator('.tm-group-row')).toHaveText(['In progress · 3', 'Done · 1']);
  const rows = box.locator('tbody tr:not(.tm-group-row)');
  await expect(rows.first().locator('.tm-result-label')).toHaveText('In progress');
  await expect(rows.last().locator('.tm-result-label')).toHaveText('1–0');
  const show = page.getByRole('tablist', { name: 'Show' });
  await expect(show.getByRole('tab', { name: /In progress/ })).toHaveText('In progress3');
  await show.getByRole('tab', { name: /In progress/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(box.locator('.tm-group-row')).toHaveCount(0);
});

test('the round stepper walks the rounds either side of the picker, and the clock runs from the head', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 2, 0), settingsOf({}));
  const round = page.getByRole('combobox', { name: 'Round' });
  await expect(round).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Next round' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(round).toHaveValue('2');
  await page.getByRole('button', { name: 'Previous round' }).click();
  await expect(round).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Previous round' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(round).toHaveValue('2');
  await expect(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' })).toBeVisible();
  await expect(page.locator('.tm-box').getByRole('group', { name: 'Round clock' })).toHaveCount(0);
  await expect(page.locator('.tm-meta-lead')).toContainText('Round 3 of 3 in progress');
});

test('900px and under a table opens a sheet of its results, and a press there records at once', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  const t = partlyPlayed(8, 0, 0);
  const sent = await mockConsole(page, t, settingsOf({}));
  const table = t.pods[0]?.rounds[0]?.matches[0];
  const rows = page.locator('.tm-matches tbody tr:not(.tm-group-row)');
  await expect(rows.first().getByRole('button', { name: 'Tie' })).toBeHidden();
  await expect(page.getByText('Press a player to report their win')).toHaveCount(0);
  await rows.first().click();
  const sheet = page.getByRole('dialog', { name: `Result, table ${table?.table}` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button')).toHaveText([/ wins$/, / wins$/, 'Tie', 'Double loss', 'Cancel']);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  const chevron = rows.first().getByRole('button', { name: `Enter the result of table ${table?.table}` });
  await chevron.click();
  await expect(sheet).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chevron).toBeFocused();
  await chevron.click();
  await sheet.getByRole('button', { name: 'Tie' }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ type: 'reportResult', table: table?.table, outcome: 'tie' });
});

test('on a phone the tabs sit along the bottom, and the round and its clock stay pinned @mobileOnly', async ({
  page
}) => {
  await mockConsole(page, partlyPlayed(8, 0, 2), settingsOf({}));
  await expect(page.locator('.tm-console > .tabs')).toBeHidden();
  const bar = page.getByRole('navigation', { name: 'Event sections' });
  await expect(bar.getByRole('button', { name: 'Pairings' })).toHaveAttribute('aria-current', 'page');
  const pin = page.locator('.tm-round-pin');
  await expect(pin.getByRole('combobox', { name: 'Round' })).toBeVisible();
  await expect(pin.getByRole('group', { name: 'Round clock' })).toBeVisible();
  await expect(page.locator('.tm-console-hero').getByRole('group', { name: 'Round clock' })).toBeHidden();
  await expect(page.locator('.tm-matches td.tm-table-col').first()).toHaveText(/\d/);
  await bar.getByRole('button', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/tab=standings/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the console leads back to the dashboard’s Organizing tab, above the event’s name @mobile', async ({ page }) => {
  await mockConsole(page, event(8, 0, true), settingsOf({}));
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link', { name: 'Your events' })).toHaveAttribute('href', '/host?tab=organizing');
  await expect(trail.locator('[aria-current="page"]')).toHaveText(
    await page.locator('.tm-console-hero h1').innerText()
  );
});
