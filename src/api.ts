/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, safeFetch, validateType, withRetry } from './utils/errorHandler.js';
import { perf } from './utils/performance.js';
import { clearDatabaseCache, loadDatabase } from './lib/database.js';
import { TtlCache } from './utils/cache.js';

import { sortTournamentNamesByRecency } from './utils/tournamentRecency.js';
import type {
  ArchetypeFilterRequest,
  ArchetypeFilterResponse,
  ArchetypeIndexEntry,
  ArchetypeReport,
  ArchetypeSuccessSummaryByTag,
  CanonicalMatchRecord,
  MetaReport,
  PlayerMatchRecord,
  PricingData,
  TournamentManifest,
  TournamentParticipant,
  TournamentReport,
  TrendReportPayload
} from './types/index.js';

let pricingData: PricingData | null = null;
let pricingPromise: Promise<PricingData> | null = null;
const priceResolutionCache = new Map<string, number | null>();
const pricingEntryCache = new Map<string, any | null>();
const jsonCache = new TtlCache({
  ttl: CONFIG.API.JSON_CACHE_TTL_MS,
  maxEntries: CONFIG.CACHE.MAX_ENTRIES,
  cleanupThreshold: CONFIG.CACHE.CLEANUP_THRESHOLD
});
const reportCache = new TtlCache<TournamentReport>({ ttl: CONFIG.API.JSON_CACHE_TTL_MS });
const tournamentDbAvailabilityCache = new Map<string, boolean>();
let apiTestHooks: {
  loadDatabase?: (tournament: string) => Promise<any>;
  fetchTournamentManifest?: (tournament: string) => Promise<TournamentManifest>;
} = {};
export const ONLINE_META_NAME = 'Online - Last 14 Days';
export type ReportSlice = 'all' | 'phase2' | 'topcut';
// const _ONLINE_META_SEGMENT = `/${encodeURIComponent(ONLINE_META_NAME)}`; // Reserved for future use

/**
 * Clear cached API data and reset database cache.
 */
export function clearApiCache() {
  jsonCache.clear();
  reportCache.clear();
  tournamentDbAvailabilityCache.clear();
  priceResolutionCache.clear();
  pricingEntryCache.clear();
  apiTestHooks = {};
  clearDatabaseCache();
}

/**
 * Test-only hook registration for API internals.
 * @internal
 */
export function __setApiTestHooks(
  hooks: Partial<{
    loadDatabase: (tournament: string) => Promise<any>;
    fetchTournamentManifest: (tournament: string) => Promise<TournamentManifest>;
  }>
): void {
  apiTestHooks = {
    ...(hooks.loadDatabase ? { loadDatabase: hooks.loadDatabase } : {}),
    ...(hooks.fetchTournamentManifest ? { fetchTournamentManifest: hooks.fetchTournamentManifest } : {})
  };
}

function fetchWithTimeout(url: string, options: RequestInit = {}) {
  return safeFetch(url, { timeout: CONFIG.API.TIMEOUT_MS, ...options });
}

function getSliceBasePath(tournament: string, slice: ReportSlice = 'all'): string {
  const encodedTournament = encodeURIComponent(tournament);
  if (slice === 'all') {
    return encodedTournament;
  }
  return `${encodedTournament}/slices/${slice}`;
}

function normalizeTournamentManifest(raw: unknown): TournamentManifest {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const assetsRecord =
    record.assets && typeof record.assets === 'object' ? (record.assets as Record<string, unknown>) : {};

  const masterBytes = Number(assetsRecord.masterBytes);
  const dbBytes = Number(assetsRecord.dbBytes);
  const updatedAt = typeof assetsRecord.updatedAt === 'string' ? assetsRecord.updatedAt : '';
  const hasTournamentDb = record.hasTournamentDb === true;

  return {
    hasTournamentDb,
    assets: {
      masterBytes: Number.isFinite(masterBytes) && masterBytes >= 0 ? masterBytes : 0,
      updatedAt,
      ...(Number.isFinite(dbBytes) && dbBytes >= 0 ? { dbBytes } : {})
    }
  };
}

