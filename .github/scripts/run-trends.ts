#!/usr/bin/env node

/**
 * Trends-only builder for the past month of online tournaments.
 * Keeps the legacy online-meta job untouched. Outputs:
 *   reports/Trends - Last 30 Days/trends.json   daily archetype series, card
 *                                               movers, and the weekly report
 *                                               (this week against last)
 *   reports/Trends - Last 30 Days/meta.json
 *   reports/Trends - Last 30 Days/history.json  forward-rolling day ledger
 *
 * The raw deck dump this job used to publish (~78 MB a day, read by nothing,
 * copied into every immutable release) is gone: everything the page needs is
 * digested here.
 */

import { boolEnv, requireEnv } from './lib/env.ts';
import process from 'node:process';
import { createR2Client, createReportsBinding } from './lib/r2.mjs';
import { deleteR2Keys, listR2Keys } from './lib/r2Inventory.mjs';
import {
  appendTrendHistory,
  buildCardTrendReport,
  buildTrendReport,
  buildWeeklyReport,
  compileExclusions,
  DEFAULT_MIN_FIELD_PLAYERS,
  fetchRecentOnlineTournaments,
  gatherDecks,
  utcDayWindow
} from '../../shared/onlineMeta/index.ts';
import { fetchLimitlessJson } from './lib/onlineFetch';
import type { DiagnosticsCollector, TrendHistory, TrendSeriesEntry } from '../../shared/onlineMeta/types.ts';
import { requireSynonymDatabase, type SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import onlineExclusions from '../../config/online-exclusions.json';

const TRENDS_FOLDER = 'Trends - Last 30 Days';
const HISTORY_KEY = `${TRENDS_FOLDER}/history.json`;
const LOOKBACK_DAYS = 30;
const MAX_ARCHETYPES_IN_SERIES = 32;
/**
 * A calendar day needs this many decks across every event to plot. The
 * current window's thinnest full day carries ~350; this only catches a day
 * that one small event had to itself.
 */
const MIN_DAY_DECKS = 100;
// If the default lookback yields too few tournaments, widen the window step-by-step
// until we have enough events for the rising/falling chunked-average computation
// to produce non-degenerate deltas. 4 events => chunk=2 on each side, no overlap.
const MIN_TREND_TOURNAMENTS = 4;
const LOOKBACK_FALLBACK_STEPS = [45, 60, 90];

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

const s3Client = createR2Client({
  accountId: R2_ACCOUNT_ID,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY
});

// Shared retrying binding (404 → null, other errors throw). This class keeps
// only the prefix + list/delete helpers that are specific to this job.
const reports = createReportsBinding(s3Client, R2_BUCKET_NAME);

class R2Binding {
  private readonly prefix: string;

  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/+$/, '');
  }

  withPrefix(key: string) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key: string, data: unknown) {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await reports.put(this.withPrefix(key), body);
    if (key === HISTORY_KEY) {
      await this.removeStaleTrendArtifacts();
    }
  }

  private async removeStaleTrendArtifacts() {
    const expected = new Set(
      [`${TRENDS_FOLDER}/meta.json`, `${TRENDS_FOLDER}/trends.json`, HISTORY_KEY].map(key => this.withPrefix(key))
    );
    const stale = (await this.listKeys(`${TRENDS_FOLDER}/`)).filter(key => !expected.has(key));
    await this.deleteKeys(stale);
  }

  async get(key: string) {
    return reports.get(this.withPrefix(key));
  }

  listKeys(prefix: string) {
    return listR2Keys(s3Client, R2_BUCKET_NAME, this.withPrefix(prefix));
  }

  deleteKeys(keys: string[]) {
    return deleteR2Keys(s3Client, R2_BUCKET_NAME, keys);
  }

  async deletePrefix(prefix: string) {
    const keys = await this.listKeys(prefix);
    const deleted = await this.deleteKeys(keys);
    return { keys: keys.length, deleted };
  }
}

function trimTrendSeries(series: TrendSeriesEntry[] = [], limit = MAX_ARCHETYPES_IN_SERIES) {
  const max = Math.max(0, Number(limit) || 0);
  if (!Array.isArray(series) || !series.length || max === 0) {
    return [];
  }

  return series.slice(0, max);
}

/** The synonym database. It lives at the bucket root, outside the reports prefix. */
async function loadSynonymDatabase(): Promise<SynonymDatabase> {
  const key = 'assets/card-synonyms.json';
  const object = await reports.get(key);
  const db = requireSynonymDatabase(object ? await object.json() : null, key);
  console.log(`[trends] Card synonyms: ${Object.keys(db.synonyms ?? {}).length} entries`);
  return db;
}

/** The stored history ledger, or null before the first run. */
async function loadHistory(reportsBinding: R2Binding): Promise<TrendHistory | null> {
  const object = await reportsBinding.get(HISTORY_KEY);
  if (!object) {
    return null;
  }
  const data = (await object.json()) as Partial<TrendHistory>;
  return Array.isArray(data.days) ? (data as TrendHistory) : null;
}

