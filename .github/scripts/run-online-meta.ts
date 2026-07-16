#!/usr/bin/env node
/**
 * Online-meta producer: builds the "Online - Last 14 Days" report set on R2.
 *
 * This is orchestration around the shared builders (DB-MASTER-PLAN Phase 2
 * cutover of the old run-online-meta.mjs): success tags come from the frozen
 * SUCCESS_TAG_POLICY (computeSuccessTags), card reports from
 * shared/data/reports/cardReport, archetype grouping/presentation from
 * shared/data/archetypes/build, and the card-usage index from
 * shared/data/reports/cardUsage. The Limitless fetch/gather plumbing keeps the
 * old producer's exact behavior (serial fetches, key-in-query auth, sha1
 * deck ids truncated to 12 chars) so published artifacts stay stable.
 */

import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createR2Client, getJsonResult, putJson as putJsonR2 } from './lib/r2.mjs';
import { type CardTypesDatabase, enrichCardWithType } from '../../shared/data/cardTypesDatabase.js';
import {
  buildArchetypeDeckIndex,
  type DeckIndex,
  resolveArchetypeClassification
} from '../../shared/analysis/archetypeClassifier.js';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';
import { generateArchetypeTrends } from '../../shared/data/analysis/archetypeTrends.js';
import { computeSuccessTags } from '../../shared/data/contracts.js';
import { generateReportFromDecks } from '../../shared/data/reports/cardReport.js';
import { buildArchetypeReports } from '../../shared/data/archetypes/build.js';
import { buildCardUsageIndex } from '../../shared/data/reports/cardUsage.js';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.js';

const LIMITLESS_API_BASE = 'https://play.limitlesstcg.com/api';
const WINDOW_DAYS = 14;
const CACHE_REFRESH_LOOKBACK_DAYS = 30;
const TARGET_FOLDER = 'Online - Last 14 Days';
const PAGE_SIZE = 100;
const MAX_PAGES = 15;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
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

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

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
// Limitless fetch plumbing (behavior preserved from the .mjs producer)
// ============================================================================

interface TournamentSummary {
  id: string;
  name: string;
  date: string;
  format: string;
  platform: string | null;
  game: string;
  players: number | null;
  organizer: string | null;
}

interface StandingsEntry {
  name?: string;
  player?: string;
  country?: string | null;
  placing?: number;
  deck?: { id?: string | null; name?: string | null };
  decklist?: Record<string, Array<{ name?: string; [key: string]: unknown }>>;
}

interface GatheredDeck {
  id: string;
  player: string;
  playerId: string | null;
  country: string | null;
  placement: number | null;
  archetype: string;
  archetypeId: string | null;
  archetypeSource: string;
  cards: CardEntry[];
  hasDecklist: boolean;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentFormat: string;
  tournamentPlatform: string | null;
  tournamentOrganizer: string | null;
  tournamentPlayers: number;
  successTags: string[];
}