/**
 * Safe JSON parsing with improved error handling
 * @param response
 * @param url
 * @returns
 */
async function safeJsonParse(response: Response, url: string): Promise<any> {
  const contentType = response.headers.get('content-type') || '';

  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new AppError(ErrorTypes.PARSE, 'Empty response body', null, {
      url,
      contentType
    });
  }

  const isJsonContent = contentType.includes('application/json') || contentType.includes('text/json');
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

  // Some upstream endpoints incorrectly return text/plain while serving JSON.
  // Accept JSON-like bodies even with the wrong content-type, but log a warning.
  if (!isJsonContent && looksLikeJson) {
    logger.warn('Non-JSON content-type, parsing as JSON anyway', { url, contentType });
  } else if (!isJsonContent) {
    const preview = trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
    throw new AppError(
      ErrorTypes.PARSE,
      `Expected JSON response but got ${contentType || 'unknown content type'}`,
      null,
      { url, contentType, preview }
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new AppError(ErrorTypes.PARSE, String(error));
    if (err instanceof SyntaxError) {
      const preview = trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '');
      throw new AppError(ErrorTypes.PARSE, `Invalid JSON response: ${err.message}`, null, {
        url,
        contentType,
        preview
      });
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(ErrorTypes.PARSE, err.message, null, { url, contentType });
  }
}

interface FetchOptions {
  cache?: boolean;
  cacheKey?: string;
  ttl?: number;
}

/**
 * Common API fetch wrapper with retry, validation, and logging
 * @param url - API endpoint URL
 * @param operation - Description for logging
 * @param expectedType - Expected data type for validation
 * @param fieldName - Field name for validation errors
 * @param options
 * @returns
 */
function fetchWithRetry<T>(
  url: string,
  operation: string,
  expectedType: string,
  fieldName?: string,
  options: FetchOptions = {}
): Promise<T> {
  const { cache = false, cacheKey = url, ttl = CONFIG.API.JSON_CACHE_TTL_MS } = options;

  if (cache) {
    const cached = jsonCache.get(cacheKey);
    if (cached !== undefined) {
      logger.debug(`Cache hit for ${operation}`, { cacheKey });
      return Promise.resolve(cached as T);
    }
    const pending = jsonCache.getPromise(cacheKey);
    if (pending) {
      logger.debug(`Awaiting in-flight request for ${operation}`, { cacheKey });
      return pending as Promise<T>;
    }
  }

  const loader = async () => {
    logger.debug(`Fetching ${operation}`);
    const response = await fetchWithTimeout(url);
    const data = await safeJsonParse(response, url);

    validateType(data, expectedType, fieldName || operation);
    const count = Array.isArray(data) ? data.length : data.items?.length || 'unknown';
    logger.info(`Loaded ${operation}`, { count });
    return data;
  };

  const fetchPromise = withRetry(loader, {
    maxAttempts: CONFIG.API.RETRY_ATTEMPTS,
    delayMs: CONFIG.API.RETRY_DELAY_MS,
    shouldRetry: error =>
      !(error instanceof AppError && Number(error.context?.status) >= 400 && Number(error.context?.status) < 500)
  }).catch(error => {
    logger.error(`Failed ${operation}`, {
      url,
      message: error?.message || error,
      preview: error?.context?.preview
    });
    throw error;
  });

  if (!cache) {
    return fetchPromise as Promise<T>;
  }

  const trackedPromise = fetchPromise
    .then(data => {
      jsonCache.set(cacheKey, data, ttl);
      return data;
    })
    .catch(error => {
      jsonCache.delete(cacheKey);
      throw error;
    });

  jsonCache.setPending(cacheKey, trackedPromise, ttl);
  return trackedPromise as Promise<T>;
}

function buildReportUrls(relativePath: string): string[] {
  const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const urls: string[] = [];

  // ALWAYS try R2 first for all reports
  if (CONFIG.API.R2_BASE) {
    urls.push(`${CONFIG.API.R2_BASE}/reports${normalizedPath}`);
  }

  // Fallback to local path (for development only)
  urls.push(`${CONFIG.API.REPORTS_BASE}${normalizedPath}`.replace('//', '/'));
  return urls;
}