type TrendsEnv = { REPORTS: R2Binding; LIMITLESS_API_KEY: string };
type TrendsFetch = (pathname: string, options?: Parameters<typeof fetchLimitlessJson>[1]) => Promise<unknown>;
type Tournaments = Awaited<ReturnType<typeof fetchRecentOnlineTournaments>>;
type Decks = Awaited<ReturnType<typeof gatherDecks>>;

/** The Limitless client for this run; a clean rebuild forces origin revalidation. */
function trendsFetch(env: TrendsEnv, cleanMonthCache: boolean): TrendsFetch {
  return async (pathname, options = {}) => {
    const baseFetchOptions = options?.fetchOptions || {};
    const headers = new Headers(baseFetchOptions.headers || undefined);
    if (cleanMonthCache) {
      // Force origin revalidation when doing a clean rebuild.
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
    }
    return fetchLimitlessJson(pathname, {
      ...options,
      env,
      fetchOptions: {
        ...baseFetchOptions,
        cache: cleanMonthCache ? 'no-store' : baseFetchOptions.cache,
        headers
      }
    });
  };
}

interface TrendWindow {
  window: ReturnType<typeof utcDayWindow>;
  lookbackDays: number;
  tournaments: Tournaments;
}

/**
 * The lookback window and its tournaments. Auto-widens when there are too few
 * tournaments to compute meaningful chunked-average deltas: without this,
 * sparse windows produce identical Rising / Cooling lists with delta=0 across
 * the board.
 */
async function fetchTrendWindow(
  env: TrendsEnv,
  now: Date,
  fetchJson: TrendsFetch,
  diagnostics: DiagnosticsCollector
): Promise<TrendWindow> {
  const exclusions = compileExclusions(onlineExclusions);
  const fetchWindow = (window: ReturnType<typeof utcDayWindow>) =>
    fetchRecentOnlineTournaments(env, window.start, {
      maxPages: 20,
      windowEnd: window.lastInstant,
      fetchJson,
      diagnostics,
      exclusions
    });
  // Whole UTC days ending yesterday, so the chart never ends on a half day.
  let lookbackDays = LOOKBACK_DAYS;
  let window = utcDayWindow(now, lookbackDays);
  console.log(`[trends] Fetching tournaments ${window.start.toISOString()} .. ${window.end.toISOString()}`);
  let tournaments = await fetchWindow(window);
  console.log(
    `[trends] Tournaments: ${tournaments.length} (${diagnostics.excludedTournaments?.length || 0} excluded by config)`
  );

  for (const widerLookback of LOOKBACK_FALLBACK_STEPS) {
    if (tournaments.length >= MIN_TREND_TOURNAMENTS) {
      break;
    }
    console.log(
      `[trends] Only ${tournaments.length} tournament(s) in last ${lookbackDays}d; widening to ${widerLookback}d`
    );
    lookbackDays = widerLookback;
    window = utcDayWindow(now, lookbackDays);
    tournaments = await fetchWindow(window);
    console.log(`[trends] Tournaments after widening: ${tournaments.length}`);
  }

  if (!tournaments.length) {
    throw new Error('No tournaments found for trends window');
  }
  return { window, lookbackDays, tournaments };
}

/** Drop tournaments that produced no decks, to avoid zero-denominator timelines. */
function tournamentsWithDecks(tournaments: Tournaments, decks: Decks): Tournaments {
  const deckCountByTournament = new Map<string, number>();
  for (const deck of decks) {
    const tid = deck?.tournamentId;
    if (tid) {
      deckCountByTournament.set(tid, (deckCountByTournament.get(tid) || 0) + 1);
    }
  }
  const kept = tournaments.filter(t => (deckCountByTournament.get(t.id) || 0) > 0);
  if (!kept.length) {
    throw new Error('All tournaments were empty after deck filtering');
  }
  if (kept.length !== tournaments.length) {
    console.log(`[trends] Dropped ${tournaments.length - kept.length} tournaments with no deck data`);
  }
  return kept;
}

async function gatherTrendDecks(
  env: TrendsEnv,
  tournaments: Tournaments,
  fetchJson: TrendsFetch,
  diagnostics: DiagnosticsCollector
): Promise<Decks> {
  console.log('[trends] Gathering decks...');
  // No card-types enrichment: nothing trends publishes reads card categories.
  const decks = await gatherDecks(env, tournaments, diagnostics, { fetchJson });
  console.log(`[trends] Decks: ${decks.length}`);
  if (diagnostics?.archetypeClassification) {
    console.log('[trends] Archetype classification summary:', diagnostics.archetypeClassification);
  }
  if (!decks.length) {
    throw new Error('No decks gathered for trends');
  }
  return decks;
}

