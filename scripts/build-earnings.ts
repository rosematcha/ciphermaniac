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
 * Reads both crawl passes (npm run crawl:players, then crawl:players:all):
 * the unfiltered one supplies every finish, and the Masters-filtered one says
 * which of those finishes were Masters. Anything in the first but not the
 * second was a Junior or Senior result and restates from the lower column.
 *
 * Reads:  .cache/limitless/player-results-{all,ma}.ndjson
 * Writes: static/earnings.json
 *
 * Usage:
 *   npx tsx scripts/build-earnings.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as cheerio from 'cheerio';
import type { CrawledPlayer, DividedResult, EarningsPayload, EarningsPlayer } from '../shared/earningsTypes';
import { seasonList, TIER_OF_TYPE, totalsFor } from '../shared/earningsPayouts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'limitless');
const ALL_PATH = join(CACHE_DIR, 'player-results-all.ndjson');
const MASTERS_PATH = join(CACHE_DIR, 'player-results-ma.ndjson');
const TIERS_PATH = join(CACHE_DIR, 'tournament-tiers.json');
const OUT_PATH = join(ROOT, 'static', 'earnings.json');

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
    throw new Error(`No crawl at ${path} — run \`npm run crawl:players\` and \`npm run crawl:players:all\` first`);
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as CrawledPlayer);
}

/**
 * Label each of a player's finishes with the division it was played in.
 *
 * A player enters any given tournament once, so the tournament id identifies
 * the finish: present in the Masters-filtered pass means Masters, absent means
 * Juniors or Seniors.
 */
export function withDivisions(all: CrawledPlayer['results'], mastersTournamentIds: Set<string>): DividedResult[] {
  return all.map(row => ({
    ...row,
    division: mastersTournamentIds.has(row.tournamentId) ? ('masters' as const) : ('junior-senior' as const)
  }));
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const types = await loadTierMap();
  const typeOf = (id: string) => types[id];
  const crawled = readCrawl(ALL_PATH);
  const mastersById = new Map(
    readCrawl(MASTERS_PATH).map(entry => [entry.id, new Set(entry.results.map(r => r.tournamentId))])
  );
  console.log(
    `[earnings] ${crawled.length} crawled players (${mastersById.size} with a Masters pass), ` +
      `${Object.keys(types).length} tiered tournaments`
  );

  const players: EarningsPlayer[] = [];
  for (const entry of crawled) {
    const results = withDivisions(entry.results, mastersById.get(entry.id) ?? new Set());
    const { actual, adjusted } = totalsFor(results, typeOf);
    // A player who never cashed and never placed into a paying bracket has
    // nothing to rank under either basis.
    if (actual.total === 0 && adjusted.total === 0) {
      continue;
    }
    players.push({ id: entry.id, name: entry.name, country: entry.country, actual, adjusted });
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