/**
 * Fetch a report resource from R2.
 * @param relativePath - Report path relative to R2 reports.
 * @param operation - Description for logging.
 * @param expectedType - Expected payload type.
 * @param fieldName - Field name for validation errors.
 * @param options - Cache options.
 */
export async function fetchReportResource<T = any>(
  relativePath: string,
  operation: string,
  expectedType: string,
  fieldName: string,
  options: FetchOptions = {}
): Promise<T> {
  const urls = buildReportUrls(relativePath);
  let lastError: any = null;

  for (const url of urls) {
    try {
      return await fetchWithRetry<T>(url, operation, expectedType, fieldName, {
        ...options,
        cacheKey: url
      });
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      lastError = error;
      logger.warn(`${operation} failed via ${url}`, {
        message: errMessage
      });
    }
  }

  throw lastError;
}

/**
 * Fetch the list of tournaments.
 */
export function fetchTournamentsList(): Promise<string[]> {
  // Use eagerly-prefetched tournaments list from inline script if available.
  // This fires during HTML parse, well before modules finish loading.
  const prefetched = (globalThis as any).__tournamentsPromise as Promise<string[] | null> | undefined;
  if (prefetched) {
    // Consume once to avoid stale reuse on subsequent calls
    delete (globalThis as any).__tournamentsPromise;
    return prefetched.then(data => {
      if (Array.isArray(data) && data.length > 0) {
        return sortTournamentNamesByRecency(data);
      }
      // Prefetch failed or returned empty — fall through to normal fetch
      return fetchReportResource<string[]>('tournaments.json', 'tournaments list', 'array', 'tournaments list', {
        cache: true
      }).then(tournaments => sortTournamentNamesByRecency(tournaments));
    });
  }
  return fetchReportResource<string[]>('tournaments.json', 'tournaments list', 'array', 'tournaments list', {
    cache: true
  }).then(tournaments => sortTournamentNamesByRecency(tournaments));
}

/**
 * Fetch tournament manifest metadata.
 * Falls back to an explicit "no db" manifest when unavailable.
 * @param tournament - Tournament identifier.
 */