interface CardEntry {
  count: number;
  name: string;
  set: string | null;
  number: string | null;
  category: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

function buildLimitlessUrl(path: string, params: Record<string, string | number | undefined> = {}): URL {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const base = LIMITLESS_API_BASE.endsWith('/') ? LIMITLESS_API_BASE : `${LIMITLESS_API_BASE}/`;
  const url = new URL(normalizedPath, base);
  url.searchParams.set('key', LIMITLESS_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url;
}

async function fetchLimitless<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = buildLimitlessUrl(path, params);
  const headers: Record<string, string> = {
    'X-Access-Key': LIMITLESS_API_KEY,
    Accept: 'application/json'
  };
  if (CLEAN_MONTH_CACHE) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    headers.Pragma = 'no-cache';
  }
  const response = await fetch(url, {
    headers,
    cache: CLEAN_MONTH_CACHE ? 'no-store' : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Limitless request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Unexpected response type (${contentType}): ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

async function fetchRecentOnlineTournaments(since: Date): Promise<TournamentSummary[]> {
  const sinceMs = since.getTime();
  const found: TournamentSummary[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const list = await fetchLimitless<
      Array<{ id: string; name: string; date: string; format?: string; game: string; players?: number }>
    >('/tournaments', {
      game: 'PTCG',
      limit: PAGE_SIZE,
      page
    });

    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of list) {
      const dateMs = Date.parse(entry?.date);
      if (!Number.isFinite(dateMs) || dateMs < sinceMs) {
        sawOlder = true;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const details = await fetchLimitless<{
        decklists?: boolean;
        isOnline?: boolean;
        format?: string;
        platform?: string;
        players?: number;
        organizer?: { name?: string };
      }>(`/tournaments/${entry.id}/details`);
      if (details.decklists === false) {
        continue;
      }
      if (details.isOnline === false) {
        continue;
      }
      const formatId = (details.format || entry.format || '').toUpperCase();
      if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
        continue;
      }

      found.push({
        id: entry.id,
        name: entry.name,
        date: entry.date,
        format: formatId || 'UNKNOWN',
        platform: details.platform || null,
        game: entry.game,
        players: details.players || entry.players || null,
        organizer: details.organizer?.name || null
      });
    }

    if (sawOlder) {
      break;
    }
  }

  return found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function determinePlacementLimit(players: number | null): number {
  const count = Number(players) || 0;
  if (count > 0 && count <= 3) {
    return 0;
  }
  // Use full standings so archetype shares represent what was actually played.
  return Number.POSITIVE_INFINITY;
}

function toCardEntries(decklist: unknown, cardTypesDb: CardTypesDatabase | null): CardEntry[] {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const cards: CardEntry[] = [];
  for (const [section, entries] of Object.entries(decklist)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const card of entries as Array<{ count?: number; name?: string; set?: string; number?: string }>) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const sectionLower = section.toLowerCase();
      let category = 'trainer';
      if (sectionLower === 'pokemon') {
        category = 'pokemon';
      } else if (sectionLower === 'energy') {
        category = 'energy';
      }
      let entry: CardEntry = {
        count,
        name: card?.name || 'Unknown Card',
        set: card?.set || null,
        number: card?.number || null,
        category
      };

      if (cardTypesDb && entry.set && entry.number) {
        entry = enrichCardWithType(entry, cardTypesDb);
      }

      cards.push(entry);
    }
  }
  return cards;
}

type PairingData = import('../../shared/data/analysis/archetypeTrends.js').PairingData;

/**
 * Fetches pairings and standings for all tournaments for matchup analysis.
 */
async function gatherPairingsData(tournaments: TournamentSummary[]): Promise<PairingData[]> {
  const pairingsData: PairingData[] = [];

  console.log(`[online-meta] Fetching pairings data for ${tournaments.length} tournaments...`);

  for (const tournament of tournaments) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const [pairings, standings] = await Promise.all([
        fetchLimitless<PairingData['pairings']>(`/tournaments/${tournament.id}/pairings`),
        fetchLimitless<PairingData['standings']>(`/tournaments/${tournament.id}/standings`)
      ]);

      if (pairings && standings) {
        pairingsData.push({
          tournamentId: tournament.id,
          pairings,
          standings
        });
      }
    } catch (error) {
      console.warn(`[online-meta] Failed to fetch pairings for ${tournament.name}: ${(error as Error).message}`);
      // Continue with other tournaments
    }
  }

  console.log(`[online-meta] Gathered pairings data for ${pairingsData.length} tournaments`);
  return pairingsData;
}

