import { expect, test } from '@playwright/test';
import { encodeSlimIndex, type PlayerIndexSlimEntry } from '../../shared/playerTypes';

test('player searches prioritize prefixes and preserve the selected ranking @mobile', async ({ page }) => {
  const players: PlayerIndexSlimEntry[] = ['Joanna', 'Ánna Zed', 'Anna Abe', 'Hannah', 'Annabelle'].map((name, i) => ({
    playerId: String(i),
    name,
    eventCount: [40, 10, 10, 20, 30][i],
    day2s: [1, 9, 9, 2, 4][i],
    wins: 0,
    losses: 0,
    topCuts: 0,
    tournamentWins: 0
  }));
  await page.route('**/index-slim.json', route => route.fulfill({ json: encodeSlimIndex(players) }));
  await page.goto('/players');
  const names = page.locator('.players-name .cardname');
  await expect(names).toHaveText(['Anna Abe', 'Ánna Zed', 'Annabelle', 'Hannah', 'Joanna']);
  const search = page.getByPlaceholder('Search by player name...');
  await search.fill(' ANN ');
  await expect(names).toHaveText(['Anna Abe', 'Ánna Zed', 'Annabelle', 'Hannah', 'Joanna']);
  await expect(page).toHaveURL(/q=/);
  await search.fill('annab');
  await expect(names).toHaveText(['Annabelle']);
  await search.fill('ann');
  await expect(names).toHaveCount(5);

  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(names).toHaveText(['Annabelle', 'Anna Abe', 'Ánna Zed', 'Joanna', 'Hannah']);
  await search.fill('missing');
  await expect(page.getByText('No players match.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(names).toHaveText(['Joanna', 'Annabelle', 'Hannah', 'Anna Abe', 'Ánna Zed']);
});

test('the players table paints its first page before the full index arrives', async ({ page }) => {
  const player = (name: string, day2s: number): PlayerIndexSlimEntry => ({
    playerId: name,
    name,
    eventCount: 10,
    day2s,
    wins: 0,
    losses: 0,
    topCuts: 0,
    tournamentWins: 0
  });
  const first = [player('Ash', 9), player('Misty', 8)];
  let releaseIndex: () => void = () => {};
  const indexHeld = new Promise<void>(resolve => {
    releaseIndex = resolve;
  });
  await page.route('**/top.json', route => route.fulfill({ json: encodeSlimIndex(first) }));
  await page.route('**/index-slim.json', async route => {
    await indexHeld;
    await route.fulfill({ json: encodeSlimIndex([...first, player('Brock', 1)]) });
  });
  await page.goto('/players');
  const names = page.locator('.players-name .cardname');
  await expect(names).toHaveText(['Ash', 'Misty']);
  releaseIndex();
  await expect(names).toHaveText(['Ash', 'Misty', 'Brock']);
});

test('a players index that fails shows its error, not the first page as the whole list', async ({ page }) => {
  const one: PlayerIndexSlimEntry = {
    playerId: 'Ash',
    name: 'Ash',
    eventCount: 10,
    day2s: 9,
    wins: 0,
    losses: 0,
    topCuts: 0,
    tournamentWins: 0
  };
  await page.route('**/top.json', route => route.fulfill({ json: encodeSlimIndex([one]) }));
  await page.route('**/index-slim.json', route => route.fulfill({ status: 500, body: '' }));
  await page.route('**/players/index.json', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/players');
  await expect(page.getByText('Player data unavailable')).toBeVisible();
  await expect(page.locator('.players-name .cardname')).toHaveCount(0);
});

const lone = {
  playerId: '\ud800',
  name: 'Lone',
  eventCount: 1,
  day2s: 1,
  wins: 0,
  losses: 0,
  topCuts: 0,
  tournamentWins: 0
};

for (const [label, top] of [
  ['an empty row', [{}]],
  ['an ID no link can encode', [lone]]
] as const) {
  test(`a first page with ${label} is ignored and the players table paints from the full index`, async ({ page }) => {
    await page.route('**/top.json', route => route.fulfill({ json: top }));
    await page.route('**/index-slim.json', async route => {
      await new Promise(resolve => {
        setTimeout(resolve, 300);
      });
      await route.fulfill({
        json: encodeSlimIndex([
          { playerId: 'Ash', name: 'Ash', eventCount: 10, day2s: 9, wins: 0, losses: 0, topCuts: 0, tournamentWins: 0 }
        ])
      });
    });
    await page.goto('/players');
    await expect(page.locator('.players-name .cardname')).toHaveText(['Ash']);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}

test('a first page longer than a page, from a tie at the cutoff, offers no pages until the index arrives', async ({
  page
}) => {
  const row = (i: number): PlayerIndexSlimEntry => ({
    playerId: `p${i}`,
    name: `Player ${i}`,
    eventCount: 10,
    day2s: i < 49 ? 100 - i : 1,
    wins: 0,
    losses: 0,
    topCuts: 0,
    tournamentWins: 0
  });
  const top = Array.from({ length: 51 }, (_, i) => row(i));
  let releaseIndex: () => void = () => {};
  const indexHeld = new Promise<void>(resolve => {
    releaseIndex = resolve;
  });
  await page.route('**/top.json', route => route.fulfill({ json: encodeSlimIndex(top) }));
  await page.route('**/index-slim.json', async route => {
    await indexHeld;
    await route.fulfill({ json: encodeSlimIndex([...top, ...Array.from({ length: 100 }, (_, i) => row(51 + i))]) });
  });
  await page.goto('/players');
  await expect(page.locator('.players-name .cardname')).toHaveCount(50);
  await expect(page.locator('.pagination')).toHaveCount(0);
  releaseIndex();
  await expect(page.locator('.pagination')).toBeVisible();
});