async function fetchTournamentManifest(tournament: string): Promise<TournamentManifest> {
  // manifest.json is served by the Pages Function, not stored in R2 — fetch directly from origin
  const localUrl = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/manifest.json`;
  try {
    const data = await fetchWithRetry<TournamentManifest>(
      localUrl,
      `manifest for ${tournament}`,
      'object',
      'tournament manifest',
      { cache: true }
    );
    return normalizeTournamentManifest(data);
  } catch (error: unknown) {
    logger.debug('Tournament manifest unavailable, assuming no SQLite database', {
      tournament,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      hasTournamentDb: false,
      assets: {
        masterBytes: 0,
        updatedAt: ''
      }
    };
  }
}

/**
 * Fetch a lightweight tournament summary.
 * Prefers meta.json and only falls back to master.json deckTotal.
 * @param tournament - Tournament identifier.
 */
export async function fetchTournamentSummary(
  tournament: string
): Promise<{ deckTotal: number; updatedAt?: string | null }> {
  try {
    const meta = await fetchMeta(tournament);
    if (Number.isFinite(meta?.deckTotal)) {
      return {
        deckTotal: Number(meta.deckTotal),
        updatedAt: typeof meta.generatedAt === 'string' ? meta.generatedAt : null
      };
    }
  } catch (error) {
    logger.debug('meta.json summary unavailable, falling back to master.json', {
      tournament,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const report = await fetchReportResource<TournamentReport>(
    `${encodeURIComponent(tournament)}/master.json`,
    `master summary for ${tournament}`,
    'object',
    'tournament summary',
    { cache: true }
  );

  return {
    deckTotal: Number(report?.deckTotal || 0),
    updatedAt: null
  };
}

async function hasTournamentDatabase(tournament: string): Promise<boolean> {
  const cached = tournamentDbAvailabilityCache.get(tournament);
  if (typeof cached === 'boolean') {
    return cached;
  }

  const manifest = apiTestHooks.fetchTournamentManifest
    ? await apiTestHooks.fetchTournamentManifest(tournament)
    : await fetchTournamentManifest(tournament);
  const hasDb = manifest.hasTournamentDb === true;
  tournamentDbAvailabilityCache.set(tournament, hasDb);
  return hasDb;
}

/**
 * Fetch the master report for a tournament.
 * @param tournament - Tournament identifier.
 */
export async function fetchReport(
  tournament: string,
  slice?: ReportSlice,
  options?: { skipSqlite?: boolean }
): Promise<TournamentReport> {
  const resolvedSlice = slice ?? 'all';
  const cacheKey = `report:${tournament}:${resolvedSlice}`;

  const cached = reportCache.get(cacheKey);
  if (cached !== undefined) {
    logger.debug('Report cache hit', { tournament, slice: resolvedSlice });
    return cached;
  }
  const pending = reportCache.getPromise(cacheKey);
  if (pending) {
    logger.debug('Awaiting in-flight report request', { tournament, slice: resolvedSlice });
    return pending;
  }

  perf.start(`fetchReport:${tournament}:${resolvedSlice}`);
  const loader = (async () => {
    if (resolvedSlice === 'all' && !options?.skipSqlite) {
      const shouldAttemptSqlite = await hasTournamentDatabase(tournament);

      if (shouldAttemptSqlite) {
        try {
          const db = apiTestHooks.loadDatabase
            ? await apiTestHooks.loadDatabase(tournament)
            : await loadDatabase(tournament);
          const cardStats = db.getCardStats();
          const deckTotal = db.getTotalDecks();
          const items = cardStats.map((row: any) => ({
            name: row.card_name,
            set: row.card_set ?? undefined,
            number: row.card_number ?? undefined,
            uid: row.card_uid,
            found: row.found,
            total: deckTotal,
            pct: row.pct,
            category: row.category ?? undefined,
            trainerType: row.trainer_type ?? undefined,
            energyType: row.energy_type ?? undefined,
            aceSpec: Boolean(row.ace_spec),
            dist: row.dist || [],
            rank: row.rank
          }));
          logger.debug(`Loaded tournament report from SQLite for ${tournament}`, {
            deckTotal,
            itemCount: items.length
          });
          return { deckTotal, items };
        } catch (dbError) {
          logger.debug('SQLite report failed, falling back to JSON', {
            tournament,
            slice: resolvedSlice,
            error: dbError instanceof Error ? dbError.message : String(dbError)
          });

          // If SQLite fails despite manifest saying available, avoid repeated attempts for this session.
          if (dbError instanceof AppError && Number(dbError.context?.status) === 404) {
            tournamentDbAvailabilityCache.set(tournament, false);
          }
        }
      } else {
        logger.debug('Skipping SQLite load based on manifest gate', {
          tournament
        });
      }
    }

    const basePath = getSliceBasePath(tournament, resolvedSlice);
    return fetchReportResource<TournamentReport>(
      `${basePath}/master.json`,
      `report for ${tournament}`,
      'object',
      'tournament report',
      {
        cache: true
      }
    );
  })();

  reportCache.setPending(cacheKey, loader);

  try {
    const data = await loader;
    reportCache.set(cacheKey, data);
    return data;
  } finally {
    perf.end(`fetchReport:${tournament}:${resolvedSlice}`);
  }
}

/**
 * Fetch the trends report payload for a tournament.
 * @param tournament - Tournament identifier.
 */
export function fetchTrendReport(tournament: string): Promise<TrendReportPayload> {
  const encodedTournament = encodeURIComponent(tournament);
  return fetchReportResource<TrendReportPayload>(
    `${encodedTournament}/trends.json`,
    `trends for ${tournament}`,
    'object',
    'trend report',
    {
      cache: true
    }
  );
}

/**
 * Normalize a single archetype index entry into a consistent object.
 * @param entry
 * @returns
 */
function normalizeArchetypeIndexEntry(entry: unknown): ArchetypeIndexEntry | null {
  if (!entry) {
    return null;
  }
  if (typeof entry === 'string') {
    return {
      name: entry,
      label: entry.replace(/_/g, ' '),
      deckCount: null,
      percent: null,
      thumbnails: [],
      signatureCards: []
    };
  }
  if (typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const name = String(record.name || record.base || record.id || '').trim();
    if (!name) {
      return null;
    }
    const label = (record.label as string) || (record.display as string) || name.replace(/_/g, ' ');
    const deckCount = Number.isFinite(record.deckCount) ? Number(record.deckCount) : null;
    const percentValue = Number(record.percent);
    const percent = Number.isFinite(percentValue) ? percentValue : null;
    const thumbnails = Array.isArray(record.thumbnails) ? record.thumbnails.filter(Boolean) : [];
    const signatureCards = Array.isArray(record.signatureCards)
      ? record.signatureCards
          .map(entry => {
            if (!entry || typeof entry !== 'object') {
              return null;
            }
            const card = entry as Record<string, unknown>;
            const cardName = String(card.name || '').trim();
            if (!cardName) {
              return null;
            }
            const set = typeof card.set === 'string' && card.set.trim() ? card.set.trim() : null;
            const number = typeof card.number === 'string' && card.number.trim() ? card.number.trim() : null;
            const pctValue = Number(card.pct);
            const pct = Number.isFinite(pctValue) ? pctValue : 0;
            return { name: cardName, set, number, pct };
          })
          .filter((card): card is NonNullable<typeof card> => Boolean(card))
      : [];
    return {
      name,
      label,
      deckCount,
      percent,
      thumbnails,
      signatureCards
    };
  }
  return null;
}

/**
 * Fetch the archetype index list for a tournament.
 * @param tournament - Tournament identifier.
 */
export async function fetchArchetypesList(
  tournament: string,
  slice: ReportSlice = 'all'
): Promise<ArchetypeIndexEntry[]> {
  const basePath = getSliceBasePath(tournament, slice);
  const result = await fetchReportResource<any[]>(
    `${basePath}/archetypes/index.json`,
    `archetypes for ${tournament}`,
    'array',
    'archetypes list',
    { cache: true }
  );

  if (!Array.isArray(result)) {
    return [];
  }

  return result.map(normalizeArchetypeIndexEntry).filter((entry): entry is ArchetypeIndexEntry => Boolean(entry));
}

/**
 * Fetch an archetype report for a tournament.
 * @param tournament - Tournament identifier.
 * @param archetypeBase - Archetype slug.
 */
export async function fetchArchetypeReport(
  tournament: string,
  archetypeBase: string,
  slice: ReportSlice = 'all'
): Promise<ArchetypeReport> {
  logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`, { slice });
  const basePath = getSliceBasePath(tournament, slice);
  const path = `${basePath}/archetypes/${encodeURIComponent(archetypeBase)}/cards.json`;

  return fetchReportResource(
    path,
    `archetype report ${archetypeBase} for ${tournament}`,
    'object',
    'archetype report',
    {
      cache: true
    }
  ).then(data => {
    logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, {
      slice,
      itemCount: data.items?.length
    });
    return data;
  });
}

