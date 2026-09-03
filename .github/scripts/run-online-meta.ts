#!/usr/bin/env node
/**
 * Online-meta producer: builds the "Online - Last 14 Days" report set on R2.
 *
 * This is orchestration around the shared builders: tournaments and decks come
 * from the one shared fetcher (shared/onlineMeta/tournamentFetcher, which
 * owns the field-size policy, the event floor, the exclusion config, and the
 * fetch-failure budgets), success tags from the frozen SUCCESS_TAG_POLICY,
 * card reports from shared/data/reports/cardReport, archetype grouping from
 * shared/data/archetypes/build, and the card-usage index from
 * shared/data/reports/cardUsage. Deck ids keep the old producer's 12-char
 * sha1 prefix so published artifacts stay stable.
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createR2Client, getJsonResult, putJson as putJsonR2 } from './lib/r2.mjs';
import type { CardTypesDatabase } from '../../shared/data/cardTypesDatabase.js';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';
import onlineExclusions from '../../config/online-exclusions.json';
import { generateArchetypeTrends, MIN_MATCHUP_GAMES } from '../../shared/data/analysis/archetypeTrends.js';
import { generateReportFromDecks, listedDeckCount } from '../../shared/data/reports/cardReport.js';
import { buildArchetypeReports } from '../../shared/data/archetypes/build.js';
import { onlineArchetypeOptions } from '../../shared/data/reports/onlineArtifacts.js';
import { buildCardUsageIndex } from '../../shared/data/reports/cardUsage.js';
import { buildCardSuccessIndex } from '../../shared/data/reports/cardSuccess.js';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.js';
import { fetchLimitlessJson } from '../../shared/api/limitless.js';
import {
  compileExclusions,
  DEFAULT_MIN_FIELD_PLAYERS,
  fetchRecentOnlineTournaments,
  gatherDecks,
  utcDayWindow
} from '../../shared/onlineMeta/index.js';
import type { DiagnosticsCollector, GatheredDeck, OnlineTournamentSummary } from '../../shared/onlineMeta/types.js';

const WINDOW_DAYS = 14;
const CACHE_REFRESH_LOOKBACK_DAYS = 30;
const TARGET_FOLDER = 'Online - Last 14 Days';
const MAX_PAGES = 15;
/**
 * Smallest field whose pairings feed the matchup matrix. Shares tolerate an
 * 8-player event; a win rate built from its three rounds does not.
 */
const MIN_MATCHUP_FIELD_PLAYERS = 16;
const DECK_ID_LENGTH = 12;
const ARCHETYPE_THUMBNAILS: Record<string, string[]> = archetypeThumbnails || {};

const missingEnv: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    missingEnv.push(name);
    return '';
  }
  return value;
}

function validateEnv(): void {
  if (missingEnv.length > 0) {
    const missing = missingEnv.splice(0);
    throw new Error(
      `Missing required environment variables:\n${missing.map(v => `  - ${v}`).join('\n')}\n\nPlease ensure all required variables are set before running this script.`
    );
  }
}

