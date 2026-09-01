/**
 * Crawl every Limitless player's Masters tournament results.
 *
 * The earnings leaderboard (scripts/scrape-player-earnings.ts) only publishes
 * aggregate cash, and its tail is not stable: ties are paginated in an
 * arbitrary order, so two runs minutes apart returned different players below
 * ~$1,000. This crawl reads each player's own results page instead, which is
 * exact, unpaginated, and — the reason it exists — carries the PLACEMENT and
 * tournament id behind every payout. That is what a "today's payouts" view
 * needs, including for players whose placements earned nothing at the time.
 *
 * Runs twice, because Limitless's results table never states which age
 * division a finish was in. `CRAWL_DIVISION=ma` fetches the Masters-filtered
 * page and `CRAWL_DIVISION=all` the unfiltered one; a row in the second but
 * not the first was a Junior or Senior finish, which pays from a different
 * column. Each pass has its own output file and its own resume state.
 *
 * Writes NDJSON to `.cache/limitless/player-results-{division}.ndjson`, one
 * record per player, appended as it goes. A full sweep takes about two hours, so it is
 * built to be killed and restarted: re-running skips every id already
 * accounted for — players in the results file, dead ids in `dead-ids.txt` —
 * and picks up where it stopped. Nothing is ever re-fetched.
 *
 * Usage:
 *   npx tsx scripts/crawl-player-results.ts                    # Masters pass
 *   CRAWL_DIVISION=all npx tsx scripts/crawl-player-results.ts  # every division
 *   MAX_PLAYER_ID=200 npx tsx scripts/crawl-player-results.ts
 *
 * Survives a dropped terminal:
 *   nohup npm run crawl:players > .cache/limitless/crawl.log 2>&1 &
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as cheerio from 'cheerio';
import type { CrawledPlayer, CrawledResult } from '../shared/earningsTypes';
import { parseCash, parseCrawledIds, parsePlace, parseSeasonKey } from '../shared/earningsParse';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'limitless');
/** `ma` for the Masters-filtered pass, `all` for every division. */
const DIVISION = process.env.CRAWL_DIVISION ?? 'ma';
if (DIVISION !== 'ma' && DIVISION !== 'all') {
  throw new Error(`CRAWL_DIVISION must be 'ma' or 'all', got ${JSON.stringify(DIVISION)}`);
}
const OUT_PATH = join(CACHE_DIR, `player-results-${DIVISION}.ndjson`);
/**
 * Ids with no player behind them. Recorded separately so a resume doesn't
 * re-fetch them — they leave no record in the results file, and there are
 * hundreds of them scattered through the range.
 */
const DEAD_PATH = join(CACHE_DIR, 'dead-ids.txt');
/** The results page, filtered to Masters or left across every division. */
const RESULTS_QUERY = DIVISION === 'ma' ? '?division=ma' : '';

const BASE_URL = 'https://limitlesstcg.com';
const USER_AGENT = 'ciphermaniac-earnings/1.0 (+https://ciphermaniac.com)';
const RATE_LIMIT_MS = 250;
/** Parallel workers; see the note in main() on the combined request rate. */
const CONCURRENCY = 2;
/**
 * Patient by design: a two-hour crawl on a flaky connection will hit outages
 * that outlast a couple of quick retries, and losing the run to one blip costs
 * far more than waiting. Backs off 2s, 4s, 8s, 16s, 32s.
 */
const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 6;

