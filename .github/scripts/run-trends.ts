#!/usr/bin/env node

/**
 * Trends-only builder for the past month of online tournaments.
 * Keeps the legacy online-meta job untouched. Outputs:
 *   reports/Trends - Last 30 Days/trends.json
 *   reports/Trends - Last 30 Days/meta.json
 */

import process from 'node:process';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createR2Client, createReportsBinding } from './lib/r2.mjs';
import {
  fetchRecentOnlineTournaments,
  gatherDecks,
  buildTrendReport,
  buildCardTrendReport
} from '../../functions/lib/onlineMeta/index.ts';
import { loadCardTypesDatabase } from '../../functions/lib/data/cardTypesDatabase.js';
import { fetchLimitlessJson } from '../../functions/lib/api/limitless.ts';
import type { DiagnosticsCollector, TrendSeriesEntry } from '../../functions/lib/onlineMeta/types.ts';

const TRENDS_FOLDER = 'Trends - Last 30 Days';
const LOOKBACK_DAYS = 30;
const MAX_ARCHETYPES_IN_SERIES = 32;
// If the default lookback yields too few tournaments, widen the window step-by-step
// until we have enough events for the rising/falling chunked-average computation
// to produce non-degenerate deltas. 4 events => chunk=2 on each side, no overlap.
const MIN_TREND_TOURNAMENTS = 4;
const LOOKBACK_FALLBACK_STEPS = [45, 60, 90];

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

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
  }

  async get(key: string) {
    return reports.get(this.withPrefix(key));
  }

  async listKeys(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      // eslint-disable-next-line no-await-in-loop
      const response = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET_NAME,
          Prefix: this.withPrefix(prefix),
          ContinuationToken: continuationToken
        })
      );
      for (const object of response.Contents || []) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteKeys(keys: string[]) {
    if (!Array.isArray(keys) || !keys.length) {
      return 0;
    }
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET_NAME,
          Delete: {
            Objects: chunk.map(key => ({ Key: key })),
            Quiet: true
          }
        })
      );
      deleted += chunk.length;
    }
    return deleted;
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

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function main() {
  const cleanMonthCache = parseBoolean(process.env.CLEAN_MONTH_CACHE, false);
  const windowEnd = new Date();
  let lookbackDays = LOOKBACK_DAYS;
  let since = new Date(windowEnd.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
  const now = windowEnd;

  const env = {
    REPORTS: new R2Binding(R2_REPORTS_PREFIX),
    LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY')
  };

  if (cleanMonthCache) {
    console.log(`[trends] CLEAN_MONTH_CACHE=true: deleting existing ${TRENDS_FOLDER} artifacts before rebuild...`);
    const deleted = await env.REPORTS.deletePrefix(`${TRENDS_FOLDER}/`);
    console.log(`[trends] Deleted ${deleted.deleted}/${deleted.keys} objects from ${TRENDS_FOLDER}/`);
  }

  const fetchJson = async (pathname: string, options: Parameters<typeof fetchLimitlessJson>[1] = {}) => {
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

  console.log(`[trends] Loading card types database...`);
  const cardTypesDb = await loadCardTypesDatabase(env);
  console.log(`[trends] Card DB entries: ${Object.keys(cardTypesDb || {}).length}`);

  console.log(`[trends] Fetching tournaments since ${since.toISOString()}`);
  let tournaments = await fetchRecentOnlineTournaments(env, since, { maxPages: 20, windowEnd, fetchJson });
  console.log(`[trends] Tournaments: ${tournaments.length}`);

  // Auto-widen the lookback window if we have too few tournaments to compute
  // meaningful chunked-average deltas. Without this, sparse windows produce
  // identical Rising / Cooling lists with delta=0 across the board.
  for (const widerLookback of LOOKBACK_FALLBACK_STEPS) {
    if (tournaments.length >= MIN_TREND_TOURNAMENTS) {
      break;
    }
    console.log(
      `[trends] Only ${tournaments.length} tournament(s) in last ${lookbackDays}d; widening to ${widerLookback}d`
    );
    lookbackDays = widerLookback;
    since = new Date(windowEnd.getTime() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    tournaments = await fetchRecentOnlineTournaments(env, since, { maxPages: 20, windowEnd, fetchJson });
    console.log(`[trends] Tournaments after widening: ${tournaments.length}`);
  }

  if (!tournaments.length) {
    throw new Error('No tournaments found for trends window');
  }

  console.log('[trends] Gathering decks...');
  const diagnostics: DiagnosticsCollector = {};
  const decks = await gatherDecks(env, tournaments, diagnostics, cardTypesDb, { fetchJson });
  console.log(`[trends] Decks: ${decks.length}`);
  if (diagnostics?.archetypeClassification) {
    console.log('[trends] Archetype classification summary:', diagnostics.archetypeClassification);
  }
  if (!decks.length) {
    throw new Error('No decks gathered for trends');
  }

  // Drop tournaments that produced no decks to avoid zero-denominator timelines.
  const deckCountByTournament = new Map();
  for (const deck of decks) {
    const tid = deck?.tournamentId;
    if (!tid) continue;
    deckCountByTournament.set(tid, (deckCountByTournament.get(tid) || 0) + 1);
  }
  const tournamentsWithDecks = tournaments.filter(t => (deckCountByTournament.get(t.id) || 0) > 0);
  if (!tournamentsWithDecks.length) {
    throw new Error('All tournaments were empty after deck filtering');
  }
  if (tournamentsWithDecks.length !== tournaments.length) {
    console.log(`[trends] Dropped ${tournaments.length - tournamentsWithDecks.length} tournaments with no deck data`);
  }

  const rawTrendReport = buildTrendReport(decks, tournamentsWithDecks, {
    windowStart: since,
    windowEnd: now,
    now,
    minAppearances: 2
  });
  const {
    tournaments: trendTournaments = tournamentsWithDecks,
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
    windowStart: since,
    windowEnd: now,
    minAppearances: 2
  });

  const meta = {
    name: TRENDS_FOLDER,
    generatedAt: now.toISOString(),
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal: decks.length,
    tournamentCount: tournamentsWithDecks.length
  };

  const baseKey = `${TRENDS_FOLDER}`;
  console.log('[trends] Uploading meta, trends, decks, and tournaments...');
  await env.REPORTS.put(`${baseKey}/meta.json`, meta);
  await env.REPORTS.put(`${baseKey}/trends.json`, { trendReport, cardTrends });

  // Save raw decks for client-side performance filtering
  // Include only necessary fields to reduce payload size
  const decksForFiltering = decks.map(deck => ({
    tournamentId: deck.tournamentId,
    tournamentName: deck.tournamentName,
    tournamentDate: deck.tournamentDate,
    archetype: deck.archetype,
    successTags: deck.successTags || [],
    cards: deck.cards || []
  }));
  await env.REPORTS.put(`${baseKey}/decks.json`, decksForFiltering);

  // Save tournaments for client-side filtering
  const tournamentsForFiltering = tournamentsWithDecks.map(t => ({
    id: t.id,
    name: t.name,
    date: t.date,
    // NOTE: raw tournament summaries never carry deckTotal, so this has always
    // been 0 at runtime; kept as-is (types-only change) rather than switching
    // to deckCountByTournament.get(t.id).
    deckTotal: (t as { deckTotal?: number }).deckTotal || 0
  }));
  await env.REPORTS.put(`${baseKey}/tournaments.json`, tournamentsForFiltering);

  console.log('[trends] Done', {
    tournaments: tournamentsWithDecks.length,
    decks: decks.length,
    decksForFiltering: decksForFiltering.length,
    archetypeSeries: trendReport.series?.length || 0,
    cardRising: cardTrends.rising?.length || 0,
    cardFalling: cardTrends.falling?.length || 0
  });
}

main().catch(error => {
  console.error('[trends] Failed', error);
  process.exit(1);
});
