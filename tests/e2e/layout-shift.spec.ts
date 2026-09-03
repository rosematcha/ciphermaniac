/**
 * Layout-shift budget.
 *
 * Every route is loaded cold against the fixture dataset and its Cumulative
 * Layout Shift is measured. The budget is deliberately far below Google's 0.1
 * "good" threshold: fixture JSON is served from localhost and lands in a
 * couple of milliseconds, so a shift that reads as 0.02 here is a much bigger
 * one for somebody on a phone waiting on R2. Treat the number as a shape
 * detector, not a field measurement.
 *
 * What this catches is a regression in the reservations the layout depends on:
 * a skeleton that stops matching the content it stands in for, a stat that
 * starts appearing from nothing, a chart that renders before it knows how wide
 * it is. Each of those showed up here as a step change well clear of the noise.
 *
 * Network and CPU are throttled so the async arrival order is the same run to
 * run — unthrottled, fixture data sometimes beats first paint and the shift it
 * causes disappears rather than being fixed.
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * Well under the 0.1 "good" CLS threshold — see the note above on why.
 *
 * The worst route currently measures 0.0069 (trends, mobile), so this leaves
 * about 2x headroom for machine-to-machine variance. Raising it because a
 * route started failing is the wrong move: at this scale a failure is a real
 * reservation that stopped matching its content, not noise.
 */
const BUDGET = 0.015;

const ROUTES = [
  '/',
  '/cards',
  '/cards/MEG/114',
  '/archetypes',
  '/archetypes/Dragapult',
  '/tournaments',
  '/trends',
  '/players',
  '/tools/tier-list',
  '/tools/earnings',
  '/tools/meta-binder'
];

/**
 * Installed before any app code runs, so `buffered: true` picks up shifts from
 * the very first frame — the ones a post-load observer would miss entirely.
 */
const OBSERVER = `
window.__cls = 0;
window.__shifts = [];
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.hadRecentInput) { continue; }
    window.__cls += entry.value;
    window.__shifts.push({
      at: Math.round(entry.startTime),
      value: entry.value,
      moved: (entry.sources || []).map(source => {
        const node = source.node;
        const name = node ? node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).trim().split(/\\s+/).join('.') : '') : '?';
        const rect = r => Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
        return name + ' ' + rect(source.previousRect) + ' -> ' + rect(source.currentRect);
      })
    });
  }
}).observe({ type: 'layout-shift', buffered: true });
`;

interface Shift {
  at: number;
  value: number;
  moved: string[];
}

/**
 * The largest shifts, each with what moved and from where to where. A budget
 * failure that only says "0.27" leaves the cause to be guessed at from a
 * machine that may not reproduce it.
 */
function describe(shifts: Shift[]): string {
  return [...shifts]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(shift => `  ${shift.value.toFixed(4)} at ${shift.at}ms: ${shift.moved.join('; ') || '(no sources)'}`)
    .join('\n');
}

async function throttle(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

test.describe('layout shift', () => {
  test.describe.configure({ timeout: 90_000 });

  for (const route of ROUTES) {
    test(`${route} settles without shifting`, async ({ page }) => {
      await page.addInitScript(OBSERVER);
      await throttle(page);
      await page.goto(route, { waitUntil: 'load' });
      // Long enough for the second-tier resources (prices, win rates, trend
      // files) to land — several of the shifts this guards against only
      // happened when one of those resolved after first paint.
      await page.waitForTimeout(8000);
      const { cls, shifts } = await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __shifts: Shift[] };
        return { cls: w.__cls, shifts: w.__shifts };
      });
      expect(cls, `CLS on ${route}\n${describe(shifts)}`).toBeLessThan(BUDGET);
    });
  }
});
