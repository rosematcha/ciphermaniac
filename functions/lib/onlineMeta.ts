import { fetchLimitlessJson } from './limitless.js';
import { generateReportFromDecks, normalizeArchetypeName, sanitizeForFilename } from './reportBuilder.js';
import { enrichCardWithType, loadCardTypesDatabase } from './cardTypesDatabase.js';
import { enrichDecksWithOnTheFlyFetch } from './cardTypeFetcher.js';
import { loadCardSynonyms } from './cardSynonyms.js';
import { inferEnergyType, inferTrainerType, isAceSpecName } from './cardTypeInference.js';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';

const WINDOW_DAYS = 30;
const MIN_USAGE_PERCENT = 0.5;
const TARGET_FOLDER = 'Online - Last 14 Days';

const REPORT_BASE_KEY = `reports/${TARGET_FOLDER}`;
const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
const DEFAULT_DETAILS_CONCURRENCY = 5;
const DEFAULT_STANDINGS_CONCURRENCY = 4;
const DEFAULT_R2_CONCURRENCY = 6;
const DEFAULT_MIN_TREND_APPEARANCES = 3;
const MIN_TREND_PLAYERS = 0;

// Placement tagging thresholds (absolute finishing positions)
const PLACEMENT_TAG_RULES = [
  { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
  { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
  { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
  { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
  { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
];

// Percentile-based placement tagging thresholds
const PERCENT_TAG_RULES = [
  { tag: 'top10', fraction: 0.1, minPlayers: 20 },
  { tag: 'top25', fraction: 0.25, minPlayers: 12 },
  { tag: 'top50', fraction: 0.5, minPlayers: 8 }
];

const SUCCESS_TAGS = Array.from(
  new Set([...PLACEMENT_TAG_RULES.map(rule => rule.tag), ...PERCENT_TAG_RULES.map(rule => rule.tag)])
);
const CARD_TREND_MIN_APPEARANCES = 2;
const DEFAULT_CARD_TREND_TOP = 12;

// =============================================================================
// Type Definitions
// =============================================================================

/** Configuration for archetype thumbnail mappings */
type ThumbnailConfig = Record<string, string[]>;

/** Card entry created from decklist parsing */
interface CardEntry {
  count: number;
  name: string;
  set: string | null;
  number: string | null;
  category: 'pokemon' | 'trainer' | 'energy';
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
}

/** Report item for thumbnail inference (subset of CardItem) */
interface ReportItem {
  name?: string;
  set?: string;
  number?: string | number;
  pct?: number;
  category?: string;
}

/** Report data structure with items array */
interface ReportData {
  items?: ReportItem[];
}

/** Tournament details response from Limitless API */
interface TournamentDetailsResponse {
  decklists?: boolean;
  isOnline?: boolean;
  format?: string | null;
  platform?: string | null;
  organizer?: {
    name?: string;
    id?: string;
  } | null;
}

/** Base options for functions that accept env and diagnostic options */
interface BaseOptions {
  diagnostics?: DiagnosticsCollector;
  fetchJson?: typeof fetchLimitlessJson;
}

/** Diagnostics collector for tracking issues during processing */
interface DiagnosticsCollector {
  detailsWithoutDecklists?: Array<{ tournamentId: string; name: string }>;
  detailsOffline?: Array<{ tournamentId: string; name: string }>;
  detailsUnsupportedFormat?: Array<{ tournamentId: string; name: string; format: string }>;
  standingsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  invalidStandingsPayload?: Array<{ tournamentId: string; name: string }>;
  entriesWithoutDecklists?: Array<{ tournamentId: string; player: string }>;
  entriesWithoutPlacing?: Array<{ tournamentId: string; name: string; player: string }>;
  tournamentsBelowMinimum?: Array<{ tournamentId: string; name: string; players: number }>;
}

/** Options for fetchRecentOnlineTournaments */
interface FetchTournamentsOptions extends BaseOptions {
  windowEnd?: string | Date;
  pageSize?: number;
  maxPages?: number;
  detailsConcurrency?: number;
}

/** Options for gatherDecks */
interface GatherDecksOptions extends BaseOptions {
  standingsConcurrency?: number;
}

/** Options for buildArchetypeReports */
interface BuildArchetypeReportsOptions {
  thumbnailConfig?: ThumbnailConfig;
}

/** Options for buildTrendReport */
interface BuildTrendReportOptions {
  now?: string | Date;
  windowStart?: string | Date;
  windowEnd?: string | Date;
  minAppearances?: number;
  seriesLimit?: number;
}

/** Options for buildCardTrendReport */
interface BuildCardTrendReportOptions {
  now?: string | Date;
  windowStart?: string | Date;
  windowEnd?: string | Date;
  minAppearances?: number;
  topCount?: number;
}

/** Options for runOnlineMetaJob */
interface OnlineMetaJobOptions extends FetchTournamentsOptions, GatherDecksOptions {
  now?: string | Date;
  since?: string | Date;
  seriesLimit?: number;
  minTrendAppearances?: number;
  r2Concurrency?: number;
}

/** Trend report result structure */
interface TrendReportResult {
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  deckTotal: number;
  tournamentCount: number;
  minAppearances: number;
  archetypeCount: number;
  series: TrendSeriesEntry[];
  tournaments: TournamentWithDeckCount[];
  totalArchetypes?: number;
  cardTrends?: CardTrendsResult;
}

/** Single archetype trend series entry */
interface TrendSeriesEntry {
  base: string;
  displayName: string;
  totalDecks: number;
  appearances: number;
  avgShare: number;
  maxShare: number;
  peakShare: number;
  minShare: number;
  successTotals: Record<string, number>;
  timeline: DailyTimelineEntry[];
}

/** Daily aggregated timeline entry */
interface DailyTimelineEntry {
  date: string;
  decks: number;
  totalDecks: number;
  share: number;
}

/** Tournament with deck count for trend reports */
interface TournamentWithDeckCount {
  id: string;
  name: string;
  date: string;
  deckTotal: number;
  players?: number;
  format?: string | null;
  platform?: string | null;
}

/** Card trends result structure */
interface CardTrendsResult {
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  cardsAnalyzed: number;
  rising: CardTrendItem[];
  falling: CardTrendItem[];
}

/** Individual card trend item */
interface CardTrendItem {
  key: string;
  name: string;
  set: string | null;
  number: string | null;
  appearances: number;
  startShare: number;
  endShare: number;
  delta: number;
  currentShare: number;
}

const ARCHETYPE_THUMBNAILS: ThumbnailConfig = (archetypeThumbnails as ThumbnailConfig) || {};
const AUTO_THUMB_MAX = 2;
const AUTO_THUMB_REQUIRED_PCT = 99.9;
const ARCHETYPE_DESCRIPTOR_TOKENS = new Set(['box', 'control', 'festival', 'lead', 'toolbox', 'turbo']);

async function runWithConcurrency(items, limit, handler) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const maxConcurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
  return results;
}

function daysAgo(count) {
  return new Date(Date.now() - count * 24 * 60 * 60 * 1000);
}

async function fetchRecentOnlineTournaments(env, since, options: FetchTournamentsOptions = {}) {
  const sinceMs = since.getTime();
  const windowEndMs = options.windowEnd ? new Date(options.windowEnd).getTime() : null;
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
  const { diagnostics } = options;
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const detailsConcurrency = options.detailsConcurrency || DEFAULT_DETAILS_CONCURRENCY;
  const unique = new Map();

  for (let page = 1; page <= maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const list = await fetchJson('/tournaments', {
      env,
      searchParams: {
        game: 'PTCG',
        limit: pageSize,
        page
      }
    });

    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of list) {
      const dateMs = Date.parse(entry?.date);
      if (!Number.isFinite(dateMs)) {
        continue;
      }
      if (dateMs < sinceMs) {
        sawOlder = true;
        continue;
      }
      if (windowEndMs && dateMs > windowEndMs) {
        continue;
      }
      unique.set(entry.id, entry);
    }

    if (sawOlder) {
      break;
    }
  }

  const summaries = Array.from(unique.values());
  const detailed = await runWithConcurrency(summaries, detailsConcurrency, async summary => {
    try {
      const details = (await fetchJson(`/tournaments/${summary.id}/details`, { env })) as TournamentDetailsResponse;
      if (details.decklists === false) {
        diagnostics?.detailsWithoutDecklists.push({
          tournamentId: summary.id,
          name: summary.name
        });
        return null;
      }
      if (details.isOnline === false) {
        diagnostics?.detailsOffline.push({
          tournamentId: summary.id,
          name: summary.name
        });
        return null;
      }

      const formatId = (details.format || summary.format || '').toUpperCase();
      if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
        diagnostics?.detailsUnsupportedFormat.push({
          tournamentId: summary.id,
          name: summary.name,
          format: formatId
        });
        return null;
      }
      return {
        id: summary.id,
        name: summary.name,
        date: summary.date,
        format: details.format || summary.format || null,
        platform: details.platform || null,
        game: summary.game,
        players: summary.players,
        organizer: details.organizer?.name || null,
        organizerId: details.organizer?.id || null
      };
    } catch (error) {
      console.warn('Failed to fetch tournament details', summary?.id, error?.message || error);
      return null;
    }
  });

  return detailed.filter(Boolean).sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}

function toCardEntries(decklist, cardTypesDb = null) {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const sections = Object.entries(decklist);
  const cards = [];

  for (const [sectionName, entries] of sections) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const card of entries) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const rawCategory = sectionName.toLowerCase();
      let category: 'pokemon' | 'trainer' | 'energy' = 'trainer';
      if (rawCategory === 'pokemon') {
        category = 'pokemon';
      } else if (rawCategory === 'energy') {
        category = 'energy';
      }

      const name = card?.name || 'Unknown Card';
      const set = card?.set || null;
      const number = card?.number || null;

      // Build base entry
      let entry: CardEntry = {
        count,
        name,
        set,
        number,
        category
      };

      // Try to enrich from database first
      if (cardTypesDb && set && number) {
        entry = enrichCardWithType(entry, cardTypesDb);
      }

      // Fall back to heuristics if database didn't provide the info
      if (!entry.trainerType && !entry.energyType) {
        if (category === 'trainer') {
          const trainerType = inferTrainerType(name);
          if (trainerType) {
            entry.trainerType = trainerType;
          }
        } else if (category === 'energy') {
          const energyType = inferEnergyType(name, set);
          if (energyType) {
            entry.energyType = energyType;
          }
        }
      }

      if (category === 'trainer' && !entry.aceSpec && isAceSpecName(name)) {
        entry.aceSpec = true;
      }

      cards.push(entry);
    }
  }

  return cards;
}

