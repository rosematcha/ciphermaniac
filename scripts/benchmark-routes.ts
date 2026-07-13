/**
 * Reproducible route-data browser benchmark (DB-MASTER-PLAN Phase 0).
 *
 * Serves the production build with `vite preview` and drives Playwright's
 * bundled Chromium over a fixed set of deep links on a throttled mobile
 * profile matching the site's Lighthouse config (390x844, mobile UA, 4x CPU
 * throttling, "Slow 4G": 1.6 Mbps down / 750 Kbps up / 150 ms RTT).
 *
 * For every route it records, per run mode (cold context vs. in-context
 * repeat load), the request fan-out to r2.ciphermaniac.com (and any other
 * data host) with transferred/decoded bytes and edge cache status, network
 * time to idle, time to first data response, navigation timing + LCP,
 * JSON parse self-time/bytes, main-thread long tasks, and JS heap used.
 *
 * The parameterized routes (card / archetype / player) discover real params
 * at runtime from the live R2 indexes and freeze them into the results file
 * so a rerun benchmarks the exact same objects.
 *
 * Usage:
 *   npm run build                      # produce dist/ first
 *   npx playwright install chromium    # once, if Chromium isn't installed
 *   npm run bench:routes               # writes .github/baselines/route-benchmark-<date>.json
 *
 * Env:
 *   BENCH_DATE   override the yyyy-mm-dd stamp used for the output filename
 *   BENCH_PORT   override the vite preview port (default 4319)
 *   BENCH_ITERS  iterations per mode (default 2; median reported)
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type CDPSession, chromium, type Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R2_BASE = 'https://r2.ciphermaniac.com';
const ONLINE_REPORT = 'Online - Last 14 Days';

const PORT = Number(process.env.BENCH_PORT ?? 4319);
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const ITERATIONS = Math.max(1, Number(process.env.BENCH_ITERS ?? 2));

// Matches the existing mobile Lighthouse throttling profile.
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const VIEWPORT = { width: 390, height: 844 };
const NETWORK = {
  offline: false,
  latency: 150, // ms RTT
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8), // 1.6 Mbps -> bytes/s
  uploadThroughput: Math.floor((750 * 1024) / 8), // 750 Kbps -> bytes/s
  connectionType: 'cellular4g' as const
};
const CPU_THROTTLE_RATE = 4;

const NETWORK_IDLE_TIMEOUT = 45_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataRequest {
  url: string;
  status: number;
  mimeType: string;
  transferredBytes: number; // encoded, over the wire (headers + body)
  encodedBodyBytes: number; // content-length if reported
  decodedBytes: number | null; // uncompressed body length (data hosts only)
  cfCacheStatus: string | null;
  age: string | null;
  firstByteMs: number | null; // from navigation start
}

interface NavMetrics {
  networkTimeMs: number; // navigation start -> network idle (capped at NETWORK_IDLE_TIMEOUT)
  reachedNetworkIdle: boolean; // false if the cap fired before Playwright reported idle
  firstDataMs: number | null; // navigation start -> first data-host response
  requestCount: number;
  requests: DataRequest[];
  transferredBytesTotal: number;
  decodedBytesTotal: number;
  lcpMs: number | null;
  navTiming: {
    domContentLoadedMs: number | null;
    loadEventMs: number | null;
    responseEndMs: number | null;
  };
  parse: { count: number; totalMs: number; totalBytes: number };
  longTasks: { count: number; totalMs: number };
  jsHeapUsedBytes: number | null;
  nonOkResponses: number;
}

interface RouteResult {
  route: string;
  url: string;
  cold: NavMetrics | { error: string };
  repeat: NavMetrics | { error: string };
}

// ---------------------------------------------------------------------------
// Param discovery
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(
      `Data fetch failed: ${res.status} ${res.statusText} for ${url}. ` +
        `r2.ciphermaniac.com may WAF-403 datacenter clients — run this from a residential connection.`
    );
  }
  return (await res.json()) as T;
}

interface DiscoveredParams {
  card: { set: string; number: string; name: string };
  archetype: { slug: string; label: string };
  player: { id: string; name: string };
}

async function discoverParams(): Promise<DiscoveredParams> {
  const [master, archetypes, players] = await Promise.all([
    fetchJson<{ items: { set: string; number: string; name: string; rank: number }[] }>(
      `${R2_BASE}/reports/${encodeURIComponent(ONLINE_REPORT)}/master.json`
    ),
    fetchJson<{ name: string; label: string }[]>(
      `${R2_BASE}/reports/${encodeURIComponent(ONLINE_REPORT)}/archetypes/index.json`
    ),
    fetchJson<{ playerId: string; name: string; eventCount: number }[]>(`${R2_BASE}/players/index-slim.json`)
  ]);

  const topCard = [...master.items].sort((a, b) => a.rank - b.rank)[0];
  if (!topCard?.set || !topCard?.number) {
    throw new Error('Could not resolve a top card (set/number) from master.json');
  }
  const topArch = archetypes[0];
  if (!topArch?.name) {
    throw new Error('Could not resolve a top archetype slug from archetypes/index.json');
  }
  // Pick the most-active player so the profile is a heavy (representative) fetch.
  const topPlayer = [...players].sort((a, b) => (b.eventCount ?? 0) - (a.eventCount ?? 0))[0];
  if (!topPlayer?.playerId) {
    throw new Error('Could not resolve a player id from players/index-slim.json');
  }

  return {
    card: { set: topCard.set, number: topCard.number, name: topCard.name },
    archetype: { slug: topArch.name, label: topArch.label ?? topArch.name },
    player: { id: topPlayer.playerId, name: topPlayer.name }
  };
}

function buildRoutes(params: DiscoveredParams): { route: string; url: string }[] {
  const card = `/cards/${encodeURIComponent(params.card.set)}/${encodeURIComponent(params.card.number)}`;
  const arch = `/archetypes/${encodeURIComponent(params.archetype.slug)}`;
  const player = `/players/${encodeURIComponent(params.player.id)}`;
  const routes = ['/', '/cards', card, '/archetypes', arch, '/trends', '/tournaments', '/players', player];
  return routes.map(route => ({ route, url: `${PREVIEW_ORIGIN}${route}` }));
}

// ---------------------------------------------------------------------------
// vite preview lifecycle
// ---------------------------------------------------------------------------

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise(resolve => {
      setTimeout(resolve, 250);
    });
  }
  throw new Error(`vite preview did not become ready at ${url} within ${timeoutMs}ms`);
}

function startPreview(): ChildProcess {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout?.on('data', () => {});
  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (s.includes('error') || s.includes('EADDRINUSE')) {
      process.stderr.write(`[bench][preview] ${s}`);
    }
  });
  return proc;
}

// ---------------------------------------------------------------------------
// In-page instrumentation (injected before every navigation)
// ---------------------------------------------------------------------------

const INIT_SCRIPT = `(() => {
  if (window.__benchInstalled) return;
  window.__benchInstalled = true;

  // LCP via buffered observer.
  window.__lcp = null;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__lcp = last.renderTime || last.loadTime || last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}

  // Long tasks.
  window.__longTasks = { count: 0, totalMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longTasks.count += 1;
        window.__longTasks.totalMs += e.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) {}

  // JSON parse accounting. rawParse avoids double-counting from the Response.json wrapper.
  const rawParse = JSON.parse.bind(JSON);
  window.__jsonParseStats = { count: 0, totalMs: 0, totalBytes: 0 };
  JSON.parse = function (text, reviver) {
    const start = performance.now();
    const out = rawParse(text, reviver);
    window.__jsonParseStats.totalMs += performance.now() - start;
    window.__jsonParseStats.count += 1;
    window.__jsonParseStats.totalBytes += typeof text === 'string' ? text.length : 0;
    return out;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = async function () {
    const text = await this.clone().text();
    const start = performance.now();
    const out = rawParse(text);
    window.__jsonParseStats.totalMs += performance.now() - start;
    window.__jsonParseStats.count += 1;
    window.__jsonParseStats.totalBytes += text.length;
    // Fall through to the native implementation for correctness/streaming semantics.
    return origJson.call(this).catch(() => out);
  };
})();`;

const COLLECT_SCRIPT = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const mem = performance.memory;
  return {
    lcp: window.__lcp,
    longTasks: window.__longTasks || { count: 0, totalMs: 0 },
    parse: window.__jsonParseStats || { count: 0, totalMs: 0, totalBytes: 0 },
    navTiming: nav
      ? {
          domContentLoadedMs: nav.domContentLoadedEventEnd || null,
          loadEventMs: nav.loadEventEnd || null,
          responseEndMs: nav.responseEnd || null
        }
      : { domContentLoadedMs: null, loadEventMs: null, responseEndMs: null },
    jsHeapUsedBytes: mem ? mem.usedJSHeapSize : null
  };
})();`;

// ---------------------------------------------------------------------------
// Per-navigation network collector (CDP)
// ---------------------------------------------------------------------------

interface NetworkCollector {
  reset(startEpochMs: number): void;
  snapshot(): Promise<{ requests: DataRequest[]; firstDataMs: number | null }>;
}

function isDataHost(url: string): boolean {
  return url.startsWith('https://') && !url.startsWith(PREVIEW_ORIGIN);
}

async function attachNetworkCollector(session: CDPSession): Promise<NetworkCollector> {
  interface Pending {
    url: string;
    status: number;
    mimeType: string;
    cfCacheStatus: string | null;
    age: string | null;
    transferredBytes: number;
    encodedBodyBytes: number;
    decodedBytes: number | null;
    firstByteMs: number | null;
    wantsBody: boolean;
  }

  const byId = new Map<string, Pending>();
  const bodyPromises: Promise<void>[] = [];
  let startEpochMs = Date.now();
  let firstDataMs: number | null = null;

  await session.send('Network.enable');

  session.on('Network.responseReceived', (evt: any) => {
    const url: string = evt.response?.url ?? '';
    if (!isDataHost(url)) {
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(evt.response?.headers ?? {})) {
      headers[k.toLowerCase()] = String(v);
    }
    const now = Date.now() - startEpochMs;
    if (firstDataMs === null) {
      firstDataMs = now;
    }
    const encodedBody = Number(headers['content-length'] ?? 0) || 0;
    const mime = evt.response?.mimeType ?? '';
    byId.set(evt.requestId, {
      url,
      status: evt.response?.status ?? 0,
      mimeType: mime,
      cfCacheStatus: headers['cf-cache-status'] ?? null,
      age: headers.age ?? null,
      transferredBytes: 0,
      encodedBodyBytes: encodedBody,
      decodedBytes: null,
      firstByteMs: now,
      // Decoded body size only makes sense (and is worth the CDP round-trip) for JSON data.
      wantsBody: mime.includes('json') || url.endsWith('.json')
    });
  });

  session.on('Network.loadingFinished', (evt: any) => {
    const entry = byId.get(evt.requestId);
    if (!entry) {
      return;
    }
    entry.transferredBytes = Number(evt.encodedDataLength ?? 0) || 0;
    // Pull the decoded body only after the transfer completes — requesting it at
    // responseReceived time races the download and rejects for larger bodies.
    if (entry.wantsBody) {
      const id = evt.requestId;
      bodyPromises.push(
        session
          .send('Network.getResponseBody', { requestId: id })
          .then((body: any) => {
            entry.decodedBytes = body?.base64Encoded
              ? Buffer.from(body.body ?? '', 'base64').length
              : Buffer.byteLength(body?.body ?? '', 'utf8');
          })
          .catch(() => {})
      );
    }
  });

  return {
    reset(epoch: number) {
      byId.clear();
      bodyPromises.length = 0;
      firstDataMs = null;
      startEpochMs = epoch;
    },
    async snapshot() {
      await Promise.allSettled(bodyPromises);
      const requests: DataRequest[] = [...byId.values()].map(p => ({
        url: p.url,
        status: p.status,
        mimeType: p.mimeType,
        transferredBytes: p.transferredBytes,
        encodedBodyBytes: p.encodedBodyBytes,
        decodedBytes: p.decodedBytes,
        cfCacheStatus: p.cfCacheStatus,
        age: p.age,
        firstByteMs: p.firstByteMs
      }));
      requests.sort((a, b) => (a.firstByteMs ?? 0) - (b.firstByteMs ?? 0));
      return { requests, firstDataMs };
    }
  };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

async function measureNavigation(
  page: Page,
  collector: NetworkCollector,
  action: () => Promise<void>
): Promise<NavMetrics> {
  const start = Date.now();
  collector.reset(start);
  await action();
  // Bounded wait for network idle. Playwright's own `timeout` has been observed
  // to overrun on data-heavy client routes, so guard it with a hard cap and
  // record whether idle was genuinely reached (a route that never settles is a
  // real data-serving signal, not a benchmark failure).
  const idlePromise = page
    .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  const capPromise = new Promise<boolean>(resolve => {
    setTimeout(() => resolve(false), NETWORK_IDLE_TIMEOUT + 1_000);
  });
  const reachedNetworkIdle = await Promise.race([idlePromise, capPromise]);
  const networkTimeMs = Date.now() - start;

  // Give LCP/longtask observers a moment to flush.
  await page.waitForTimeout(300);

  const [{ requests, firstDataMs }, pageMetrics] = await Promise.all([
    collector.snapshot(),
    page.evaluate(COLLECT_SCRIPT) as Promise<{
      lcp: number | null;
      longTasks: { count: number; totalMs: number };
      parse: { count: number; totalMs: number; totalBytes: number };
      navTiming: { domContentLoadedMs: number | null; loadEventMs: number | null; responseEndMs: number | null };
      jsHeapUsedBytes: number | null;
    }>
  ]);

  const transferredBytesTotal = requests.reduce((s, r) => s + r.transferredBytes, 0);
  const decodedBytesTotal = requests.reduce((s, r) => s + (r.decodedBytes ?? 0), 0);
  const nonOkResponses = requests.filter(r => r.status < 200 || r.status >= 300).length;

  return {
    networkTimeMs,
    reachedNetworkIdle,
    firstDataMs,
    requestCount: requests.length,
    requests,
    transferredBytesTotal,
    decodedBytesTotal,
    lcpMs: pageMetrics.lcp,
    navTiming: pageMetrics.navTiming,
    parse: pageMetrics.parse,
    longTasks: pageMetrics.longTasks,
    jsHeapUsedBytes: pageMetrics.jsHeapUsedBytes,
    nonOkResponses
  };
}

async function newThrottledContext(): Promise<{ context: BrowserContext; page: Page; session: CDPSession }> {
  const browser = benchBrowser!;
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: MOBILE_UA,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
    bypassCSP: true
  });
  await context.addInitScript(INIT_SCRIPT);
  // The /api/* Pages Functions (e.g. upcoming-tournaments) aren't served by
  // `vite preview` — the dev proxy target is refused, leaving a request pending
  // that can starve network-idle. Stub them with an instant empty response;
  // callers already treat this as "no data" and it isn't a data-host request.
  await context.route('**/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  );
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', NETWORK);
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
  return { context, page, session };
}

