/**
 * Mobile viewport regression tests (mobile plan P4.1).
 *
 * Encodes the July 2026 mobile audit as a permanent gate:
 *  - no page may scroll horizontally at target phone widths
 *  - overflowing tab strips must expose their scroll-fade affordance
 *  - key interactive controls must meet the 44px touch-target minimum
 *
 * Target devices: iPhone 15 (393px), Galaxy S25+ (384px), Pixel 10 (412px).
 */
import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'galaxy-s25plus', width: 384, height: 832 },
  { name: 'iphone-15', width: 393, height: 852 },
  { name: 'pixel-10', width: 412, height: 915 }
];

const ROUTES = [
  '/',
  '/cards',
  '/archetypes',
  "/archetypes/N's_Zoroark",
  '/trends',
  '/players',
  '/tournaments',
  '/toys',
  '/toys/in-loving-memory',
  '/about'
];

// Interactive controls that must clear 44px when present (P2.2).
const TOUCH_TARGETS = ['.topnav-mode-toggle', '.t-selector-trigger', '.chip', '.pagination button'];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

    for (const route of ROUTES) {
      test(`${route} has no horizontal overflow`, async ({ page }) => {
        await page.goto(route);
        // Let data-driven layouts settle.
        await page.waitForLoadState('networkidle');
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        }));
        expect(scrollWidth, `scrollWidth ${scrollWidth} > viewport ${innerWidth} on ${route}`).toBeLessThanOrEqual(
          innerWidth
        );
      });
    }

    test('archetype tab strip signals hidden tabs', async ({ page }) => {
      await page.goto("/archetypes/N's_Zoroark");
      await page.waitForSelector('.tabs button');
      const tabState = await page.evaluate(() => {
        const tabs = document.querySelector('.tabs');
        if (!tabs) {
          return null;
        }
        return {
          overflows: tabs.scrollWidth > tabs.clientWidth + 1,
          hasFade: tabs.classList.contains('fade-r') || tabs.classList.contains('fade-l')
        };
      });
      expect(tabState).not.toBeNull();
      // If the strip overflows it must show a fade; if it fits, no fade needed.
      if (tabState!.overflows) {
        expect(tabState!.hasFade, 'overflowing tab strip must show a scroll fade').toBe(true);
      }
    });

    test('touch targets meet the 44px minimum', async ({ page }) => {
      await page.goto('/cards');
      await page.waitForSelector('.card-tile, .empty-state', { timeout: 20_000 });
      for (const selector of TOUCH_TARGETS) {
        const boxes = await page.evaluate(sel => {
          return [...document.querySelectorAll(sel)]
            .filter(el => el.getBoundingClientRect().width > 0)
            .slice(0, 5)
            .map(el => Math.round(el.getBoundingClientRect().height));
        }, selector);
        for (const height of boxes) {
          expect(height, `${selector} height ${height}px < 44px`).toBeGreaterThanOrEqual(44);
        }
      }
    });
  });
}
