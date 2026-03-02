import { expect, type Page, test } from '@playwright/test';

const ENFORCE_PERF_BUDGETS = process.env.ENFORCE_PERF_BUDGETS === '1';

async function enableLowEndProfile(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 180,
    downloadThroughput: 1_000_000 / 8,
    uploadThroughput: 750_000 / 8
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function installVitalsObservers(page: Page) {
  await page.addInitScript(() => {
    (window as any).__cmPerf = { lcp: 0, cls: 0 };

    let cls = 0;
    const clsObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as any[]) {
        if (!entry.hadRecentInput) {
          cls += entry.value || 0;
          (window as any).__cmPerf.cls = cls;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);

    const lcpObserver = new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        (window as any).__cmPerf.lcp = last.startTime;
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit);
  });
}

test.describe('Low-end performance budgets', () => {
  test.skip(!ENFORCE_PERF_BUDGETS, 'Set ENFORCE_PERF_BUDGETS=1 to enforce low-end performance budgets.');

  test('cards page meets LCP/CLS budget and avoids SQL assets when manifest gate disables db', async ({
    page,
    browserName
  }) => {
    test.skip(browserName !== 'chromium', 'Low-end throttle profile is CDP-specific');

    await installVitalsObservers(page);
    await enableLowEndProfile(page);

    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    await page.goto('/cards?ff_useSqliteManifestGate=1&ff_usePageCssSplit=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#grid .card', { timeout: 30_000 });

    await page.fill('#search', 'buddy');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const select = document.getElementById('success-filter') as HTMLSelectElement | null;
      if (!select) {
        return;
      }
      select.value = 'top8';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(600);

    const vitals = await page.evaluate(() => (window as any).__cmPerf);
    expect(vitals.lcp).toBeLessThan(5_000);
    expect(vitals.cls).toBeLessThan(0.1);

    const sqlRequests = requests.filter(url => url.includes('sql-wasm.wasm') || url.includes('/tournament.db'));
    expect(sqlRequests).toEqual([]);
  });

  test('archetype analysis meets first-render and filter-update budgets on low-end profile', async ({
    page,
    browserName
  }) => {
    test.skip(browserName !== 'chromium', 'Low-end throttle profile is CDP-specific');

    await installVitalsObservers(page);
    await enableLowEndProfile(page);

    await page.goto('/Dragapult_Dusknoir/analysis?ff_useArchetypeFilterApi=1&ff_useSqliteManifestGate=1', {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForSelector('#grid .card', { timeout: 30_000 });

    const firstRenderMs = await page.evaluate(() => performance.now());
    expect(firstRenderMs).toBeLessThan(6_000);

    const interactionStart = Date.now();
    await page.selectOption('#archetype-success-filter', 'top8');
    await page.waitForSelector('#skeleton-warnings:not([hidden])', { timeout: 10_000 });
    const filterDuration = Date.now() - interactionStart;

    expect(filterDuration).toBeLessThan(1_500);
  });
});
