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