async function gatherDecks(
  tournaments: TournamentSummary[],
  cardTypesDb: CardTypesDatabase | null
): Promise<GatheredDeck[]> {
  let deckIndex: DeckIndex | null = null;
  try {
    const deckRulesPayload = await fetchLimitless('/games/PTCG/decks');
    deckIndex = buildArchetypeDeckIndex(deckRulesPayload);
    console.log(`[online-meta] Loaded ${deckIndex?.ruleCount || 0} archetype deck rules`);
  } catch (error) {
    console.warn(
      `[online-meta] Failed to fetch deck rules for archetype classification: ${(error as Error)?.message || error}`
    );
  }

  const decks: GatheredDeck[] = [];

  for (const tournament of tournaments) {
    const limit = determinePlacementLimit(tournament.players);
    if (!limit) {
      continue;
    }

    let standings: StandingsEntry[];
    try {
      // eslint-disable-next-line no-await-in-loop
      standings = await fetchLimitless<StandingsEntry[]>(`/tournaments/${tournament.id}/standings`);
    } catch (error) {
      console.warn(`Failed to fetch standings for ${tournament.name}: ${(error as Error).message}`);
      continue;
    }

    const sorted = [...standings].sort((a, b) => {
      const placingA = Number.isFinite(a?.placing) ? Number(a.placing) : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(b?.placing) ? Number(b.placing) : Number.POSITIVE_INFINITY;
      return placingA - placingB;
    });

    // Derive tournament size when Limitless doesn't provide it
    const maxReportedPlacing = Number.isFinite(sorted.at(-1)?.placing) ? Number(sorted.at(-1)?.placing) : 0;
    const derivedPlayers = Number(tournament?.players) || Math.max(sorted.length, maxReportedPlacing);

    const topEntries = sorted.slice(0, limit);
    for (const entry of topEntries) {
      const classification = resolveArchetypeClassification(
        {
          deckName: entry?.deck?.name,
          deckId: entry?.deck?.id,
          decklist: entry?.decklist
        },
        deckIndex
      );

      const cards = toCardEntries(entry?.decklist, cardTypesDb);
      if (!cards.length) {
        const hasDeckDescriptor = Boolean(entry?.deck?.name || entry?.deck?.id);
        if (!hasDeckDescriptor) {
          continue;
        }
      }

      const fallbackIdentity = `${tournament.id}::${entry?.player || entry?.name || ''}::${entry?.placing ?? ''}::${classification?.id || entry?.deck?.id || classification?.name || entry?.deck?.name || ''}`;
      const hashSource =
        cards.length > 0
          ? cards
              .map(card => `${card.count}x${card.name}::${card.set || ''}::${card.number || ''}`)
              .sort()
              .join('|')
          : fallbackIdentity;

      const hash = crypto
        .createHash('sha1')
        .update(hashSource || 'unknown-deck')
        .digest('hex');

      decks.push({
        id: hash.slice(0, 12),
        player: entry?.name || entry?.player || 'Unknown Player',
        playerId: entry?.player || null,
        country: entry?.country || null,
        placement: entry?.placing ?? null,
        archetype: classification?.name || entry?.deck?.name || 'Unknown',
        archetypeId: classification?.id || entry?.deck?.id || null,
        archetypeSource: classification?.source || 'unknown',
        cards,
        hasDecklist: cards.length > 0,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        tournamentDate: tournament.date,
        tournamentFormat: tournament.format,
        tournamentPlatform: tournament.platform,
        tournamentOrganizer: tournament.organizer,
        tournamentPlayers: derivedPlayers,
        // Online windows never carry Day-2 phases, so phase tags are not
        // appended (appendPhaseTags defaults false).
        successTags: computeSuccessTags(entry?.placing, derivedPlayers)
      });
    }
  }

  return decks;
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
// Main Function
// ============================================================================

async function main(): Promise<void> {
  const now = new Date();
  const reportWindowStart = daysAgo(WINDOW_DAYS);
  const fetchWindowDays = CLEAN_MONTH_CACHE ? Math.max(WINDOW_DAYS, CACHE_REFRESH_LOOKBACK_DAYS) : WINDOW_DAYS;
  const fetchWindowStart = daysAgo(fetchWindowDays);
  const basePath = `${R2_REPORTS_PREFIX}/${TARGET_FOLDER}`;

  // NOTE: In CLEAN_MONTH_CACHE mode the existing artifacts are deleted only
  // AFTER a complete, validated report is in hand (see below), so a fetch outage
  // or an empty report window can no longer wipe production (P-03).

  console.log(`[online-meta] Gathering tournaments since ${fetchWindowStart.toISOString()}`);
  const tournaments = await fetchRecentOnlineTournaments(fetchWindowStart);
  console.log(`[online-meta] Found ${tournaments.length} eligible tournaments`);

  const cardTypesDb = await loadCardTypesDatabase();
  const synonymDb = await loadCardSynonyms();
  const decks = await gatherDecks(tournaments, cardTypesDb);
  if (!decks.length) {
    throw new Error('No decklists gathered from online tournaments');
  }

  // The published report always describes the WINDOW_DAYS window. When a clean
  // rebuild fetches a wider window (CACHE_REFRESH_LOOKBACK_DAYS), keep only the
  // tournaments that actually fall inside the report window — never silently
  // widen the report to older events while labelling it "Last 14 Days" (P-30).
  const reportWindowStartMs = reportWindowStart.getTime();
  const reportTournaments = tournaments.filter(tournament => {
    const dateMs = Date.parse(tournament?.date);
    return Number.isFinite(dateMs) && dateMs >= reportWindowStartMs;
  });
  if (!reportTournaments.length) {
    throw new Error(
      `No tournaments fall within the ${WINDOW_DAYS}-day report window ` +
        `(fetched ${tournaments.length} over ${fetchWindowDays} days); ` +
        'refusing to publish a mislabelled report'
    );
  }
  const reportTournamentIds = new Set(reportTournaments.map(tournament => tournament.id));
  const reportDecks = decks.filter(deck => reportTournamentIds.has(deck?.tournamentId));
  if (!reportDecks.length) {
    throw new Error('No decklists remained after report-window filtering');
  }

  // Gather pairings data for matchup analysis
  const pairingsData = await gatherPairingsData(reportTournaments);

  console.log(`[online-meta] Aggregating ${reportDecks.length} decks`);
  const masterReport = generateReportFromDecks(reportDecks as unknown as Parameters<typeof generateReportFromDecks>[0], reportDecks.length, synonymDb);
  // The 'preserve' online profile: case-preserving group keys (D3 quirk),
  // 0.5% deck floor, fraction percent, deckCount-desc ordering, thumbnails +
  // signature cards on index entries — pinned byte-identical to the old .mjs
  // builder by tests/data/archetype-presentation-parity.test.ts before cutover.
  const {
    files: archetypeFiles,
    index: archetypeIndex,
    minDecks,
    decksByBase
  } = buildArchetypeReports(reportDecks as unknown as Parameters<typeof buildArchetypeReports>[0], synonymDb, {
    nameCasing: 'preserve',
    minDecksFraction: 0.005,
    percentMode: 'fraction',
    sortMode: 'deckCount',
    thumbnailConfig: ARCHETYPE_THUMBNAILS,
    cardTypesDb,
    masterReport,
    includeSignatureCards: true
  });

  const meta = {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: reportWindowStart.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal: reportDecks.length,
    tournamentCount: reportTournaments.length,
    archetypeMinPercent: 0.5,
    archetypeMinDecks: minDecks,
    refreshMode: CLEAN_MONTH_CACHE,
    refreshLookbackDays: fetchWindowDays,
    tournaments: reportTournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      players: t.players,
      format: t.format,
      platform: t.platform,
      organizer: t.organizer
    }))
  };

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
        const trends = generateArchetypeTrends(archetypeDecks as unknown as Parameters<typeof generateArchetypeTrends>[0], reportTournaments, synonymDb, {
          pairingsData,
          archetypeName
        });
        trendsByBase.set(file.base, trends);
      } catch (err) {
        trendFailures.push(`${file.base}: ${(err as Error)?.message || err}`);
      }
    }
    if (trendFailures.length) {
      throw new Error(`Trend generation failed for ${trendFailures.length} archetype(s): ${trendFailures.join('; ')}`);
    }
  }

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
