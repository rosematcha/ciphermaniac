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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'static', 'earnings.json');

const BASE_URL = 'https://limitlesstcg.com';
const USER_AGENT = 'ciphermaniac-earnings/1.0 (+https://ciphermaniac.com)';
// 4 requests per second, matching scripts/build-card-types.mjs.
const RATE_LIMIT_MS = 250;
const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 3;
const PER_PAGE = 100;

/** How deep into each season's leaderboard to go. */
const TOP_N = Number(process.env.TOP_N ?? 500);

interface Season {
  key: string;
  label: string;
}

interface LeaderboardRow {
  id: string;
  name: string;
  country: string;
  earnings: number;
}

interface PlayerRecord {
  id: string;
  name: string;
  country: string;
  seasons: Record<string, number>;
  total: number;
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
function parseSeasons(html: string): Season[] {
  const $ = cheerio.load(html);
  const seasons: Season[] = [];
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

async function scrapeSeason(season: Season): Promise<LeaderboardRow[]> {
  const rows: LeaderboardRow[] = [];
  const lastPage = Math.ceil(TOP_N / PER_PAGE);
  let maxPage = lastPage;

  for (let page = 1; page <= Math.min(lastPage, maxPage); page += 1) {
    const html = await fetchHtml(leaderboardUrl(season.key, page));
    if (page === 1) {
      maxPage = parseMaxPage(html);
    }
    const pageRows = parseLeaderboardRows(html);
    rows.push(...pageRows);
    console.log(`[earnings] ${season.label} page ${page}/${Math.min(lastPage, maxPage)}: ${pageRows.length} rows`);
    if (pageRows.length < PER_PAGE) {
      break;
    }
    await sleep(RATE_LIMIT_MS);
  }

  return rows.slice(0, TOP_N);
}

/**
 * Merge a season's rows into the career map. Name and country are taken from
 * the most recent season a player appears in — Limitless abbreviates the names
 * of players who haven't opted into full display, and that preference can
 * change, so the newest rendering is the one to trust.
 */
function mergeSeason(players: Map<string, PlayerRecord>, season: Season, rows: LeaderboardRow[]): void {
  for (const row of rows) {
    const existing = players.get(row.id);
    if (existing) {
      existing.seasons[season.key] = row.earnings;
      existing.total += row.earnings;
      continue;
    }
    players.set(row.id, {
      id: row.id,
      name: row.name,
      country: row.country,
      seasons: { [season.key]: row.earnings },
      total: row.earnings
    });
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const seasons = parseSeasons(await fetchHtml(`${BASE_URL}/players`));
  if (seasons.length === 0) {
    throw new Error('No season options found — the Limitless filter markup changed');
  }
  console.log(`[earnings] ${seasons.length} seasons, top ${TOP_N} each`);

  // Newest season first so the freshest name/country wins in mergeSeason.
  const players = new Map<string, PlayerRecord>();
  for (const season of seasons) {
    await sleep(RATE_LIMIT_MS);
    mergeSeason(players, season, await scrapeSeason(season));
  }

  const ranked = [...players.values()].sort((a, b) => b.total - a.total);
  const payload = {
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
