/**
 * Scrape per-season prize earnings for Limitless TCG players.
 *
 * Limitless publishes an earnings leaderboard at /players?rank=money, filtered
 * by season via the `time` parameter (2526 = the 2025-26 season). Every player
 * who cashed in a season appears there, so a handful of paginated leaderboard
 * requests replaces crawling ~15k individual player pages. Career totals are
 * the sum of a player's seasons.
 *
 * The trade-off: leaderboards are aggregate-only. Tournament-level cash rows
 * (biggest single payouts) live on /players/{id}/results and need the full
 * per-player crawl, which this script deliberately does not do yet.
 *
 * Writes `static/earnings.json`, served verbatim by the build.
 *
 * Usage:
 *   npx tsx scripts/scrape-player-earnings.ts          # top 500 per season
 *   TOP_N=100 npx tsx scripts/scrape-player-earnings.ts
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as cheerio from 'cheerio';
import type { EarningsPayload, EarningsPlayer, EarningsSeason } from '../shared/earningsTypes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'static', 'earnings.json');

const BASE_URL = 'https://limitlesstcg.com';
const USER_AGENT = 'ciphermaniac-earnings/1.0 (+https://ciphermaniac.com)';
// 4 requests per second, matching scripts/build-card-types.mjs.
const RATE_LIMIT_MS = 250;
const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 3;
const PER_PAGE = 100;

/** How deep into each season's leaderboard to go, counted in distinct players. */
const TOP_N = Number(process.env.TOP_N ?? 500);
if (!Number.isInteger(TOP_N) || TOP_N < 1) {
  throw new Error(`TOP_N must be a positive integer, got ${JSON.stringify(process.env.TOP_N)}`);
}

interface LeaderboardRow {
  id: string;
  name: string;
  country: string;
  earnings: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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

/**
 * Season buckets come from the page's own time filter rather than a hardcoded
 * list, so a new season starts showing up the next time this runs.
 */
function parseSeasons(html: string): EarningsSeason[] {
  const $ = cheerio.load(html);
  const seasons: EarningsSeason[] = [];
  $('select[name="time"] optgroup option').each((_, el) => {
    const key = $(el).attr('value');
    const label = $(el).text().trim();
    if (key && label) {
      seasons.push({ key, label });
    }
  });
  return seasons;
}

function parseMoney(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function parseLeaderboardRows(html: string): LeaderboardRow[] {
  const $ = cheerio.load(html);
  const rows: LeaderboardRow[] = [];
  $('table.data-table tr').each((_, el) => {
    const cells = $(el).find('td');
    const link = cells.eq(1).find('a[href^="/players/"]');
    const id = link.attr('href')?.split('/').pop();
    if (cells.length < 5 || !id) {
      return;
    }
    rows.push({
      id,
      name: link.text().trim(),
      country: cells.eq(3).find('img.flag').attr('alt')?.trim() ?? '',
      earnings: parseMoney(cells.eq(4).text())
    });
  });
  return rows;
}

function parseMaxPage(html: string): number {
  const $ = cheerio.load(html);
  const max = $('ul.pagination').attr('data-max');
  return max ? Number(max) : 1;
}

function leaderboardUrl(seasonKey: string, page: number): string {
  return `${BASE_URL}/players?rank=money&zone=all&time=${seasonKey}&show=${PER_PAGE}&page=${page}`;
}

async function scrapeSeason(season: EarningsSeason): Promise<LeaderboardRow[]> {
  // Keyed by player id: a tie spanning a page boundary can list the same
  // player on both pages, and Limitless's own rank column repeats too. Dedupe
  // as we go so TOP_N counts distinct players rather than distinct rows.
  const rows = new Map<string, LeaderboardRow>();
  const lastPage = Math.ceil(TOP_N / PER_PAGE);
  let maxPage = lastPage;

  for (let page = 1; page <= Math.min(lastPage, maxPage) && rows.size < TOP_N; page += 1) {
    const html = await fetchHtml(leaderboardUrl(season.key, page));
    if (page === 1) {
      maxPage = parseMaxPage(html);
    }
    const pageRows = parseLeaderboardRows(html);
    if (pageRows.length === 0) {
      // Every season on the filter has at least one cashing player, so an
      // empty table means the row markup moved — not that nobody earned.
      throw new Error(`No leaderboard rows for ${season.label} page ${page} — the Limitless table markup changed`);
    }
    for (const row of pageRows) {
      if (!rows.has(row.id)) {
        rows.set(row.id, row);
      }
    }
    console.log(`[earnings] ${season.label} page ${page}/${Math.min(lastPage, maxPage)}: ${rows.size} players`);
    if (pageRows.length < PER_PAGE) {
      break;
    }
    await sleep(RATE_LIMIT_MS);
  }

  return [...rows.values()].slice(0, TOP_N);
}

/**
 * Merge a season's rows into the career map. Name and country are taken from
 * the most recent season a player appears in — Limitless abbreviates the names
 * of players who haven't opted into full display, and that preference can
 * change, so the newest rendering is the one to trust.
 */
function mergeSeason(players: Map<string, EarningsPlayer>, season: EarningsSeason, rows: LeaderboardRow[]): void {
  for (const row of rows) {
    const existing = players.get(row.id);
    if (existing) {
      existing.seasons[season.key] = row.earnings;
      continue;
    }
    players.set(row.id, {
      id: row.id,
      name: row.name,
      country: row.country,
      seasons: { [season.key]: row.earnings },
      total: 0
    });
  }
}

/** Career total, recomputed from the season map rather than accumulated. */
function sumSeasons(player: EarningsPlayer): number {
  return Object.values(player.seasons).reduce((sum, amount) => sum + amount, 0);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const seasons = parseSeasons(await fetchHtml(`${BASE_URL}/players`));
  if (seasons.length === 0) {
    throw new Error('No season options found — the Limitless filter markup changed');
  }
  console.log(`[earnings] ${seasons.length} seasons, top ${TOP_N} each`);

  // Newest season first so the freshest name/country wins in mergeSeason.
  const players = new Map<string, EarningsPlayer>();
  for (const season of seasons) {
    await sleep(RATE_LIMIT_MS);
    mergeSeason(players, season, await scrapeSeason(season));
  }

  for (const player of players.values()) {
    player.total = sumSeasons(player);
  }
  const ranked = [...players.values()].sort((a, b) => b.total - a.total);
  if (ranked.length === 0) {
    throw new Error('Scrape produced no players — refusing to overwrite the existing file');
  }
  const payload: EarningsPayload = {
    generatedAt: new Date().toISOString(),
    source: `${BASE_URL}/players?rank=money`,
    topPerSeason: TOP_N,
    seasons,
    players: ranked
  };
  await writeFile(OUT_PATH, `${JSON.stringify(payload)}\n`, 'utf8');

  console.log(`[earnings] Wrote ${ranked.length} players to ${OUT_PATH} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err: unknown) => {
  console.error('[earnings] Failed', err);
  process.exit(1);
});