async function hashDeck(cards, playerId = '') {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API not available for hashing decks');
  }
  const canonical = cards
    .map(card => `${card.count}x${card.name || ''}::${card.set || ''}::${card.number || ''}`)
    .sort()
    .join('|');
  const source = canonical || playerId || `${Date.now()}-${Math.random()}`;
  const digest = await cryptoImpl.subtle.digest('SHA-1', new TextEncoder().encode(source));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function determinePlacementTags(placing, players) {
  const place = Number.isFinite(placing) ? placing : null;
  const fieldSize = Number.isFinite(players) ? players : null;
  if (!place || !fieldSize || place <= 0 || fieldSize <= 1) {
    return [];
  }

  const tags = [];

  for (const rule of PLACEMENT_TAG_RULES) {
    if (fieldSize >= rule.minPlayers && place <= rule.maxPlacing) {
      tags.push(rule.tag);
    }
  }

  for (const rule of PERCENT_TAG_RULES) {
    if (fieldSize < rule.minPlayers) {
      continue;
    }
    const cutoff = Math.max(1, Math.ceil(fieldSize * rule.fraction));
    if (place <= cutoff) {
      tags.push(rule.tag);
    }
  }

  return tags;
}

async function gatherDecks(env, tournaments, diagnostics, cardTypesDb = null, options: GatherDecksOptions = {}) {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return [];
  }

  const diag = diagnostics || {};
  diag.detailsWithoutDecklists = diag.detailsWithoutDecklists || [];
  diag.detailsOffline = diag.detailsOffline || [];
  diag.detailsUnsupportedFormat = diag.detailsUnsupportedFormat || [];
  diag.standingsFetchFailures = diag.standingsFetchFailures || [];
  diag.invalidStandingsPayload = diag.invalidStandingsPayload || [];
  diag.entriesWithoutDecklists = diag.entriesWithoutDecklists || [];
  diag.entriesWithoutPlacing = diag.entriesWithoutPlacing || [];
  diag.tournamentsBelowMinimum = diag.tournamentsBelowMinimum || [];

  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const standingsConcurrency = options.standingsConcurrency || DEFAULT_STANDINGS_CONCURRENCY;

  const perTournamentDecks = await runWithConcurrency(tournaments, standingsConcurrency, async tournament => {
    const limit = determinePlacementLimit(tournament?.players);
    if (limit === 0) {
      diag.tournamentsBelowMinimum.push({
        tournamentId: tournament.id,
        name: tournament.name,
        players: tournament.players
      });
      return [];
    }

    let standings;
    try {
      standings = await fetchJson(`/tournaments/${tournament.id}/standings`, { env });
    } catch (error) {
      console.warn('Failed to fetch standings', tournament.id, error?.message || error);
      diag.standingsFetchFailures.push({
        tournamentId: tournament.id,
        name: tournament.name,
        message: error?.message || 'Unknown standings fetch error'
      });
      return [];
    }

    if (!Array.isArray(standings)) {
      diag.invalidStandingsPayload.push({
        tournamentId: tournament.id,
        name: tournament.name
      });
      return [];
    }

    const sortedStandings = [...standings].sort((first, second) => {
      const placingA = Number.isFinite(first?.placing) ? first.placing : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(second?.placing) ? second.placing : Number.POSITIVE_INFINITY;
      return placingA - placingB;
    });

    // Derive tournament size when Limitless doesn't provide it (common for online)
    const maxReportedPlacing = Number.isFinite(sortedStandings.at(-1)?.placing)
      ? Number(sortedStandings.at(-1).placing)
      : 0;
    const derivedPlayers = Number(tournament?.players) || Math.max(sortedStandings.length, maxReportedPlacing);

    const cappedStandings = sortedStandings.slice(0, limit);
    const decks = [];

    for (const entry of cappedStandings) {
      if (!Number.isFinite(entry?.placing)) {
        diag.entriesWithoutPlacing.push({
          tournamentId: tournament.id,
          name: tournament.name,
          player: entry?.name || entry?.player || 'Unknown Player'
        });
      }

      const cards = toCardEntries(entry?.decklist, cardTypesDb);
      if (!cards.length) {
        diag.entriesWithoutDecklists.push({
          tournamentId: tournament.id,
          player: entry?.name || entry?.player || 'Unknown Player'
        });
        continue;
      }

      const archetypeName = entry?.deck?.name || 'Unknown';
      // eslint-disable-next-line no-await-in-loop
      const id = await hashDeck(cards, entry?.player);
      decks.push({
        id,
        player: entry?.name || entry?.player || 'Unknown Player',
        playerId: entry?.player || null,
        country: entry?.country || null,
        placement: entry?.placing ?? null,
        archetype: archetypeName,
        archetypeId: entry?.deck?.id || null,
        cards,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        tournamentDate: tournament.date,
        tournamentPlayers: derivedPlayers || tournament.players || null,
        tournamentFormat: tournament.format,
        tournamentPlatform: tournament.platform,
        tournamentOrganizer: tournament.organizer,
        deckSource: 'limitless-online',
        successTags: determinePlacementTags(entry?.placing, derivedPlayers || tournament?.players)
      });
    }

    return decks;
  });

  return perTournamentDecks.flat();
}