/** Highest player id to try. Limitless ids are dense from 1 upward. */
const MAX_PLAYER_ID = Number(process.env.MAX_PLAYER_ID ?? 15200);
if (!Number.isInteger(MAX_PLAYER_ID) || MAX_PLAYER_ID < 1) {
  throw new Error(`MAX_PLAYER_ID must be a positive integer, got ${JSON.stringify(process.env.MAX_PLAYER_ID)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/** Fetch HTML, retrying transient failures. Returns null on a 404 (dead id). */
async function fetchHtml(url: string): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

/* ---------------- player results ---------------- */

/**
 * Read the results table. Rows arrive under `Season NNNN-NNNN` sub-headings
 * and each season closes with a totals row (a `colspan` cell, no tournament
 * link) that must not be mistaken for a result.
 */
export function parseResults(html: string): Omit<CrawledPlayer, 'id'> {
  const $ = cheerio.load(html);
  const name = $('.infobox-heading')
    .first()
    .contents()
    .filter((_, node) => node.type === 'text')
    .text()
    .trim();
  const country = $('.infobox-heading img.flag').first().attr('alt')?.trim() ?? '';

  const results: CrawledResult[] = [];
  let season: string | null = null;

  $('table.data-table tr').each((_, el) => {
    const heading = $(el).find('th.sub-heading').first();
    if (heading.length > 0) {
      season = parseSeasonKey(heading.text());
      return;
    }
    const cells = $(el).find('td');
    const link = cells.eq(1).find('a[href^="/tournaments/"]');
    const tournamentId = link.attr('href')?.split('/').pop();
    if (!tournamentId || !season) {
      return;
    }
    results.push({
      tournamentId,
      name: link.text().trim(),
      season,
      place: parsePlace(cells.eq(2).text()),
      cash: parseCash(cells.eq(5).text())
    });
  });

  return { name, country, results };
}

/**
 * Every id a previous run already settled: players it captured, plus ids it
 * found nothing behind. Repairs a torn final line in place, so a kill during
 * an append can't leave the file unreadable for `build-earnings`.
 */
function loadSettledIds(): Set<string> {
  const settled = new Set<string>();
  if (existsSync(OUT_PATH)) {
    const { ids, lines, torn } = parseCrawledIds(readFileSync(OUT_PATH, 'utf8'));
    if (torn > 0) {
      writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8');
      console.log(`[crawl] Dropped ${torn} torn line(s) from a previous run and repaired the file`);
    }
    for (const id of ids) {
      settled.add(id);
    }
  }
  if (existsSync(DEAD_PATH)) {
    for (const line of readFileSync(DEAD_PATH, 'utf8').split('\n')) {
      if (line.trim()) {
        settled.add(line.trim());
      }
    }
  }
  return settled;
}

/** Crawl one id. Returns false when the id has no player behind it. */
async function crawlPlayer(id: number): Promise<boolean> {
  const html = await fetchHtml(`${BASE_URL}/players/${id}/results${RESULTS_QUERY}`);
  if (!html) {
    // Record the miss too — otherwise every resume re-fetches all of them.
    appendFileSync(DEAD_PATH, `${id}\n`);
    return false;
  }
  appendFileSync(OUT_PATH, `${JSON.stringify({ id: String(id), ...parseResults(html) })}\n`);
  return true;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  mkdirSync(CACHE_DIR, { recursive: true });

  const settled = loadSettledIds();
  const pending: number[] = [];
  for (let id = 1; id <= MAX_PLAYER_ID; id += 1) {
    if (!settled.has(String(id))) {
      pending.push(id);
    }
  }
  console.log(
    `[crawl] division=${DIVISION}, ids 1-${MAX_PLAYER_ID}, ${settled.size} already settled, ${pending.length} to fetch`
  );
  if (pending.length === 0) {
    console.log('[crawl] Nothing to do');
    return;
  }

  let cursor = 0;
  let written = 0;
  let missing = 0;

  // Each worker sleeps RATE_LIMIT_MS between its own requests. Limitless
  // answers a results page in well under the sleep, so two workers measure at
  // ~6.5 requests/second rather than the 4/s the sleep alone would imply —
  // above the ceiling scripts/build-card-types.mjs sets against the same site.
  // Lower CONCURRENCY to 1 for ~3/s if that ever needs to come down.
  async function worker(): Promise<void> {
    for (let index = cursor; index < pending.length; index = cursor) {
      cursor += 1;
      const found = await crawlPlayer(pending[index]);
      if (found) {
        written += 1;
      } else {
        missing += 1;
      }
      const seen = written + missing;
      if (seen % 500 === 0) {
        const rate = seen / ((Date.now() - t0) / 1000);
        const left = Math.round((pending.length - seen) / rate / 60);
        console.log(`[crawl] ${seen}/${pending.length}: ${written} written, ${missing} dead, ~${left}m left`);
      }
      await sleep(RATE_LIMIT_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`[crawl] Done: ${written} players, ${missing} dead ids, ${((Date.now() - t0) / 1000 / 60).toFixed(1)}m`);
}

main().catch((err: unknown) => {
  console.error('[crawl] Failed', err);
  process.exit(1);
});
