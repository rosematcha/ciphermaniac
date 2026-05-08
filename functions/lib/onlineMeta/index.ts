import { generateReportFromDecks } from '../reportBuilder.js';
import { enrichAllDecks, loadCardTypesDatabase } from '../cardTypesDatabase.js';
import { enrichDecksWithOnTheFlyFetch, refreshRegulationMarks } from '../cardTypeFetcher.js';
import { loadCardSynonyms } from '../cardSynonyms.js';
import { buildTournamentDatabase } from '../sqliteBuilder.js';
import { daysAgo, fetchRecentOnlineTournaments, gatherDecks } from './tournamentFetcher';
import { ARCHETYPE_THUMBNAILS, buildArchetypeReports } from './reportGenerator';
import { buildCardTrendReport, buildTrendReport } from './archetypeBuilder';
import { batchPutJson, putBinary } from './storageWriter';
import type { OnlineMetaJobOptions } from './types';

const WINDOW_DAYS = 30;
const MIN_USAGE_PERCENT = 0.5;
const TARGET_FOLDER = 'Online - Last 14 Days';
const REPORT_BASE_KEY = `reports/${TARGET_FOLDER}`;
const DEFAULT_R2_CONCURRENCY = 6;

export async function runOnlineMetaJob(env, options: OnlineMetaJobOptions = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const since = options.since ? new Date(options.since) : daysAgo(WINDOW_DAYS);

  const diagnostics = {
    detailsWithoutDecklists: [],
    detailsOffline: [],
    detailsUnsupportedFormat: [],
    standingsFetchFailures: [],
    invalidStandingsPayload: [],
    entriesWithoutDecklists: [],
    entriesWithoutPlacing: [],
    tournamentsBelowMinimum: []
  };

  // Load card types database for enrichment
  console.info('[OnlineMeta] Loading card types database...');
  const cardTypesDb = await loadCardTypesDatabase(env);
  const dbCardCount = Object.keys(cardTypesDb).length;
  console.info(`[OnlineMeta] Loaded ${dbCardCount} cards from types database`);

  // Load card synonyms for canonicalization
  console.info('[OnlineMeta] Loading card synonyms...');
  const synonymDb = await loadCardSynonyms(env);
  const synonymCount = Object.keys(synonymDb.synonyms || {}).length;
  console.info(`[OnlineMeta] Loaded ${synonymCount} synonyms`);

  const tournaments = await fetchRecentOnlineTournaments(env, since, {
    diagnostics,
    fetchJson: options.fetchJson,
    pageSize: options.pageSize,
    maxPages: options.maxPages,
    detailsConcurrency: options.detailsConcurrency
  });
  if (!tournaments.length) {
    return {
      success: false,
      reason: 'No online tournaments found within the lookback window',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  const decks = await gatherDecks(env, tournaments, diagnostics, cardTypesDb, {
    fetchJson: options.fetchJson,
    standingsConcurrency: options.standingsConcurrency
  });
  if (!decks.length) {
    console.error('[OnlineMeta] No decklists aggregated', diagnostics);
    return {
      success: false,
      reason: 'No decklists available for online tournaments',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  // Fetch missing card types on-the-fly and update database
  console.info('[OnlineMeta] Checking for missing card types...');
  await enrichDecksWithOnTheFlyFetch(decks, cardTypesDb, env);
  console.info('[OnlineMeta] Card type enrichment complete');

  // Refresh regulation marks for cards that are missing them
  console.info('[OnlineMeta] Refreshing regulation marks...');
  // Extract unique cards from all decks for regulation mark refresh
  const uniqueCardsMap = new Map<string, { set: string; number: string }>();
  for (const deck of decks) {
    for (const card of Array.isArray(deck?.cards) ? deck.cards : []) {
      if (card?.set && card?.number) {
        const key = `${card.set}::${card.number}`;
        if (!uniqueCardsMap.has(key)) {
          uniqueCardsMap.set(key, { set: card.set, number: card.number });
        }
      }
    }
  }
  await refreshRegulationMarks(Array.from(uniqueCardsMap.values()), cardTypesDb, env);

  // Re-enrich deck cards with updated regulation marks from database
  const enrichedDecks = enrichAllDecks(decks, cardTypesDb);

  const deckTotal = enrichedDecks.length;
  const masterReport = generateReportFromDecks(enrichedDecks, deckTotal, enrichedDecks, synonymDb);
  const { archetypeFiles, archetypeIndex, minDecks } = buildArchetypeReports(
    enrichedDecks,
    MIN_USAGE_PERCENT,
    synonymDb,
    {
      thumbnailConfig: ARCHETYPE_THUMBNAILS
    }
  );
  const trendSeriesLimit = Number.isFinite(options.seriesLimit) ? Number(options.seriesLimit) : 32;
  const trendReport = buildTrendReport(enrichedDecks, tournaments, {
    windowStart: since,
    windowEnd: now,
    now,
    minAppearances: options.minTrendAppearances,
    seriesLimit: trendSeriesLimit
  });
  const trendTournaments =
    Array.isArray(trendReport?.tournaments) && trendReport.tournaments.length ? trendReport.tournaments : tournaments;
  const cardTrends = buildCardTrendReport(enrichedDecks, trendTournaments, {
    windowStart: since,
    windowEnd: now
  });
  trendReport.cardTrends = cardTrends;

  const meta = {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal,
    tournamentCount: tournaments.length,
    archetypeMinPercent: MIN_USAGE_PERCENT,
    archetypeMinDecks: minDecks,
    tournaments: tournaments.map(tournament => ({
      id: tournament.id,
      name: tournament.name,
      date: tournament.date,
      format: tournament.format,
      platform: tournament.platform,
      players: tournament.players,
      organizer: tournament.organizer
    }))
  };

  const r2Concurrency = Math.max(1, options.r2Concurrency || DEFAULT_R2_CONCURRENCY);
  const baseWrites = [
    { key: `${REPORT_BASE_KEY}/master.json`, data: masterReport },
    { key: `${REPORT_BASE_KEY}/meta.json`, data: meta },
    { key: `${REPORT_BASE_KEY}/decks.json`, data: decks },
    { key: `${REPORT_BASE_KEY}/trends.json`, data: trendReport },
    { key: `${REPORT_BASE_KEY}/archetypes/index.json`, data: archetypeIndex }
  ];
  const archetypeWrites = archetypeFiles.map(file => ({
    key: `${REPORT_BASE_KEY}/archetypes/${file.filename}`,
    data: file.data
  }));
  await batchPutJson(env, [...baseWrites, ...archetypeWrites], r2Concurrency);

  console.info('[OnlineMeta] Building SQLite database...');
  try {
    const sqliteData = await buildTournamentDatabase(decks, {
      tournamentId: TARGET_FOLDER,
      generatedAt: new Date().toISOString()
    });
    await putBinary(env, `${REPORT_BASE_KEY}/tournament.db`, sqliteData, 'application/x-sqlite3');
    console.info('[OnlineMeta] SQLite database uploaded', { size: sqliteData.length });
  } catch (sqliteError) {
    console.error('[OnlineMeta] SQLite generation failed, falling back to JSON only:', sqliteError);
  }

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  console.info('[OnlineMeta] Aggregated online tournaments', {
    deckTotal,
    tournamentCount: tournaments.length,
    archetypes: archetypeFiles.length,
    trendArchetypes: trendReport.archetypeCount
  });

  return {
    success: true,
    decks: deckTotal,
    tournaments: tournaments.length,
    archetypes: archetypeFiles.length,
    trendArchetypes: trendReport.archetypeCount,
    folder: TARGET_FOLDER,
    diagnostics
  };
}

// Re-export everything for backwards compatibility
export { fetchRecentOnlineTournaments, gatherDecks } from './tournamentFetcher';
export { buildArchetypeReports } from './reportGenerator';
export { buildTrendReport, buildCardTrendReport } from './archetypeBuilder';
