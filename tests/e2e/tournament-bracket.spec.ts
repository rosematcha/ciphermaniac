/**
 * The top cut as a bracket, against mocked functions: the public page, the
 * console and the big screen keep the table by default and offer the bracket
 * once a cut has started; the public page keeps the choice in its address and
 * the big screen on the device. The event is built with the same shared
 * commands the functions apply.
 */

import { expect, type Page, test } from '@playwright/test';

import { applyCommand, type Command } from '../../shared/tournament/commands';
import { emptyTournament } from '../../shared/tournament/create';
import { seededRandom } from '../../shared/tournament/random';
import type { Tournament } from '../../shared/tournament/types';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDivisions,
  publicTournament,
  type TournamentView
} from '../../shared/tournament/view';

const CODE = 'BRACKT';

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
  const round = t.pods[0]?.rounds.at(-1);
  const reports: Command[] = (round?.matches ?? [])
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({ type: 'reportResult', pod: 'masters', round: round?.number ?? 0, ...m, outcome: 'p1' }));
  return run(t, ...reports);
}

/** Sixteen players through four Swiss rounds and the quarterfinals of a top 8, the semifinals not paired yet. */
function quarterfinalsPlayed(): Tournament {
  const adds: Command[] = Array.from({ length: 16 }, (_, i) => ({
    type: 'addPlayer',
    player: { firstName: `Player${i + 1}`, lastName: 'Test' }
  }));
  let t = run(emptyTournament({ name: 'Bracket Cup' }), ...adds);
  for (let r = 0; r < 4; r += 1) {
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  return reportAll(run(t, { type: 'startTopCut', pod: 'masters', size: 8 }));
}

const SETTINGS = { ...DEFAULT_SETTINGS, sanctioned: false };

async function mockPublic(page: Page, t: Tournament) {
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
    settings: SETTINGS,
    viewer: { role: null, me: null, via: null, signedIn: false }
  };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return route.fulfill({ json: { user: null, providers: [] } });
    }
    return url.searchParams.has('since') ? route.fulfill({ status: 204 }) : route.fulfill({ json: view });
  });
}

test('the public page shows the top cut as a table, or as a bracket kept in its address @mobile', async ({ page }) => {
  await mockPublic(page, quarterfinalsPlayed());
  await page.goto(`/t/${CODE}`);
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Bracket' }).click();
  await expect(page).toHaveURL(/view=bracket/);
  const bracket = page.getByRole('region', { name: 'Top cut bracket' });
  await expect(bracket.getByRole('heading')).toHaveText(['Quarterfinals', 'Semifinals', 'Final']);
  await expect(bracket.locator('.tm-bracket-col').first().locator('.tm-bracket-match')).toHaveCount(4);
  // The quarterfinal winners are through to semifinals not paired yet: seeds 1 and 4, 2 and 3.
  const semis = bracket.locator('.tm-bracket-col').nth(1);
  await expect(semis.locator('.tm-bracket-seed')).toHaveText(['1', '5', '3', '7']);
  await expect(semis.getByRole('group', { name: 'Not paired yet' })).toHaveCount(2);
  await expect(page.locator('.tm-matches')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'the bracket scrolls inside its box, not the page').toBeLessThanOrEqual(0);

  await page.reload();
  await expect(bracket).toBeVisible();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
});

test('a Swiss round offers no bracket', async ({ page }) => {
  let t = run(emptyTournament({ name: 'Swiss Only' }));
  t = run(
    t,
    ...Array.from({ length: 8 }, (_, i): Command => ({
      type: 'addPlayer',
      player: { firstName: `Player${i + 1}`, lastName: 'Test' }
    })),
    { type: 'pairRound', pod: 'masters' }
  );
  await mockPublic(page, t);
  await page.goto(`/t/${CODE}?view=bracket`);
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: 'Bracket' })).toHaveCount(0);
});

test('the big screen switches to the bracket with B, and remembers it', async ({ page }) => {
  await mockPublic(page, quarterfinalsPlayed());
  await page.goto(`/t/${CODE}?screen=1`);
  await expect(page.locator('.tm-screen-tables li')).toHaveCount(4);
  await page.keyboard.press('b');
  const bracket = page.locator('.tm-bracket.is-screen');
  await expect(bracket.locator('.tm-bracket-col')).toHaveCount(3);
  await expect(page.locator('.tm-screen-tables')).toHaveCount(0);
  await page.reload();
  await expect(bracket).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Bracket' })).toHaveAttribute('aria-selected', 'true');
});

test('the console looks at the top cut as a bracket, and enters results in the table', async ({ page }) => {
  const t = quarterfinalsPlayed();
  const manage = {
    code: CODE,
    mode: 'swiss',
    version: 3,
    updatedAt: 0,
    tournament: t,
    pending: [],
    reports: [],
    settings: SETTINGS,
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
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(`/host/${CODE}`);
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Bracket' }).click();
  await expect(page.getByRole('region', { name: 'Top cut bracket' }).locator('.tm-bracket-col')).toHaveCount(3);
  await expect(page.locator('.tm-matches')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.locator('.tm-matches tbody tr')).toHaveCount(4);
});
