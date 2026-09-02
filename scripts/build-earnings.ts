/**
 * Build `static/earnings.json` from the crawled results.
 *
 * Two numbers per player per season:
 *
 *   actual   — the prize money Limitless records against each finish.
 *   adjusted — the same finishes paid from the CURRENT published tables, so a
 *              2013 win and a 2026 win can be compared. Pokemon's payouts have
 *              risen several times over, which is what makes raw career totals
 *              flatter the recent era.
 *
 * Only Regional, International and Worlds have a published table today.
 * Nationals (the pre-2017 flagship, often larger than a modern Regional) are
 * paid at International rates and Special Championships at Regional rates —
 * without that, every career built before 2017 restates to near zero. Champions
 * League, online events, Players Cup and invitationals adjust to $0.
 *
 * Reads:  .cache/limitless/player-results.ndjson (npm run crawl:players)
 * Writes: static/earnings.json        — the leaderboard the table ranks
 *         static/earnings-events.json — per-event detail for expanded rows
 *
 * Usage:
 *   npx tsx scripts/build-earnings.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as cheerio from 'cheerio';
import type {
  CrawledPlayer,
  EarningsEvent,
  EarningsEventsPayload,
  EarningsPayload,
  EarningsPlayer
} from '../shared/earningsTypes';
import { payoutFor, seasonList, TIER_OF_TYPE, totalsFor } from '../shared/earningsPayouts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'limitless');
const RESULTS_PATH = join(CACHE_DIR, 'player-results.ndjson');
const TIERS_PATH = join(CACHE_DIR, 'tournament-tiers.json');
const OUT_PATH = join(ROOT, 'static', 'earnings.json');
const EVENTS_OUT_PATH = join(ROOT, 'static', 'earnings-events.json');

const BASE_URL = 'https://limitlesstcg.com';
const USER_AGENT = 'ciphermaniac-earnings/1.0 (+https://ciphermaniac.com)';
const RATE_LIMIT_MS = 250;

const PAYOUT_SOURCE = 'https://championships.pokemon.com/en-us/about/pokemon-regional-and-special-championships';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/* ---------------- tournament tiers ---------------- */

/**
 * Which event type each tournament is, read from the tournament index's own
 * type filter — the results pages don't say. A handful of requests, cached so
 * a rebuild is offline.
 */
async function loadTierMap(): Promise<Record<string, string>> {
  if (existsSync(TIERS_PATH)) {
    return JSON.parse(readFileSync(TIERS_PATH, 'utf8')) as Record<string, string>;
  }
  const types: Record<string, string> = {};
  for (const type of Object.keys(TIER_OF_TYPE)) {
    let page = 1;
    let maxPage = 1;
    do {
      const res = await fetch(`${BASE_URL}/tournaments?type=${type}&show=100&page=${page}`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!res.ok) {
        throw new Error(`Tournament index ${type} page ${page}: HTTP ${res.status}`);
      }
      const $ = cheerio.load(await res.text());
      maxPage = Number($('ul.pagination').attr('data-max') ?? 1);
      $('table.data-table a[href^="/tournaments/"]').each((_, el) => {
        const id = $(el).attr('href')?.split('/').pop();
        if (id && /^\d+$/.test(id)) {
          types[id] = type;
        }
      });
      page += 1;
      await sleep(RATE_LIMIT_MS);
    } while (page <= maxPage);
    console.log(`[earnings] ${type}: ${Object.values(types).filter(t => t === type).length} tournaments`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(TIERS_PATH, JSON.stringify(types), 'utf8');
  return types;
}

/* ---------------- build ---------------- */

function readCrawl(path: string): CrawledPlayer[] {
  if (!existsSync(path)) {
    throw new Error(`No crawl at ${path} — run \`npm run crawl:players\` first`);
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as CrawledPlayer);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const types = await loadTierMap();
  const typeOf = (id: string) => types[id];
  const crawled = readCrawl(RESULTS_PATH);
  console.log(`[earnings] ${crawled.length} crawled players, ${Object.keys(types).length} tiered tournaments`);

  const players: EarningsPlayer[] = [];
  const events: Record<string, EarningsEvent[]> = {};
  for (const entry of crawled) {
    const { actual, adjusted } = totalsFor(entry.results, typeOf);
    // A player who never cashed and never placed into a paying bracket has
    // nothing to rank under either basis.
    if (actual.total === 0 && adjusted.total === 0) {
      continue;
    }
    players.push({ id: entry.id, name: entry.name, country: entry.country, actual, adjusted });
    events[entry.id] = entry.results.map(row => {
      const tier = TIER_OF_TYPE[typeOf(row.tournamentId) ?? ''];
      return {
        name: row.name,
        season: row.season,
        place: row.place,
        cash: row.cash,
        adjusted: tier ? payoutFor(tier, row.place, row.division) : 0
      };
    });
  }
  if (players.length === 0) {
    throw new Error('No players with earnings — refusing to overwrite the existing file');
  }
  players.sort((a, b) => b.actual.total - a.actual.total);

  const payload: EarningsPayload = {
    generatedAt: new Date().toISOString(),
    source: `${BASE_URL}/players`,
    payoutSource: PAYOUT_SOURCE,
    seasons: seasonList(players.flatMap(p => [...Object.keys(p.actual.seasons), ...Object.keys(p.adjusted.seasons)])),
    players
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');

  const eventsPayload: EarningsEventsPayload = { generatedAt: payload.generatedAt, events };
  writeFileSync(EVENTS_OUT_PATH, `${JSON.stringify(eventsPayload)}\n`, 'utf8');

  console.log(
    `[earnings] Wrote ${players.length} players, ${payload.seasons.length} seasons to ${OUT_PATH} in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(1)}s`
  );
}

main().catch((err: unknown) => {
  console.error('[earnings] Failed', err);
  process.exit(1);
});