function normalizeDeckLabel(label: string) {
  return String(label || '')
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function tokenizeForMatching(text: string): string[] {
  const normalized = String(text || '')
    .replace(/['’]s\b/gi, 's')
    .replace(/_/g, ' ')
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9]+/gi)
    .map(token => token.trim())
    .filter(Boolean);
}

function extractArchetypeKeywords(name: string): string[] {
  return tokenizeForMatching(name).filter(token => !ARCHETYPE_DESCRIPTOR_TOKENS.has(token));
}

function formatCardNumber(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const str = String(raw).trim();
  if (!str) {
    return null;
  }
  const match = str.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return str.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

function buildThumbnailId(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string | null {
  const formattedNumber = formatCardNumber(number);
  const set = String(setCode || '')
    .toUpperCase()
    .trim();
  if (!formattedNumber || !set) {
    return null;
  }
  return `${set}/${formattedNumber}`;
}

function inferArchetypeThumbnails(displayName: string, reportData: ReportData | undefined | null): string[] {
  const keywords = extractArchetypeKeywords(displayName);
  if (!keywords.length || !reportData || !Array.isArray(reportData.items)) {
    return [];
  }
  const keywordSet = new Set(keywords);
  const candidates = [];

  reportData.items.forEach((item, index) => {
    const pct = Number(item?.pct);
    if (!Number.isFinite(pct) || pct < AUTO_THUMB_REQUIRED_PCT) {
      return;
    }
    const category = String(item?.category || '').toLowerCase();
    if (category && !category.includes('pokemon')) {
      return;
    }
    const thumbnailId = buildThumbnailId(item?.set, item?.number);
    if (!thumbnailId) {
      return;
    }
    const cardTokens = extractArchetypeKeywords(item?.name || '');
    const matchCount = cardTokens.filter(token => keywordSet.has(token)).length;
    if (matchCount === 0) {
      return;
    }
    candidates.push({
      id: thumbnailId,
      matchCount,
      pct,
      index,
      tokens: cardTokens
    });
  });

  if (!candidates.length) {
    return [];
  }

  candidates.sort(
    (first, second) => second.matchCount - first.matchCount || second.pct - first.pct || first.index - second.index
  );

  const selected: string[] = [];
  const covered = new Set<string>();
  for (const candidate of candidates) {
    const coversNewToken = candidate.tokens.some(token => keywordSet.has(token) && !covered.has(token));
    if (!coversNewToken && selected.length > 0) {
      continue;
    }
    if (selected.includes(candidate.id)) {
      continue;
    }
    selected.push(candidate.id);
    candidate.tokens.forEach(token => {
      if (keywordSet.has(token)) {
        covered.add(token);
      }
    });
    if (selected.length >= AUTO_THUMB_MAX || covered.size >= keywordSet.size) {
      break;
    }
  }

  return selected;
}

function resolveArchetypeThumbnails(
  baseName: string,
  displayName: string,
  config: ThumbnailConfig,
  reportData?: ReportData
): string[] {
  const attempts = [displayName, displayName?.replace(/_/g, ' '), baseName];
  for (const candidate of attempts) {
    if (candidate && Array.isArray(config[candidate]) && config[candidate].length) {
      return config[candidate];
    }
  }

  const normalizedTarget = normalizeDeckLabel(displayName || baseName || '');
  if (!normalizedTarget) {
    return inferArchetypeThumbnails(displayName || baseName || '', reportData);
  }

  for (const [key, ids] of Object.entries(config)) {
    if (normalizeDeckLabel(key) === normalizedTarget && ids.length) {
      return ids;
    }
  }

  return inferArchetypeThumbnails(displayName || baseName || '', reportData);
}

function buildArchetypeReports(decks, minPercent, synonymDb, options: BuildArchetypeReportsOptions = {}) {
  const groups = new Map();
  const thumbnailConfig: ThumbnailConfig = options.thumbnailConfig || {};

  for (const deck of decks) {
    const displayName = deck?.archetype || 'Unknown';
    const normalized = normalizeArchetypeName(displayName);
    const filenameBase = sanitizeForFilename(normalized.replace(/ /g, '_')) || 'Unknown';
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        displayName,
        filenameBase,
        decks: []
      });
    }
    groups.get(normalized).decks.push(deck);
  }

  const deckTotal = decks.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * (minPercent / 100)));
  const archetypeFiles = [];
  const deckMap = new Map();

  groups.forEach(group => {
    if (group.decks.length < minDecks) {
      return;
    }
    const filename = `${group.filenameBase}.json`;
    const data = generateReportFromDecks(group.decks, group.decks.length, decks, synonymDb);
    archetypeFiles.push({
      filename,
      base: group.filenameBase,
      displayName: group.displayName,
      data,
      deckCount: group.decks.length
    });
    deckMap.set(group.filenameBase, group.decks);
  });

  archetypeFiles.sort((first, second) => second.deckCount - first.deckCount);

  const archetypeIndex = archetypeFiles.map(file => ({
    name: file.base,
    label: file.displayName || file.base.replace(/_/g, ' '),
    deckCount: file.deckCount,
    percent: deckTotal ? file.deckCount / deckTotal : 0,
    thumbnails: resolveArchetypeThumbnails(file.base, file.displayName, thumbnailConfig, file.data)
  }));

  return {
    archetypeFiles,
    archetypeIndex,
    minDecks,
    deckMap
  };
}