async function buildTrendArtifacts(decks: Decks, tournaments: Tournaments, span: TrendWindow, now: Date) {
  const { window, lookbackDays } = span;
  const rawTrendReport = buildTrendReport(decks, tournaments, {
    windowStart: window.start,
    windowEnd: window.end,
    now,
    minAppearances: 2,
    minDayDecks: MIN_DAY_DECKS
  });
  const {
    tournaments: trendTournaments = tournaments,
    series: rawSeries = [],
    ...trendReportMeta
  } = rawTrendReport || {};
  const trimmedSeries = trimTrendSeries(rawSeries, MAX_ARCHETYPES_IN_SERIES);
  const trendReport = {
    ...trendReportMeta,
    series: trimmedSeries,
    archetypeCount: trimmedSeries.length
  };
  const cardTrends = buildCardTrendReport(decks, trendTournaments, {
    windowStart: window.start,
    windowEnd: window.end,
    minAppearances: 2
  });
  // This week against last, from the same decks. The floors match the daily
  // chart's: a day under MIN_DAY_DECKS plots as a gap here too.
  const synonymDb = await loadSynonymDatabase();
  const weekly = buildWeeklyReport(decks, {
    windowEnd: window.end,
    dailyDays: lookbackDays,
    synonymDb,
    minDayLists: MIN_DAY_DECKS,
    now
  });
  console.log(
    `[trends] Weekly: ${weekly.recent.lists} lists this week vs ${weekly.prior.lists} last, ` +
      `${weekly.archetypes.length} archetypes, ${weekly.decks.length} deck blocks, ` +
      `${weekly.movers.rising.length} rising / ${weekly.movers.falling.length} falling`
  );
  return { trendReport, cardTrends, weekly };
}

function buildTrendMeta(
  span: TrendWindow,
  counts: { decks: number; tournaments: number },
  diagnostics: DiagnosticsCollector,
  now: Date
) {
  return {
    name: TRENDS_FOLDER,
    generatedAt: now.toISOString(),
    windowStart: span.window.start.toISOString(),
    windowEnd: span.window.end.toISOString(),
    lookbackDays: span.lookbackDays,
    deckTotal: counts.decks,
    tournamentCount: counts.tournaments,
    fieldPolicy: {
      population: 'players with a placing',
      minFieldPlayers: DEFAULT_MIN_FIELD_PLAYERS,
      minDayDecks: MIN_DAY_DECKS
    },
    unplacedEntries: diagnostics.entriesWithoutPlacing?.length || 0,
    excluded: diagnostics.excludedTournaments || [],
    skipped: {
      belowMinimum: diagnostics.tournamentsBelowMinimum || [],
      standingsFailures: diagnostics.standingsFetchFailures || [],
      detailsFailures: diagnostics.detailsFetchFailures || []
    }
  };
}

async function main() {
  const cleanMonthCache = boolEnv('CLEAN_MONTH_CACHE');
  const now = new Date();
  const env: TrendsEnv = {
    REPORTS: new R2Binding(R2_REPORTS_PREFIX),
    LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY')
  };

  if (cleanMonthCache) {
    console.log(`[trends] CLEAN_MONTH_CACHE=true: deleting existing ${TRENDS_FOLDER} artifacts before rebuild...`);
    const deleted = await env.REPORTS.deletePrefix(`${TRENDS_FOLDER}/`);
    console.log(`[trends] Deleted ${deleted.deleted}/${deleted.keys} objects from ${TRENDS_FOLDER}/`);
  }

  const fetchJson = trendsFetch(env, cleanMonthCache);
  const diagnostics: DiagnosticsCollector = {};
  const span = await fetchTrendWindow(env, now, fetchJson, diagnostics);
  const decks = await gatherTrendDecks(env, span.tournaments, fetchJson, diagnostics);
  const tournaments = tournamentsWithDecks(span.tournaments, decks);
  const { trendReport, cardTrends, weekly } = await buildTrendArtifacts(decks, tournaments, span, now);
  const meta = buildTrendMeta(span, { decks: decks.length, tournaments: tournaments.length }, diagnostics, now);

  console.log('[trends] Uploading meta, trends, and history...');
  await env.REPORTS.put(`${TRENDS_FOLDER}/meta.json`, meta);
  await env.REPORTS.put(`${TRENDS_FOLDER}/trends.json`, { trendReport, cardTrends, weekly });

  // One row per day, forever: the only memory of the online meta older than
  // the window. A rerun on the same day replaces that day's row.
  const history = appendTrendHistory(await loadHistory(env.REPORTS), weekly);
  await env.REPORTS.put(HISTORY_KEY, history);

  console.log('[trends] Done', {
    tournaments: tournaments.length,
    decks: decks.length,
    archetypeSeries: trendReport.series?.length || 0,
    cardRising: cardTrends.rising?.length || 0,
    cardFalling: cardTrends.falling?.length || 0,
    weeklyDecks: weekly.decks.length,
    historyDays: history.days.length
  });
}

main().catch(error => {
  console.error('[trends] Failed', error);
  process.exit(1);
});
