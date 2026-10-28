import { expect, test } from '@playwright/test';

const CREDIT =
  'Unreleased Japanese cards use fan translations and images from pokemonproxies.com, translated by Toine Lay and PokeBeach.';

const TALONFLAME = {
  rank: 99,
  name: 'Talonflame ex',
  found: 600,
  total: 1134,
  pct: 52.9,
  set: 'JP-M6',
  number: '62',
  uid: 'Talonflame ex::JP-M6::062',
  category: 'pokemon'
};

test('an archetype showing a Japanese-only card ends with the fan translation credit', async ({ page }) => {
  const images: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image' && request.url().includes('M6')) {
      images.push(new URL(request.url()).pathname);
    }
  });
  await page.route('**/archetypes/Dragapult/cards.json', async route => {
    const response = await route.fetch();
    const report = (await response.json()) as { items: unknown[] };
    report.items.push(TALONFLAME);
    await route.fulfill({ response, json: report });
  });
  await page.goto('/archetypes/Dragapult');

  const credit = page.locator('p.fan-credit');
  await expect(credit).toHaveText(CREDIT);
  await expect(credit.getByRole('link', { name: 'pokemonproxies.com' })).toHaveAttribute(
    'href',
    'https://www.pokemonproxies.com'
  );
  // Card art is lazy, so bring the card on screen before looking for its request.
  await page.getByText('Talonflame ex').first().scrollIntoViewIfNeeded();
  await expect.poll(() => images.some(path => path.startsWith('/jp-card-images/M6/M6_062_'))).toBe(true);
});

test('an archetype with no Japanese-only card carries no credit', async ({ page }) => {
  await page.goto('/archetypes/Dragapult');
  await expect(page.locator('.arche-title')).toBeVisible();
  await expect(page.locator('p.fan-credit')).toHaveCount(0);
});