function buildTrendReport(decks, tournaments, options: BuildTrendReportOptions = {}): TrendReportResult {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_TREND_APPEARANCES
  );
  const seriesLimit = Number.isFinite(options.seriesLimit) ? Math.max(1, Number(options.seriesLimit)) : null;

  const tournamentIndex = new Map();
  const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
    .filter(tournament => tournament && tournament.id && (Number(tournament.players) || 0) >= MIN_TREND_PLAYERS)
    .map(tournament => ({
      ...tournament,
      date: tournament.date || null
    }))
    .sort((first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0));

  sortedTournaments.forEach(tournament => {
    tournamentIndex.set(tournament.id, {
      ...tournament,
      deckTotal: 0
    });
  });

  const archetypes = new Map();
  const successTagSet = new Set(SUCCESS_TAGS);
  const deckList = Array.isArray(decks) ? decks : [];

  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentIndex.has(tournamentId)) {
      continue;
    }
    const normalizedName = normalizeArchetypeName(deck?.archetype || 'Unknown');
    const base = sanitizeForFilename(normalizedName.replace(/ /g, '_')) || 'unknown';
    const displayName = deck?.archetype || 'Unknown';

    const archetype = archetypes.get(base) || {
      base,
      displayName,
      totalDecks: 0,
      timeline: new Map()
    };

    const tournamentMeta = tournamentIndex.get(tournamentId);
    tournamentMeta.deckTotal += 1;

    const timelineEntry = archetype.timeline.get(tournamentId) || {
      tournamentId,
      tournamentName: deck?.tournamentName || tournamentMeta?.name || 'Unknown Tournament',
      date: deck?.tournamentDate || tournamentMeta?.date || null,
      decks: 0,
      success: {}
    };

    timelineEntry.decks += 1;
    for (const tag of Array.isArray(deck?.successTags) ? deck.successTags : []) {
      if (!successTagSet.has(tag)) {
        continue;
      }
      timelineEntry.success[tag] = (timelineEntry.success[tag] || 0) + 1;
    }

    archetype.timeline.set(tournamentId, timelineEntry);
    archetype.totalDecks += 1;
    archetype.displayName = archetype.displayName || displayName;

    archetypes.set(base, archetype);
  }

  const series = [];
  archetypes.forEach(archetype => {
    const timeline = sortedTournaments.map(tournament => {
      const entry = archetype.timeline.get(tournament.id);
      const tournamentMeta = tournamentIndex.get(tournament.id);
      const totalDecks = tournamentMeta?.deckTotal || 0;

      if (entry) {
        const share = totalDecks ? Math.round((entry.decks / totalDecks) * 10000) / 100 : 0;
        return {
          ...entry,
          totalDecks,
          share
        };
      }

      // Backfill missing tournament
      return {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        date: tournament.date,
        decks: 0,
        totalDecks,
        share: 0,
        success: {}
      };
    });

    // Count actual appearances (tournaments where archetype had at least 1 deck)
    const appearances = timeline.filter(entry => (entry.decks || 0) > 0).length;
    if (appearances < minAppearances) {
      return;
    }

    const aggregateSuccess = {};
    for (const entry of timeline) {
      Object.entries(entry.success || {}).forEach(([tag, count]) => {
        aggregateSuccess[tag] = (aggregateSuccess[tag] || 0) + (Number(count) || 0);
      });
    }

    const shares = timeline.map(entry => entry.share || 0);
    const avgShare = shares.length
      ? Math.round((shares.reduce((sum, value) => sum + value, 0) / shares.length) * 10) / 10
      : 0;
    const maxShare = shares.length ? Math.max(...shares) : 0;
    const peakShare = maxShare; // Alias for clarity
    const minShare = shares.length ? Math.min(...shares) : 0;

    // Aggregate timeline by day (date) instead of by tournament
    const dailyData = new Map();
    for (const entry of timeline) {
      const dateKey = entry.date ? entry.date.split('T')[0] : 'unknown';
      if (!dailyData.has(dateKey)) {
        dailyData.set(dateKey, { decks: 0, totalDecks: 0 });
      }
      const day = dailyData.get(dateKey);
      day.decks += entry.decks || 0;
      day.totalDecks += entry.totalDecks || 0;
    }

    const dailyTimeline = Array.from(dailyData.entries())
      .map(([date, data]) => ({
        date,
        decks: data.decks,
        totalDecks: data.totalDecks,
        share: data.totalDecks ? Math.round((data.decks / data.totalDecks) * 10000) / 100 : 0
      }))
      .sort((first, second) => first.date.localeCompare(second.date));

    series.push({
      base: archetype.base,
      displayName: archetype.displayName,
      totalDecks: archetype.totalDecks,
      appearances,
      avgShare,
      maxShare,
      peakShare,
      minShare,
      successTotals: aggregateSuccess,
      timeline: dailyTimeline
    });
  });

  series.sort((first, second) => second.totalDecks - first.totalDecks || second.avgShare - first.avgShare);
  const limitedSeries = seriesLimit ? series.slice(0, seriesLimit) : series;

  const tournamentCount = sortedTournaments.length;

  const tournamentsWithDeckCounts = sortedTournaments.map(tournament => {
    const meta = tournamentIndex.get(tournament.id);
    return {
      ...tournament,
      deckTotal: meta?.deckTotal ?? tournament.deckTotal ?? 0
    };
  });

  const result: TrendReportResult = {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    deckTotal: deckList.length,
    tournamentCount,
    minAppearances,
    archetypeCount: limitedSeries.length,
    series: limitedSeries,
    tournaments: tournamentsWithDeckCounts
  };

  if (seriesLimit && limitedSeries.length !== series.length) {
    result.totalArchetypes = series.length;
  }

  return result;
}