let benchBrowser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function benchmarkRoute(route: { route: string; url: string }): Promise<RouteResult> {
  const coldRuns: NavMetrics[] = [];
  const repeatRuns: NavMetrics[] = [];
  let coldError: string | null = null;
  let repeatError: string | null = null;

  for (let i = 0; i < ITERATIONS; i++) {
    const { context, page, session } = await newThrottledContext();
    try {
      const collector = await attachNetworkCollector(session);
      // Cold: fresh context, no SW/cache priming.
      const cold = await measureNavigation(page, collector, async () => {
        await page.goto(route.url, { waitUntil: 'commit', timeout: NETWORK_IDLE_TIMEOUT });
      });
      coldRuns.push(cold);

      // Let the service worker install/activate before the repeat load.
      await page.waitForTimeout(500);

      // Repeat: reload the same page in the same context (HTTP cache + SW apply).
      const repeat = await measureNavigation(page, collector, async () => {
        await page.reload({ waitUntil: 'commit', timeout: NETWORK_IDLE_TIMEOUT });
      });
      repeatRuns.push(repeat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (coldRuns.length <= i) {
        coldError = msg;
      } else {
        repeatError = msg;
      }
    } finally {
      await context.close();
    }
  }

  return {
    route: route.route,
    url: route.url,
    cold: coldRuns.length ? medianMetrics(coldRuns) : { error: coldError ?? 'no cold runs completed' },
    repeat: repeatRuns.length ? medianMetrics(repeatRuns) : { error: repeatError ?? 'no repeat runs completed' }
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function medianNum(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return nums.length ? median(nums) : null;
}

/** Median across iterations of the same mode. Request fan-out is taken from the run with the median request count. */
function medianMetrics(runs: NavMetrics[]): NavMetrics {
  const representative = [...runs].sort((a, b) => a.requestCount - b.requestCount)[Math.floor(runs.length / 2)];
  return {
    networkTimeMs: median(runs.map(r => r.networkTimeMs)),
    reachedNetworkIdle: runs.every(r => r.reachedNetworkIdle),
    firstDataMs: medianNum(runs.map(r => r.firstDataMs)),
    requestCount: median(runs.map(r => r.requestCount)),
    requests: representative.requests,
    transferredBytesTotal: median(runs.map(r => r.transferredBytesTotal)),
    decodedBytesTotal: median(runs.map(r => r.decodedBytesTotal)),
    lcpMs: medianNum(runs.map(r => r.lcpMs)),
    navTiming: {
      domContentLoadedMs: medianNum(runs.map(r => r.navTiming.domContentLoadedMs)),
      loadEventMs: medianNum(runs.map(r => r.navTiming.loadEventMs)),
      responseEndMs: medianNum(runs.map(r => r.navTiming.responseEndMs))
    },
    parse: {
      count: median(runs.map(r => r.parse.count)),
      totalMs: median(runs.map(r => r.parse.totalMs)),
      totalBytes: median(runs.map(r => r.parse.totalBytes))
    },
    longTasks: {
      count: median(runs.map(r => r.longTasks.count)),
      totalMs: median(runs.map(r => r.longTasks.totalMs))
    },
    jsHeapUsedBytes: medianNum(runs.map(r => r.jsHeapUsedBytes)),
    nonOkResponses: median(runs.map(r => r.nonOkResponses))
  };
}

function isMetrics(m: NavMetrics | { error: string }): m is NavMetrics {
  return !('error' in m);
}

function summarize(results: RouteResult[], mode: 'cold' | 'repeat') {
  const ok = results.map(r => r[mode]).filter(isMetrics);
  const metric = (fn: (m: NavMetrics) => number | null) =>
    ok.map(fn).filter((v): v is number => v !== null && Number.isFinite(v));
  const block = (fn: (m: NavMetrics) => number | null) => {
    const vals = metric(fn);
    return { p50: Math.round(percentile(vals, 50)), p95: Math.round(percentile(vals, 95)) };
  };
  return {
    routes: ok.length,
    networkTimeMs: block(m => m.networkTimeMs),
    firstDataMs: block(m => m.firstDataMs),
    lcpMs: block(m => m.lcpMs),
    transferredBytes: block(m => m.transferredBytesTotal),
    parseMs: block(m => m.parse.totalMs)
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function stampDate(): string {
  if (process.env.BENCH_DATE) {
    return process.env.BENCH_DATE;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main(): Promise<void> {
  console.info('[bench] Discovering route params from live R2 indexes...');
  const params = await discoverParams();
  console.info(
    `[bench] card=${params.card.set}/${params.card.number} (${params.card.name}), ` +
      `archetype=${params.archetype.slug}, player=${params.player.id} (${params.player.name})`
  );
  const routes = buildRoutes(params);

  console.info(`[bench] Starting vite preview on ${PREVIEW_ORIGIN}...`);
  const preview = startPreview();
  const cleanup = () => {
    if (!preview.killed) {
      preview.kill('SIGTERM');
    }
  };
  process.on('exit', cleanup);

  try {
    await waitForServer(`${PREVIEW_ORIGIN}/`, 30_000);
    console.info('[bench] Preview ready. Launching Chromium...');
    // r2.ciphermaniac.com only sends Access-Control-Allow-Origin for the real
    // https://ciphermaniac.com origin, so from a localhost preview every data
    // fetch would CORS-fail (net::ERR_FAILED) and never reach the network. In
    // production those same requests succeed, so we disable the browser's CORS
    // enforcement to faithfully exercise (and measure) the real network path.
    // Bytes, cache status, and timing captured over CDP remain authentic.
    benchBrowser = await chromium.launch({
      args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
    });

    const results: RouteResult[] = [];
    for (const route of routes) {
      process.stdout.write(`[bench] ${route.route} ... `);
      const result = await benchmarkRoute(route);
      const c = result.cold;
      process.stdout.write(
        isMetrics(c)
          ? `cold LCP ${c.lcpMs ? Math.round(c.lcpMs) : '?'}ms, ${c.requestCount} req, ${Math.round(
              c.transferredBytesTotal / 1024
            )} KB\n`
          : `FAILED: ${c.error}\n`
      );
      results.push(result);
    }

    const output = {
      generatedAt: new Date().toISOString(),
      date: stampDate(),
      profile: {
        viewport: VIEWPORT,
        userAgent: MOBILE_UA,
        cpuThrottleRate: CPU_THROTTLE_RATE,
        network: { downMbps: 1.6, upKbps: 750, rttMs: NETWORK.latency },
        iterationsPerMode: ITERATIONS,
        previewOrigin: PREVIEW_ORIGIN
      },
      params,
      routes: results,
      summary: {
        cold: summarize(results, 'cold'),
        repeat: summarize(results, 'repeat')
      }
    };

    const outDir = join(ROOT, '.github', 'baselines');
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `route-benchmark-${stampDate()}.json`);
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    console.info(`\n[bench] Wrote ${outPath}`);
    console.info('[bench] Summary (cold):', JSON.stringify(output.summary.cold));
    console.info('[bench] Summary (repeat):', JSON.stringify(output.summary.repeat));
    const failed = results.filter(r => !isMetrics(r.cold) || !isMetrics(r.repeat));
    if (failed.length) {
      console.warn(`[bench] ${failed.length} route(s) had a failing mode:`, failed.map(f => f.route).join(', '));
    }
  } finally {
    if (benchBrowser) {
      await benchBrowser.close();
    }
    cleanup();
  }
}

main().catch(err => {
  console.error('[bench] Fatal:', err);
  process.exit(1);
});
