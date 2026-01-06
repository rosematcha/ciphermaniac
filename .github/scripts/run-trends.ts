#!/usr/bin/env node

/**
 * Trends-only builder for the past month of online tournaments.
 * Keeps the legacy online-meta job untouched. Outputs:
 *   reports/Trends - Last 30 Days/trends.json
 *   reports/Trends - Last 30 Days/meta.json
 */

import process from 'node:process';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  fetchRecentOnlineTournaments,
  gatherDecks,
  buildTrendReport,
  buildCardTrendReport
} from '../../functions/lib/onlineMeta.ts';
import { loadCardTypesDatabase } from '../../functions/lib/cardTypesDatabase.js';

const TRENDS_FOLDER = 'Trends - Last 30 Days';
const LOOKBACK_DAYS = 30;
const MAX_ARCHETYPES_IN_SERIES = 32;

function requireEnv(name) {
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

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

class R2Binding {
  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/+$/, '');
  }

  withPrefix(key) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key, data) {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: this.withPrefix(key),
        Body: body,
        ContentType: 'application/json'
      })
    );
  }

  async get(key) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: this.withPrefix(key)
        })
      );
      return {
        async text() {
          const chunks = [];
          for await (const chunk of response.Body) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks).toString('utf-8');
        }
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

function trimTrendSeries(series = [], limit = MAX_ARCHETYPES_IN_SERIES) {
  const max = Math.max(0, Number(limit) || 0);
  if (!Array.isArray(series) || !series.length || max === 0) {
    return [];
  }

  return series.slice(0, max);
}

async function main() {
  const windowEnd = new Date();
  const since = new Date(windowEnd.getTime() - (LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000);
  const now = windowEnd;

  const env = {
    REPORTS: new R2Binding(R2_REPORTS_PREFIX),
    LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY')
  };

  console.log(`[trends] Loading card types database...`);
  const cardTypesDb = await loadCardTypesDatabase(env);
  console.log(`[trends] Card DB entries: ${Object.keys(cardTypesDb || {}).length}`);

  console.log(`[trends] Fetching tournaments since ${since.toISOString()}`);
  const tournaments = await fetchRecentOnlineTournaments(env, since, { maxPages: 20, windowEnd });
  console.log(`[trends] Tournaments: ${tournaments.length}`);
  if (!tournaments.length) {
    throw new Error('No tournaments found for trends window');
  }

  console.log('[trends] Gathering decks...');
  const decks = await gatherDecks(env, tournaments, {}, cardTypesDb, {});
  console.log(`[trends] Decks: ${decks.length}`);
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
    deckTotal: t.deckTotal || 0
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
