import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
  '/cards',
  '/archetypes',
  '/archetypes/Dragapult',
  '/trends',
  '/players',
  '/events/majors',
  '/tools',
  '/tools/tier-list',
  '/about'
];

test.describe('narrow mobile viewport @mobileOnly', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ viewport: { width: 384, height: 832 }, hasTouch: true });

  for (const route of ROUTES) {
    test(`${route} stays inside the viewport`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('main').first()).toBeVisible();
      await page.waitForTimeout(800);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      }));
      expect(scrollWidth, `${route} scrolls past ${innerWidth}px`).toBeLessThanOrEqual(innerWidth);
      expect(errors).toEqual([]);
    });
  }

  test('archetype tabs signal hidden content', async ({ page }) => {
    await page.goto('/archetypes/Dragapult', { waitUntil: 'load' });
    const tabs = page.locator('.tabs');
    await expect(tabs.locator('button').first()).toBeVisible();
    await tabs.evaluate(element => element.setAttribute('style', 'max-width: 180px'));
    await expect
      .poll(() =>
        tabs.evaluate(element => ({
          overflows: element.scrollWidth > element.clientWidth + 1,
          hasFade: element.classList.contains('fade-r') || element.classList.contains('fade-l')
        }))
      )
      .toEqual({ overflows: true, hasFade: true });
  });

  test('visible controls clear the 44px touch target minimum', async ({ page }) => {
    for (const [route, selectors] of [
      ['/cards', ['.gsearch-trigger', '.t-selector-trigger', '.chip']],
      ['/style', ['.pagination button']]
    ] as const) {
      await page.goto(route, { waitUntil: 'load' });
      for (const selector of selectors) {
        const controls = page.locator(selector);
        await expect(controls.first()).toBeVisible();
        const heights = await controls.evaluateAll(elements =>
          elements
            .filter(element => element.getBoundingClientRect().width > 0)
            .slice(0, 5)
            .map(element => Math.round(element.getBoundingClientRect().height))
        );
        expect(heights.length, `${selector} has no visible controls on ${route}`).toBeGreaterThan(0);
        for (const height of heights) {
          expect(height, `${selector} is ${height}px tall on ${route}`).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
});