/**
 * Fetch optional pre-aggregated archetype success summaries.
 * @param tournament - Tournament identifier.
 * @param archetypeBase - Archetype slug.
 * @param slice - Optional tournament slice.
 */
export async function fetchArchetypeSummaryBySuccess(
  tournament: string,
  archetypeBase: string,
  slice: ReportSlice = 'all'
): Promise<ArchetypeSuccessSummaryByTag | null> {
  const basePath = getSliceBasePath(tournament, slice);
  const path = `${basePath}/archetypes/${encodeURIComponent(archetypeBase)}/summary-by-success.json`;

  try {
    const data = await fetchReportResource<ArchetypeSuccessSummaryByTag>(
      path,
      `archetype success summary ${archetypeBase} for ${tournament}`,
      'object',
      'archetype success summary',
      { cache: true }
    );
    return data && typeof data === 'object' ? data : null;
  } catch (error) {
    logger.debug('Optional archetype success summary unavailable', {
      tournament,
      archetypeBase,
      slice,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Fetch server-side archetype filter aggregation.
 * @param request - Filter request payload.
 * @param signal - Optional abort signal.
 */
export async function fetchArchetypeFilterReport(
  request: ArchetypeFilterRequest,
  signal?: AbortSignal
): Promise<ArchetypeFilterResponse> {
  const response = await fetchWithTimeout('/api/archetype/filter-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request),
    signal
  });

  const payload = await safeJsonParse(response, '/api/archetype/filter-report');
  validateType(payload, 'object', 'archetype filter report');
  return payload as ArchetypeFilterResponse;
}

/**
 * Fetch tournament metadata (meta.json)
 * @param tournament
 * @returns Promise resolving to meta report
 */
/**
 * Fetch the meta report for a tournament.
 * @param tournament - Tournament identifier.
 */
function fetchMeta(tournament: string): Promise<MetaReport> {
  return fetchReportResource<MetaReport>(
    `${encodeURIComponent(tournament)}/meta.json`,
    `meta for ${tournament}`,
    'object',
    'tournament meta',
    { cache: true }
  );
}

/**
 * Card index entry structure (derived from master.json items)
 */
interface CardIndexEntry {
  found: number;
  total: number;
  pct: number;
  dist?: Array<{ copies: number; players: number; percent: number }>;
  sets: string[];
}

/**
 * Build a card index from master.json report data
 * Transforms the items array into a name-keyed lookup matching the old cardIndex.json format
 * @param report - Tournament report from fetchReport
 * @returns Card index with deckTotal and cards lookup
 */
/**
 * Build a card index map from a master report.
 * @param report - Tournament report.
 */
export function buildCardIndexFromMaster(report: TournamentReport): {
  deckTotal: number;
  cards: Record<string, CardIndexEntry>;
} {
  const cards: Record<string, CardIndexEntry> = {};
  for (const item of report.items || []) {
    const { name } = item;
    if (!name) {
      continue;
    }
    // Aggregate sets for cards with same name (different printings)
    if (cards[name]) {
      if (item.set && !cards[name].sets.includes(item.set)) {
        cards[name].sets.push(item.set);
      }
      continue;
    }
    cards[name] = {
      found: item.found ?? 0,
      total: item.total ?? report.deckTotal ?? 0,
      pct: item.pct ?? 0,
      dist: item.dist as CardIndexEntry['dist'],
      sets: item.set ? [item.set] : []
    };
  }
  return { deckTotal: report.deckTotal ?? 0, cards };
}

/**
 * Fetch raw deck list export (decks.json)
 * @param tournament
 * @returns
 */
/**
 * Fetch full deck lists for a tournament.
 * @param tournament - Tournament identifier.
 */
export function fetchDecks(tournament: string, slice: ReportSlice = 'all'): Promise<any[] | null> {
  const basePath = getSliceBasePath(tournament, slice);
  const relativePath = `${basePath}/decks.json`;
  const urls = buildReportUrls(relativePath);
  const cacheKey = `decks:${relativePath}`;

  const cached = jsonCache.get(cacheKey);
  if (cached !== undefined) {
    logger.debug('Cache hit for decks.json', { tournament, slice });
    return Promise.resolve(cached as any[] | null);
  }
  const pendingDecks = jsonCache.getPromise(cacheKey);
  if (pendingDecks) {
    return pendingDecks as Promise<any[] | null>;
  }

  const loader = (async () => {
    for (const url of urls) {
      try {
        logger.debug(`Fetching decks.json for: ${tournament}`, { slice, url });
        const response = await fetchWithTimeout(url);
        const data = await safeJsonParse(response, url);
        validateType(data, 'array', 'decks');
        return data;
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        logger.debug('decks.json not available via url', {
          slice,
          url,
          message: errMessage
        });
      }
    }
    return null;
  })();

  const tracked = loader
    .then(data => {
      jsonCache.set(cacheKey, data);
      return data;
    })
    .catch(error => {
      jsonCache.delete(cacheKey);
      throw error;
    });

  jsonCache.setPending(cacheKey, tracked);
  return tracked;
}

/**
 * Fetch full participant standings export (players.json).
 * Note: currently available only on the root tournament path.
 */
export function fetchParticipants(tournament: string): Promise<TournamentParticipant[]> {
  const relativePath = `${encodeURIComponent(tournament)}/players.json`;
  return fetchReportResource<TournamentParticipant[]>(
    relativePath,
    `participants for ${tournament}`,
    'array',
    'participants',
    { cache: true }
  );
}

/**
 * Fetch per-player round-by-round match export (playerMatches.json).
 * Note: currently available only on the root tournament path.
 */
export function fetchPlayerMatches(tournament: string): Promise<PlayerMatchRecord[]> {
  const relativePath = `${encodeURIComponent(tournament)}/playerMatches.json`;
  return fetchReportResource<PlayerMatchRecord[]>(
    relativePath,
    `player matches for ${tournament}`,
    'array',
    'player matches',
    {
      cache: true
    }
  );
}

/**
 * Fetch canonical deduped matches export (matches.json).
 * Note: currently available only on the root tournament path.
 */
export function fetchMatches(tournament: string): Promise<CanonicalMatchRecord[]> {
  const relativePath = `${encodeURIComponent(tournament)}/matches.json`;
  return fetchReportResource<CanonicalMatchRecord[]>(relativePath, `matches for ${tournament}`, 'array', 'matches', {
    cache: true
  });
}

/**
 * Fetch top 8 archetypes list (optional endpoint)
 * @param tournament
 * @returns
 */
/**
 * Fetch top 8 archetype list for a tournament.
 * @param tournament - Tournament identifier.
 */
export function fetchTop8ArchetypesList(tournament: string): Promise<string[] | null> {
  const relativePath = `${encodeURIComponent(tournament)}/archetypes/top8.json`;
  const urls = buildReportUrls(relativePath);
  const cacheKey = `top8:${relativePath}`;

  const cachedTop8 = jsonCache.get(cacheKey);
  if (cachedTop8 !== undefined) {
    logger.debug('Cache hit for top8 archetypes', { tournament });
    return Promise.resolve(cachedTop8 as string[] | null);
  }
  const pendingTop8 = jsonCache.getPromise(cacheKey);
  if (pendingTop8) {
    return pendingTop8 as Promise<string[] | null>;
  }

  const loader = (async () => {
    for (const url of urls) {
      try {
        logger.debug(`Fetching top 8 archetypes for: ${tournament}`, { url });
        const response = await fetchWithTimeout(url);
        const data = await safeJsonParse(response, url);

        if (Array.isArray(data)) {
          logger.info(`Loaded ${data.length} top 8 archetypes for ${tournament}`);
          return data;
        }
        logger.warn('Top 8 data is not an array, continuing fallback');
      } catch (error: unknown) {
        const errMessage = error instanceof Error ? error.message : String(error);
        logger.debug(`Top 8 archetypes not available via ${url}`, errMessage);
      }
    }
    return null;
  })();

  const tracked = loader
    .then(data => {
      jsonCache.set(cacheKey, data);
      return data;
    })
    .catch(error => {
      jsonCache.delete(cacheKey);
      throw error;
    });

  jsonCache.setPending(cacheKey, tracked);
  return tracked;
}

/**
 * Fetch pricing data from the pricing API
 * @returns Pricing data with card prices
 */
/**
 * Fetch pricing data and cache it in memory.
 */
function fetchPricingData(): Promise<PricingData> {
  if (pricingData) {
    return Promise.resolve(pricingData);
  }
  if (pricingPromise) {
    return pricingPromise;
  }

  pricingPromise = (async () => {
    try {
      logger.debug('Fetching pricing data...');
      const url = `${CONFIG.API.R2_BASE}/reports/prices.json`;
      const response = await fetchWithTimeout(url);
      const data = await safeJsonParse(response, url);

      validateType(data, 'object', 'pricing data');
      if (!data.cardPrices || typeof data.cardPrices !== 'object') {
        throw new AppError(ErrorTypes.PARSE, 'Invalid pricing data schema');
      }

      pricingData = data;
      logger.info(`Loaded pricing data for ${Object.keys(data.cardPrices).length} cards`);
      return data;
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to fetch pricing data', errMessage);
      pricingPromise = null; // Allow retry on failure
      return { cardPrices: {} };
    }
  })();

  return pricingPromise;
}

// Cache the dynamic synonym import to avoid repeated promise creation on every price lookup
let _synonymModulePromise: Promise<typeof import('./utils/cardSynonyms.js')> | null = null;
function getSynonymModule() {
  return (_synonymModulePromise ??= import('./utils/cardSynonyms.js'));
}

/**
 * Resolve pricing entry for a card, optionally requiring a field on the entry
 * @param cardId
 * @param requiredField
 * @param logLabel
 * @returns
 */
async function resolveCardPricingEntry(
  cardId: string,
  requiredField: string | null,
  logLabel: string
): Promise<any | null> {
  // Check entry-level cache to skip synonym resolution for repeated lookups
  const cacheKey = `${cardId}::${requiredField ?? ''}`;
  if (pricingEntryCache.has(cacheKey)) {
    return pricingEntryCache.get(cacheKey);
  }

  const pricing = await fetchPricingData();
  const cardPrices = pricing.cardPrices || {};

  const getEntry = (candidateId: string) => {
    if (!candidateId) {
      return null;
    }
    const entry = cardPrices[candidateId];
    if (!entry) {
      return null;
    }
    if (requiredField && (entry as any)[requiredField] == null) {
      return null;
    }
    return entry;
  };

  let entry = getEntry(cardId);
  if (entry) {
    pricingEntryCache.set(cacheKey, entry);
    return entry;
  }

  try {
    const { getCanonicalCard, getCardVariants } = await getSynonymModule();

    const canonical = await getCanonicalCard(cardId);
    if (canonical && canonical !== cardId) {
      entry = getEntry(canonical);
      if (entry) {
        logger.debug(`Found ${logLabel} via canonical: ${canonical}`, {
          original: cardId
        });
        pricingEntryCache.set(cacheKey, entry);
        return entry;
      }
    }

    const variants = await getCardVariants(cardId);
    for (const variant of variants) {
      if (variant === cardId) {
        continue;
      }

      entry = getEntry(variant);
      if (entry) {
        logger.debug(`Found ${logLabel} via variant: ${variant}`, {
          original: cardId
        });
        pricingEntryCache.set(cacheKey, entry);
        return entry;
      }
    }
  } catch (synonymError: unknown) {
    const errMessage = synonymError instanceof Error ? synonymError.message : String(synonymError);
    logger.debug(`Synonym resolution failed during ${logLabel} lookup`, errMessage);
  }

  logger.debug(`No ${logLabel} found for ${cardId} or its variants`);
  pricingEntryCache.set(cacheKey, null);
  return null;
}

/**
 * Get price for a specific card (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns Price in USD or null if not found
 */
/**
 * Get the latest price for a card.
 * @param cardId - Card identifier.
 */
export async function getCardPrice(cardId: string): Promise<number | null> {
  if (priceResolutionCache.has(cardId)) {
    return priceResolutionCache.get(cardId)!;
  }
  try {
    const entry = await resolveCardPricingEntry(cardId, 'price', 'price');
    const price = entry?.price ?? null;
    priceResolutionCache.set(cardId, price);
    return price;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Failed to get price for ${cardId}`, errMessage);
    logger.error('Error in getCardPrice:', error);
    priceResolutionCache.set(cardId, null);
    return null;
  }
}

/**
 * Get complete card data (price and TCGPlayer ID) (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns Object with price and tcgPlayerId or null if not found
 */
/**
 * Get card pricing data and TCGPlayer id.
 * @param cardId - Card identifier.
 */
export async function getCardData(cardId: string): Promise<{ price?: number; tcgPlayerId?: string } | null> {
  try {
    const entry = await resolveCardPricingEntry(cardId, null, 'card data');
    return entry ?? null;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Failed to get card data for ${cardId}`, errMessage);
    return null;
  }
}
