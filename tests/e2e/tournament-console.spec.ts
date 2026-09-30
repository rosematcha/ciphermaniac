/**
 * A Swiss event's console and big screen against mocked functions: a double
 * click on a player records their win at once, the console's head offers the
 * top cut, another round and ending the event once the planned rounds are
 * played, decks are named from the pairings, and the big screen marks each
 * table's winner as results come in.
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
    .map(m => ({ type: 'reportResult', pod: 'mixed', round: round?.number ?? 0, ...m, outcome: 'p1' }));
  return run(t, ...reports);
}

/** An unsanctioned event of `players`, with `rounds` played and one more paired when `paired`. */
function event(players: number, rounds: number, paired: boolean): Tournament {
  const adds: Command[] = Array.from({ length: players }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  let t = run(emptyTournament({ name: 'Friday League' }, true), ...adds);
  for (let r = 0; r < rounds; r += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'mixed' }));
  }
  return paired ? run(t, { type: 'pairRound', pod: 'mixed' }) : t;
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
    staffToken: 'invite'
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      const user = { id: 'u1', name: 'Organizer', avatar: null, popId: null, firstName: null, lastName: null };
      return route.fulfill({ json: { user: { ...user, birthDate: null, providers: ['dev'] }, providers: ['dev'] } });
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

test('after the planned rounds the console offers the top cut, another round and ending the event', async ({
  page
}) => {
  // Sixteen players play five rounds and a top 4, as Play! Pokémon recommends.
  await mockConsole(page, event(16, 5, false), settingsOf({}));
  await expect(page.getByText('Round 5 of 5 · all 8 tables in')).toBeVisible();
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
    pod: 'mixed',
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
  await expect(page.getByText('Round 3 of 3 · all 3 tables in')).toBeVisible();
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

test('the big screen marks who won each finished table', async ({ page }) => {
  let t = event(8, 0, true);
  const first = t.pods[0]?.rounds[0]?.matches[0];
  if (!first) {
    throw new Error('no table');
  }
  t = run(t, { type: 'reportResult', pod: 'mixed', round: 1, ...first, outcome: 'p2' });
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
    viewer: { role: null, me: null, signedIn: false }
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
  await expect(done.locator('.tm-screen-seat.is-win .tm-screen-mark')).toHaveText('W');
  await expect(done.locator('.tm-screen-seat.is-out .tm-screen-mark')).toHaveText('L');
  await expect(page.locator('.tm-screen-mark')).toHaveCount(2);
});