const LIMITLESS_API_KEY = env('LIMITLESS_API_KEY');
const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = env('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = env('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = env('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

// Feature flags - default to true if not specified
const GENERATE_MASTER = process.env.GENERATE_MASTER !== 'false';
const GENERATE_ARCHETYPES = process.env.GENERATE_ARCHETYPES !== 'false';
const GENERATE_DECKS = process.env.GENERATE_DECKS !== 'false';

const s3Client = createR2Client({
  accountId: R2_ACCOUNT_ID,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY
});

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

const CLEAN_MONTH_CACHE = parseBoolean(process.env.CLEAN_MONTH_CACHE, false);

// ============================================================================
// Limitless plumbing
// ============================================================================

const limitlessEnv = { LIMITLESS_API_KEY };

/** The shared client, with caches bypassed in clean-refresh mode. */
const fetchJson: typeof fetchLimitlessJson = (path, options = {}) => {
  if (!CLEAN_MONTH_CACHE) {
    return fetchLimitlessJson(path, options);
  }
  return fetchLimitlessJson(path, {
    ...options,
    fetchOptions: {
      ...options.fetchOptions,
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' }
    }
  });
};

type PairingData = import('../../shared/data/analysis/archetypeTrends.js').PairingData;

/**
 * Fetches pairings and standings for the tournaments whose fields are large
 * enough for a matchup record to mean anything.
 */
async function gatherPairingsData(
  tournaments: OnlineTournamentSummary[]
): Promise<{ pairingsData: PairingData[]; failures: Array<{ tournamentId: string; name: string; message: string }> }> {
  const pairingsData: PairingData[] = [];
  const failures: Array<{ tournamentId: string; name: string; message: string }> = [];

  console.log(`[online-meta] Fetching pairings data for ${tournaments.length} tournaments...`);

  for (const tournament of tournaments) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const [pairings, standings] = await Promise.all([
        fetchJson(`/tournaments/${tournament.id}/pairings`, { env: limitlessEnv }),
        fetchJson(`/tournaments/${tournament.id}/standings`, { env: limitlessEnv })
      ]);

      if (Array.isArray(pairings) && Array.isArray(standings)) {
        pairingsData.push({
          tournamentId: tournament.id,
          pairings: pairings as PairingData['pairings'],
          standings: standings as PairingData['standings']
        });
      }
    } catch (error) {
      console.warn(`[online-meta] Failed to fetch pairings for ${tournament.name}: ${(error as Error).message}`);
      failures.push({ tournamentId: tournament.id, name: tournament.name, message: (error as Error).message });
    }
  }

  console.log(`[online-meta] Gathered pairings data for ${pairingsData.length} tournaments`);
  return { pairingsData, failures };
}

// ============================================================================
// R2 IO
// ============================================================================

const REPORTS_CACHE_CONTROL = 'public, max-age=21600';

async function putJson(key: string, data: unknown): Promise<void> {
  await putJsonR2(s3Client, R2_BUCKET_NAME, key, data, { cacheControl: REPORTS_CACHE_CONTROL });
}