function buildCardTrendReport(decks, tournaments, options: BuildCardTrendReportOptions = {}): CardTrendsResult {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : CARD_TREND_MIN_APPEARANCES
  );
  const topCount = Math.max(1, Number.isFinite(options.topCount) ? Number(options.topCount) : DEFAULT_CARD_TREND_TOP);

  const tournamentsMap = new Map();
  (Array.isArray(tournaments) ? tournaments : [])
    .filter(tournament => tournament && tournament.id && (Number(tournament.players) || 0) >= MIN_TREND_PLAYERS)
    .forEach(tournament => {
      tournamentsMap.set(tournament.id, {
        id: tournament.id,
        date: tournament.date || null,
        deckTotal: Number(tournament.deckTotal) || 0
      });
    });

  const cardPresence = new Map(); // key -> Map<tournamentId, presentCount>
  const cardMeta = new Map();

  const deckList = Array.isArray(decks) ? decks : [];
  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentsMap.has(tournamentId)) {
      continue;
    }
    const uniqueCards = new Set();
    for (const card of Array.isArray(deck?.cards) ? deck.cards : []) {
      const name = card?.name || 'Unknown Card';
      const set = (card?.set || '').toString().toUpperCase();
      const number = card?.number || '';
      const key = set && number ? `${name}::${set}::${number}` : name;
      uniqueCards.add(key);
      if (!cardMeta.has(key)) {
        cardMeta.set(key, { name, set: set || null, number: number || null });
      }
    }
    uniqueCards.forEach(key => {
      if (!cardPresence.has(key)) {
        cardPresence.set(key, new Map());
      }
      const counts = cardPresence.get(key);
      counts.set(tournamentId, (counts.get(tournamentId) || 0) + 1);
    });
  }

  const series = [];
  cardPresence.forEach((presenceMap, key) => {
    const timeline = Array.from(tournamentsMap.values())
      .sort((first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0))
      .map(meta => {
        const present = presenceMap.get(meta.id) || 0;
        const share = meta.deckTotal ? Math.round((present / meta.deckTotal) * 10000) / 100 : 0;
        return {
          tournamentId: meta.id,
          date: meta.date || null,
          present,
          total: meta.deckTotal,
          share
        };
      });

    const presentEvents = timeline.filter(entry => entry.present > 0).length;
    if (presentEvents < minAppearances) {
      return;
    }

    const chunk = Math.max(1, Math.ceil(timeline.length / 3));
    const startAvg =
      Math.round((timeline.slice(0, chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10) / 10;
    const endAvg =
      Math.round((timeline.slice(-chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10) / 10;
    const delta = Math.round((endAvg - startAvg) * 10) / 10;
    const latestShare = timeline.at(-1)?.share || 0;

    series.push({
      key,
      ...cardMeta.get(key),
      appearances: timeline.length,
      startShare: startAvg,
      endShare: endAvg,
      delta,
      currentShare: latestShare
    });
  });

  // Basic energy cards to exclude from trend reports (variant changes aren't meaningful)
  const BASIC_ENERGY_NAMES = new Set([
    'Psychic Energy',
    'Fire Energy',
    'Lightning Energy',
    'Grass Energy',
    'Darkness Energy',
    'Metal Energy',
    'Fighting Energy',
    'Water Energy'
  ]);

  const rising = [...series]
    .filter(item => item.currentShare > 0)
    .filter(item => !BASIC_ENERGY_NAMES.has(item.name))
    .sort((first, second) => second.delta - first.delta)
    .slice(0, topCount);
  const falling = [...series]
    .filter(item => !BASIC_ENERGY_NAMES.has(item.name))
    .sort((first, second) => first.delta - second.delta)
    .slice(0, topCount);

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    cardsAnalyzed: series.length,
    rising,
    falling
  };
}

async function putJson(env, key, data) {
  if (!env?.REPORTS?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  const payload = JSON.stringify(data, null, 2);
  await env.REPORTS.put(key, payload, {
    httpMetadata: {
      contentType: 'application/json'
    }
  });
}

async function batchPutJson(env, entries, concurrency = DEFAULT_R2_CONCURRENCY) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const normalized = entries
    .filter(entry => entry && entry.key && entry.data !== undefined)
    .map(entry => ({ key: entry.key, data: entry.data }));

  if (!normalized.length) {
    return;
  }

  const limit = Math.max(1, Number(concurrency) || DEFAULT_R2_CONCURRENCY);
  await runWithConcurrency(normalized, limit, async entry => putJson(env, entry.key, entry.data));
}

// Note: updateTournamentsList() has been removed because online tournaments
// are now treated as a special case and are NOT added to tournaments.json

function determinePlacementLimit(players) {
  const count = Number(players) || 0;
  // Drop ultra-tiny events
  if (count > 0 && count <= 3) {
    return 0;
  }
  // Known small events: capture full field
  if (count > 0 && count <= 16) {
    return count;
  }
  // Medium events: capture top 75%
  if (count > 0 && count <= 32) {
    return 32;
  }
  if (count > 0 && count <= 64) {
    return 64;
  }
  if (count > 0 && count <= 128) {
    return 96;
  }
  // Large events: capture top 128
  if (count >= 129) {
    return 128;
  }
  // Unknown player counts: grab a richer slice to avoid under-sampling
  return 64;
}

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

  const deckTotal = decks.length;
  const masterReport = generateReportFromDecks(decks, deckTotal, decks, synonymDb);
  const { archetypeFiles, archetypeIndex, minDecks } = buildArchetypeReports(decks, MIN_USAGE_PERCENT, synonymDb, {
    thumbnailConfig: ARCHETYPE_THUMBNAILS
  });
  const trendSeriesLimit = Number.isFinite(options.seriesLimit) ? Number(options.seriesLimit) : 32;
  const trendReport = buildTrendReport(decks, tournaments, {
    windowStart: since,
    windowEnd: now,
    now,
    minAppearances: options.minTrendAppearances,
    seriesLimit: trendSeriesLimit
  });
  const trendTournaments =
    Array.isArray(trendReport?.tournaments) && trendReport.tournaments.length ? trendReport.tournaments : tournaments;
  const cardTrends = buildCardTrendReport(decks, trendTournaments, {
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

export { fetchRecentOnlineTournaments, gatherDecks, buildArchetypeReports, buildTrendReport, buildCardTrendReport };