async function readJson<T = unknown>(key: string): Promise<T | null> {
  const result = await getJsonResult<T>(s3Client, R2_BUCKET_NAME, key);
  if (result.status === 'found') {
    return result.value;
  }
  if (result.status === 'missing') {
    return null;
  }
  throw result.error;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
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

async function deleteKeys(keys: string[]): Promise<number> {
  if (!Array.isArray(keys) || !keys.length) {
    return 0;
  }

  let deleted = 0;
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000);
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

async function deletePrefix(prefix: string): Promise<{ keys: number; deleted: number }> {
  const keys = await listKeys(prefix);
  const deleted = await deleteKeys(keys);
  return {
    keys: keys.length,
    deleted
  };
}

async function loadCardTypesDatabase(): Promise<CardTypesDatabase | null> {
  const key = 'assets/data/card-types.json';
  const data = await readJson<CardTypesDatabase>(key);
  if (data) {
    console.log(`[online-meta] Loaded card types database (${Object.keys(data).length} entries) from ${key}`);
    return data;
  }
  console.warn('[online-meta] Card types database not found; continuing without enrichment');
  return null;
}

async function loadCardSynonyms(): Promise<SynonymDatabase> {
  const key = 'assets/card-synonyms.json';
  const data = await readJson<SynonymDatabase>(key);
  if (data) {
    const count = Object.keys(data.synonyms || {}).length;
    console.log(`[online-meta] Loaded card synonyms (${count} entries) from ${key}`);
    return data;
  }
  console.warn('[online-meta] Card synonyms not found; continuing without canonicalization');
  return { synonyms: {}, canonicals: {} } as SynonymDatabase;
}

// ============================================================================
// Gathering
// ============================================================================

interface GatheredWindow {
  tournaments: OnlineTournamentSummary[];
  decks: GatheredDeck[];
  diagnostics: DiagnosticsCollector;
}

/**
 * Fetch and gather the report window. In clean-refresh mode a wider window is
 * fetched so the Limitless cache is repopulated, but the published report is
 * always the WINDOW_DAYS window — never silently widened while labelled
 * "Last 14 Days" (P-30). Tournaments that contributed no decks (below the
 * field floor, failed standings) are dropped so the report's tournament list
 * is exactly its deck population.
 */
async function gatherWindow(
  now: Date,
  cardTypesDb: CardTypesDatabase | null
): Promise<GatheredWindow & { fetchWindowDays: number }> {
  const reportWindow = utcDayWindow(now, WINDOW_DAYS);
  const fetchWindowDays = CLEAN_MONTH_CACHE ? Math.max(WINDOW_DAYS, CACHE_REFRESH_LOOKBACK_DAYS) : WINDOW_DAYS;
  const fetchWindow = utcDayWindow(now, fetchWindowDays);
  const diagnostics: DiagnosticsCollector = {};

  console.log(
    `[online-meta] Gathering tournaments ${fetchWindow.start.toISOString()} .. ${fetchWindow.end.toISOString()}`
  );
  const fetched = await fetchRecentOnlineTournaments(limitlessEnv, fetchWindow.start, {
    windowEnd: fetchWindow.lastInstant,
    maxPages: MAX_PAGES,
    diagnostics,
    exclusions: compileExclusions(onlineExclusions),
    fetchJson
  });
  console.log(
    `[online-meta] Found ${fetched.length} eligible tournaments (${diagnostics.excludedTournaments?.length || 0} excluded by config)`
  );

  const gathered = await gatherDecks(limitlessEnv, fetched, diagnostics, cardTypesDb, { fetchJson });
  if (!gathered.length) {
    throw new Error('No decklists gathered from online tournaments');
  }

  const reportStartMs = reportWindow.start.getTime();
  const inWindow = fetched.filter(tournament => {
    const dateMs = Date.parse(tournament.date);
    return Number.isFinite(dateMs) && dateMs >= reportStartMs;
  });
  if (!inWindow.length) {
    throw new Error(
      `No tournaments fall within the ${WINDOW_DAYS}-day report window ` +
        `(fetched ${fetched.length} over ${fetchWindowDays} days); ` +
        'refusing to publish a mislabelled report'
    );
  }

  const deckCounts = new Map<string, number>();
  for (const deck of gathered) {
    deckCounts.set(deck.tournamentId, (deckCounts.get(deck.tournamentId) || 0) + 1);
  }
  const tournaments = inWindow.filter(tournament => (deckCounts.get(tournament.id) || 0) > 0);
  const tournamentIds = new Set(tournaments.map(tournament => tournament.id));
  const decks = gathered
    .filter(deck => tournamentIds.has(deck.tournamentId))
    .map(deck => ({ ...deck, id: deck.id.slice(0, DECK_ID_LENGTH) }));
  if (!decks.length) {
    throw new Error('No decklists remained after report-window filtering');
  }

  return { tournaments, decks, diagnostics, fetchWindowDays };
}

function buildMeta(
  now: Date,
  window: GatheredWindow,
  fetchWindowDays: number,
  archetypes: { minDecks: number; pairingsFailures: Array<{ tournamentId: string; name: string; message: string }> }
): Record<string, unknown> {
  const reportWindow = utcDayWindow(now, WINDOW_DAYS);
  const { diagnostics } = window;
  const fields = diagnostics.tournamentFields || {};
  return {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: reportWindow.start.toISOString(),
    windowEnd: reportWindow.end.toISOString(),
    deckTotal: window.decks.length,
    tournamentCount: window.tournaments.length,
    archetypeMinPercent: 0.5,
    archetypeMinDecks: archetypes.minDecks,
    refreshMode: CLEAN_MONTH_CACHE,
    refreshLookbackDays: fetchWindowDays,
    // What the numbers were computed against, so a reader never has to guess.
    fieldPolicy: {
      population: 'players with a placing',
      minFieldPlayers: DEFAULT_MIN_FIELD_PLAYERS,
      minMatchupFieldPlayers: MIN_MATCHUP_FIELD_PLAYERS,
      minMatchupGames: MIN_MATCHUP_GAMES
    },
    unplacedEntries: diagnostics.entriesWithoutPlacing?.length || 0,
    excluded: diagnostics.excludedTournaments || [],
    skipped: {
      belowMinimum: diagnostics.tournamentsBelowMinimum || [],
      standingsFailures: diagnostics.standingsFetchFailures || [],
      detailsFailures: diagnostics.detailsFetchFailures || [],
      pairingsFailures: archetypes.pairingsFailures
    },
    tournaments: window.tournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      // `players` is the field the report was computed against; `registered`
      // is what Limitless lists, late registrations and no-shows included.
      players: fields[t.id]?.fieldSize ?? t.players,
      registered: fields[t.id]?.registered ?? t.players,
      format: t.format,
      platform: t.platform,
      organizer: t.organizer
    }))
  };
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
  const now = new Date();
  const basePath = `${R2_REPORTS_PREFIX}/${TARGET_FOLDER}`;

  // NOTE: In CLEAN_MONTH_CACHE mode the existing artifacts are deleted only
  // AFTER a complete, validated report is in hand (see below), so a fetch outage
  // or an empty report window can no longer wipe production (P-03).

  const cardTypesDb = await loadCardTypesDatabase();
  const synonymDb = await loadCardSynonyms();
  const window = await gatherWindow(now, cardTypesDb);
  const { tournaments: reportTournaments, decks: reportDecks, diagnostics } = window;
  console.log('[online-meta] Archetype classification summary:', diagnostics.archetypeClassification);

  // Gather pairings data for matchup analysis, from fields large enough to
  // carry a matchup record.
  const fields = diagnostics.tournamentFields || {};
  const matchupTournaments = reportTournaments.filter(
    tournament => (fields[tournament.id]?.fieldSize || 0) >= MIN_MATCHUP_FIELD_PLAYERS
  );
  const { pairingsData, failures: pairingsFailures } = await gatherPairingsData(matchupTournaments);

  console.log(`[online-meta] Aggregating ${reportDecks.length} decks`);
  // Decklist-less standings entries stay in the deck list — they're real decks
  // in the meta and carry an archetype — but they can't contribute a card, so
  // card inclusion divides by the listed decks only (D13).
  const masterReport = generateReportFromDecks(
    reportDecks as unknown as Parameters<typeof generateReportFromDecks>[0],
    listedDeckCount(reportDecks as unknown as Parameters<typeof listedDeckCount>[0]),
    synonymDb
  );
  // The frozen 'preserve' online profile: case-preserving group keys (D3
  // quirk), 0.5% deck floor, fraction percent, deckCount-desc ordering,
  // thumbnails + signature cards on index entries. The "Other" bucket stays in
  // the denominator but gets no page.
  const {
    files: archetypeFiles,
    index: archetypeIndex,
    minDecks,
    decksByBase
  } = buildArchetypeReports(
    reportDecks as unknown as Parameters<typeof buildArchetypeReports>[0],
    synonymDb,
    onlineArchetypeOptions(ARCHETYPE_THUMBNAILS, cardTypesDb, masterReport)
  );

  const meta = buildMeta(now, window, window.fetchWindowDays, { minDecks, pairingsFailures });

  // Pre-generate every archetype's trends BEFORE any destructive step. Trend
  // generation is pure/in-memory, so a failure here signals a real bug — surface
  // it now, while the previous report is still intact, rather than publishing
  // new decks alongside stale (or missing) trends (P-31).
  const trendsByBase = new Map<string, unknown>();
  if (GENERATE_ARCHETYPES) {
    const trendFailures: string[] = [];
    for (const file of archetypeFiles) {
      const archetypeDecks = decksByBase.get(file.base);
      if (!archetypeDecks) {
        continue;
      }
      try {
        const archetypeName = file.displayName || file.base.replace(/_/g, ' ');
        const trends = generateArchetypeTrends(
          archetypeDecks as unknown as Parameters<typeof generateArchetypeTrends>[0],
          reportTournaments,
          synonymDb,
          {
            pairingsData,
            archetypeName
          }
        );
        trendsByBase.set(file.base, trends);
      } catch (err) {
        trendFailures.push(`${file.base}: ${(err as Error)?.message || err}`);
      }
    }
    if (trendFailures.length) {
      throw new Error(`Trend generation failed for ${trendFailures.length} archetype(s): ${trendFailures.join('; ')}`);
    }
  }

  // Per-card finish rates, computed with the trends above and for the same
  // reason (P-31): it is pure, in-memory work, so a bug here must surface while
  // the previous report is still whole rather than between two uploads.
  const cardSuccess = buildCardSuccessIndex(
    reportDecks as unknown as Parameters<typeof buildCardSuccessIndex>[0],
    synonymDb
  );

  // Everything needed for a complete report is now in hand. In clean mode it is
  // finally safe to clear the old artifacts (P-03): a fetch outage, empty window,
  // or trend bug above already aborted without touching production.
  if (CLEAN_MONTH_CACHE) {
    console.log(`[online-meta] CLEAN_MONTH_CACHE=true: deleting existing ${basePath} artifacts before rebuild...`);
    const deleted = await deletePrefix(`${basePath}/`);
    console.log(`[online-meta] Deleted ${deleted.deleted}/${deleted.keys} objects from ${basePath}/`);
  }

  // Conditionally upload based on feature flags. meta.json — the pointer the UI
  // reads first — is written LAST so a partial upload never advertises a report
  // whose bodies are missing (P-03).
  if (GENERATE_MASTER) {
    console.log('[online-meta] Uploading master.json...');
    await putJson(`${basePath}/master.json`, masterReport);
    // Finish rates ride with master: same population, same canonical keys, and
    // the only other place this window's placements survive is the 36 MB
    // decks.json that no browser should be asked to download.
    if (cardSuccess) {
      console.log(
        `[online-meta] Uploading cardSuccess.json (${cardSuccess.successTotal}/${cardSuccess.deckTotal} decks ${cardSuccess.tag})...`
      );
      await putJson(`${basePath}/cardSuccess.json`, cardSuccess);
    } else {
      console.log('[online-meta] Skipping cardSuccess.json (no deck met the field-size floor)');
    }
  } else {
    console.log('[online-meta] Skipping master.json (GENERATE_MASTER=false)');
  }

  if (GENERATE_DECKS) {
    console.log('[online-meta] Uploading decks.json...');
    await putJson(`${basePath}/decks.json`, reportDecks);
  } else {
    console.log('[online-meta] Skipping decks.json (GENERATE_DECKS=false)');
  }

  if (GENERATE_ARCHETYPES) {
    console.log('[online-meta] Uploading archetype reports (new folder structure)...');
    await putJson(`${basePath}/archetypes/index.json`, archetypeIndex);
    await putJson(`${basePath}/cardUsage.json`, buildCardUsageIndex(archetypeFiles));

    for (const file of archetypeFiles) {
      // Upload cards.json for each archetype (e.g., archetypes/Gardevoir/cards.json)
      // eslint-disable-next-line no-await-in-loop
      await putJson(`${basePath}/archetypes/${file.base}/cards.json`, file.data);

      // Upload decks.json for each archetype (e.g., archetypes/Gardevoir/decks.json)
      const archetypeDecks = decksByBase.get(file.base);
      if (archetypeDecks) {
        // eslint-disable-next-line no-await-in-loop
        await putJson(`${basePath}/archetypes/${file.base}/decks.json`, archetypeDecks);

        // Upload the trends.json pre-generated above.
        const trends = trendsByBase.get(file.base);
        if (trends) {
          // eslint-disable-next-line no-await-in-loop
          await putJson(`${basePath}/archetypes/${file.base}/trends.json`, trends);
        }
      }
    }

    // Also upload legacy flat files for backward compatibility during migration
    // These can be removed in the future after all consumers are updated
    console.log('[online-meta] Uploading legacy archetype files for backward compatibility...');
    for (const file of archetypeFiles) {
      // eslint-disable-next-line no-await-in-loop
      await putJson(`${basePath}/archetypes/${file.base}.json`, file.data);
    }
  } else {
    console.log('[online-meta] Skipping archetype reports (GENERATE_ARCHETYPES=false)');
  }

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  // meta.json is the pointer the UI loads first — write it LAST so a partial
  // upload never advertises a report whose bodies are missing (P-03).
  console.log('[online-meta] Uploading meta.json (pointer, written last)...');
  await putJson(`${basePath}/meta.json`, meta);

  const uploadedComponents: string[] = [];
  if (GENERATE_MASTER) {
    uploadedComponents.push('master');
  }
  if (GENERATE_ARCHETYPES) {
    uploadedComponents.push(`${archetypeFiles.length} archetypes`);
  }
  if (GENERATE_DECKS) {
    uploadedComponents.push('decks');
  }

  console.log(`[online-meta] Uploaded ${uploadedComponents.join(' + ')} to ${R2_BUCKET_NAME}/${basePath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  validateEnv();
  main().catch(error => {
    console.error('[online-meta] Failed:', error);
    process.exit(1);
  });
}
