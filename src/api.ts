/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, safeFetch, validateType, withRetry } from './utils/errorHandler.js';
import { perf } from './utils/performance.js';
import { clearDatabaseCache, loadDatabase } from './lib/database.js';
import type {
  ArchetypeIndexEntry,
  ArchetypeReport,
  CacheEntry,
  LimitlessResponse,
  LimitlessTournament,
  MetaReport,
  PricingData,
  TournamentReport,
  TrendReport,
  TrendReportPayload
} from './types/index.js';

export type {
  ArchetypeIndexEntry,
  LimitlessTournament,
  MetaReport,
  PricingData,
  TournamentReport,
  TrendReport,
  TrendReportPayload
};

let pricingData: PricingData | null = null;
const jsonCache = new Map<string, CacheEntry>();
export const ONLINE_META_NAME = 'Online - Last 14 Days';
// const _ONLINE_META_SEGMENT = `/${encodeURIComponent(ONLINE_META_NAME)}`; // Reserved for future use

function hasCachedData(entry: CacheEntry): entry is CacheEntry & { data: unknown } {
  return 'data' in entry;
}

function pruneJsonCache() {
  if (jsonCache.size <= CONFIG.CACHE.CLEANUP_THRESHOLD) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of jsonCache.entries()) {
    if (!entry.promise && entry.expiresAt <= now) {
      jsonCache.delete(key);
    }
  }

  if (jsonCache.size <= CONFIG.CACHE.MAX_ENTRIES) {
    return;
  }

  const reclaimable = Array.from(jsonCache.entries())
    .filter(([, entry]) => !entry.promise)
    .sort((entryA, entryB) => (entryA[1].expiresAt || 0) - (entryB[1].expiresAt || 0));

  for (const [key] of reclaimable) {
    if (jsonCache.size <= CONFIG.CACHE.MAX_ENTRIES) {
      break;
    }
    jsonCache.delete(key);
  }
}

function cacheResolvedJson(cacheKey: string, data: any, ttl: number) {
  jsonCache.set(cacheKey, { data, expiresAt: Date.now() + ttl });
  pruneJsonCache();
}

function cachePendingJson(cacheKey: string, promise: Promise<any>, ttl: number) {
  jsonCache.set(cacheKey, { promise, expiresAt: Date.now() + ttl });
}

export function clearApiCache() {
  jsonCache.clear();
  clearDatabaseCache();
}

function fetchWithTimeout(url: string, options: RequestInit = {}) {
  return safeFetch(url, { timeout: CONFIG.API.TIMEOUT_MS, ...options });
}

function buildQueryString(params: Record<string, any> = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const normalized = typeof value === 'number' ? String(value) : String(value).trim();
    if (normalized) {
      query.set(key, normalized);
    }
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function normalizeLimitlessTournament(entry: unknown): LimitlessTournament | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : String(record.id ?? '').trim();
  if (!id) {
    return null;
  }

  return {
    id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Unnamed Tournament',
    game: typeof record.game === 'string' ? record.game.trim() : null,
    format: typeof record.format === 'string' ? record.format.trim() : null,
    date: typeof record.date === 'string' ? record.date : null,
    players: typeof record.players === 'number' ? record.players : null,
    source: 'limitless'
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

  if (!text.trim()) {
    throw new AppError(ErrorTypes.PARSE, 'Empty response body', null, {
      url,
      contentType
    });
  }

  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
    throw new AppError(
      ErrorTypes.PARSE,
      `Expected JSON response but got ${contentType || 'unknown content type'}`,
      null,
      { url, contentType, preview }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.name === 'SyntaxError') {
      const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
      throw new AppError(ErrorTypes.PARSE, `Invalid JSON response: ${err.message}`, null, {
        url,
        contentType,
        preview
      });
    }
    throw err;
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
    const entry = jsonCache.get(cacheKey);
    const now = Date.now();
    if (entry) {
      if (hasCachedData(entry) && entry.expiresAt > now) {
        logger.debug(`Cache hit for ${operation}`, { cacheKey });
        return Promise.resolve(entry.data as T);
      }
      if (entry.promise) {
        logger.debug(`Awaiting in-flight request for ${operation}`, {
          cacheKey
        });
        return entry.promise as Promise<T>;
      }
      if (!entry.promise && entry.expiresAt <= now) {
        jsonCache.delete(cacheKey);
      }
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
    delayMs: CONFIG.API.RETRY_DELAY_MS
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
      cacheResolvedJson(cacheKey, data, ttl);
      return data;
    })
    .catch(error => {
      const entry = jsonCache.get(cacheKey);
      if (entry && entry.promise === trackedPromise) {
        jsonCache.delete(cacheKey);
      }
      throw error;
    });

  cachePendingJson(cacheKey, trackedPromise, ttl);
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
 * Fetch report resource
 * @param relativePath
 * @param operation
 * @param expectedType
 * @param fieldName
 * @param options
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
 * Fetch tournaments list
 */
export function fetchTournamentsList(): Promise<string[]> {
  return fetchReportResource<string[]>('tournaments.json', 'tournaments list', 'array', 'tournaments list', {
    cache: true
  });
}

interface LimitlessFilters {
  game?: string;
  format?: string;
  organizerId?: number | string;
  limit?: number;
  page?: number;
}

/**
 * Fetch tournament summaries from the Limitless API via our proxy.
 * @param filters
 * @returns
 */
export async function fetchLimitlessTournaments(filters: LimitlessFilters = {}): Promise<LimitlessTournament[]> {
  const {
    game = CONFIG.API.LIMITLESS_DEFAULT_GAME,
    format,
    organizerId,
    limit = CONFIG.API.LIMITLESS_DEFAULT_LIMIT,
    page
  } = filters;

  const params = {
    ...(game ? { game } : {}),
    ...(format ? { format } : {}),
    ...(organizerId ? { organizerId } : {}),
    ...(limit ? { limit } : {}),
    ...(page ? { page } : {})
  };

  const query = buildQueryString(params);
  const baseUrl = `${CONFIG.API.LIMITLESS_BASE}/tournaments`;
  const url = `${baseUrl}${query}`;
  const cacheKey = `limitless:tournaments:${query || 'default'}`;

  const payload = await fetchWithRetry<LimitlessResponse>(
    url,
    'Limitless tournaments',
    'object',
    'Limitless tournaments payload',
    {
      cache: true,
      cacheKey
    }
  );

  if (!payload || payload.success !== true) {
    throw new AppError(ErrorTypes.API, 'Limitless tournaments request failed', null, { url, payload });
  }

  if (!Array.isArray(payload.data)) {
    throw new AppError(ErrorTypes.DATA_FORMAT, 'Limitless tournaments response missing data array', null, {
      url,
      payload
    });
  }

  const normalized = payload.data
    .map(normalizeLimitlessTournament)
    .filter((tournament): tournament is LimitlessTournament => Boolean(tournament));

  logger.info('Fetched Limitless tournaments', {
    query: params,
    count: normalized.length
  });

  return normalized;
}

/**
 * Fetch master report for a tournament - tries SQLite first, falls back to JSON
 * @param tournament
 * @returns Promise resolving to tournament report
 */
export async function fetchReport(tournament: string): Promise<TournamentReport> {
  perf.start(`fetchReport:${tournament}`);
  try {
    const db = await loadDatabase(tournament);
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
    logger.debug(`Loaded tournament report from SQLite for ${tournament}`, { deckTotal, itemCount: items.length });
    return { deckTotal, items };
  } catch (dbError) {
    logger.debug('SQLite report failed, falling back to JSON', {
      tournament,
      error: dbError instanceof Error ? dbError.message : String(dbError)
    });
    const encodedTournament = encodeURIComponent(tournament);
    return fetchReportResource<TournamentReport>(
      `${encodedTournament}/master.json`,
      `report for ${tournament}`,
      'object',
      'tournament report',
      { cache: true }
    );
  } finally {
    perf.end(`fetchReport:${tournament}`);
  }
}

/**
 * Fetch archetype trend data for a tournament group
 * @param tournament
 * @returns Promise resolving to trend report payload
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
 * Fetch thumbnail overrides configuration
 * @returns
 */
export async function fetchOverrides(): Promise<Record<string, string>> {
  try {
    const url = '/assets/overrides.json';
    const data = await fetchWithRetry<Record<string, string>>(
      url,
      'thumbnail overrides',
      'object',
      'thumbnail overrides',
      {
        cache: true,
        cacheKey: 'thumbnail-overrides'
      }
    );
    logger.debug(`Loaded ${Object.keys(data).length} thumbnail overrides`);
    return data;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to load overrides, using empty object', errMessage);
    return {};
  }
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
      thumbnails: []
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
    return {
      name,
      label,
      deckCount,
      percent,
      thumbnails
    };
  }
  return null;
}

/**
 * Fetch archetypes list
 * @param tournament
 */
export async function fetchArchetypesList(tournament: string): Promise<ArchetypeIndexEntry[]> {
  const result = await fetchReportResource<any[]>(
    `${encodeURIComponent(tournament)}/archetypes/index.json`,
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
 * Fetch specific archetype report data (cards.json)
 * Uses new folder structure: /archetypes/{archetype}/cards.json
 * Falls back to legacy path: /archetypes/{archetype}.json
 * @param tournament
 * @param archetypeBase
 * @returns Promise resolving to archetype report
 * @throws AppError
 */
export async function fetchArchetypeReport(tournament: string, archetypeBase: string): Promise<ArchetypeReport> {
  logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`);

  // Try new folder structure first: /archetypes/Gardevoir/cards.json
  const newPath = `${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/cards.json`;
  // Legacy flat file path: /archetypes/Gardevoir.json
  const legacyPath = `${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;

  try {
    return await fetchReportResource(
      newPath,
      `archetype report ${archetypeBase} for ${tournament}`,
      'object',
      'archetype report',
      { cache: true }
    ).then(data => {
      logger.info(`Loaded archetype report ${archetypeBase} for ${tournament} (new path)`, {
        itemCount: data.items?.length
      });
      return data;
    });
  } catch (newPathError: unknown) {
    // Fall back to legacy path if new path fails
    if (newPathError instanceof AppError && newPathError.context?.status === 404) {
      logger.debug(`New path not found, trying legacy path: ${legacyPath}`);
      try {
        return await fetchReportResource(
          legacyPath,
          `archetype report ${archetypeBase} for ${tournament}`,
          'object',
          'archetype report',
          { cache: true }
        ).then(data => {
          logger.info(`Loaded archetype report ${archetypeBase} for ${tournament} (legacy path)`, {
            itemCount: data.items?.length
          });
          return data;
        });
      } catch {
        // If legacy also fails, throw the original error
      }
    }
    throw newPathError;
  }
}

/**
 * Fetch archetype-specific deck data (decks.json)
 * Uses new folder structure: /archetypes/{archetype}/decks.json
 * Falls back to main decks.json with filtering if the archetype-specific file doesn't exist
 * @param tournament
 * @param archetypeBase
 * @returns
 * @throws AppError
 */
export async function fetchArchetypeDecks(tournament: string, archetypeBase: string): Promise<any[] | null> {
  logger.debug(`Fetching archetype decks: ${tournament}/${archetypeBase}`);

  // Try new folder structure: /archetypes/Gardevoir/decks.json
  const archetypeDecksPath = `${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/decks.json`;

  try {
    const data = await fetchReportResource<any[]>(
      archetypeDecksPath,
      `archetype decks ${archetypeBase} for ${tournament}`,
      'array',
      'archetype decks',
      { cache: true }
    );
    logger.info(`Loaded archetype-specific decks for ${archetypeBase}`, { deckCount: data?.length || 0 });
    return data;
  } catch (error: unknown) {
    if (error instanceof AppError && error.context?.status === 404) {
      logger.debug(`Archetype-specific decks not found for ${archetypeBase}, falling back to main decks.json`);
      // Fall back to main decks.json - caller will need to filter
      return null;
    }
    throw error;
  }
}

/**
 * Fetch include/exclude filtered archetype report data
 * Performs all filtering client-side using deck data
 * Uses archetype-specific decks.json when available for better performance
 * @param tournament
 * @param archetypeBase
 * @param includeId
 * @param excludeId
 * @param includeOperator - Quantity operator (=, <, <=, >, >=)
 * @param includeCount - Quantity threshold
 * @returns
 */
export async function fetchArchetypeFiltersReport(
  tournament: string,
  archetypeBase: string,
  includeId: string | null,
  excludeId: string | null,
  includeOperator: '=' | '<' | '<=' | '>' | '>=' | null = null,
  includeCount: number | null = null
): Promise<any> {
  // If both include and exclude are null, fetch the base archetype report
  const isBaseReport = !includeId && !excludeId;

  if (isBaseReport) {
    // Use fetchArchetypeReport which handles both new and legacy paths
    logger.debug('Fetching base archetype report', {
      tournament,
      archetypeBase
    });

    return fetchArchetypeReport(tournament, archetypeBase).then(data => {
      logger.info(`Loaded base archetype report ${archetypeBase}`, {
        deckTotal: data.deckTotal
      });
      return data;
    });
  }

  // Use client-side filtering for all filtered reports
  const { fetchAllDecks, generateFilteredReport } = await import('./utils/clientSideFiltering.js');

  logger.debug('Generating filtered archetype report client-side', {
    tournament,
    archetypeBase,
    include: includeId,
    includeOperator,
    includeCount,
    exclude: excludeId
  });

  try {
    // Try to use archetype-specific decks.json for better performance
    const archetypeDecks = await fetchArchetypeDecks(tournament, archetypeBase);

    // If archetype-specific decks available, use them directly (already filtered by archetype)
    if (archetypeDecks) {
      logger.debug(`Using archetype-specific decks for ${archetypeBase}`, {
        deckCount: archetypeDecks.length
      });
      const report = generateFilteredReport(
        archetypeDecks,
        archetypeBase,
        includeId,
        excludeId,
        includeOperator,
        includeCount
      );
      logger.info(`Generated filtered archetype report ${archetypeBase} from archetype-specific decks`, {
        include: includeId,
        includeOperator,
        includeCount,
        exclude: excludeId,
        deckTotal: report.deckTotal
      });
      return report;
    }

    // Fall back to main decks.json and filter by archetype
    const allDecks = await fetchAllDecks(tournament);
    const report = generateFilteredReport(allDecks, archetypeBase, includeId, excludeId, includeOperator, includeCount);

    logger.info(`Generated filtered archetype report ${archetypeBase} from full decks.json`, {
      include: includeId,
      includeOperator,
      includeCount,
      exclude: excludeId,
      deckTotal: report.deckTotal
    });

    return report;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error('Client-side filtering failed', {
      tournament,
      archetypeBase,
      include: includeId,
      includeOperator,
      includeCount,
      exclude: excludeId,
      message: errMessage
    });
    throw error;
  }
}

/**
 * Fetch tournament metadata (meta.json)
 * @param tournament
 * @returns Promise resolving to meta report
 */
export function fetchMeta(tournament: string): Promise<MetaReport> {
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
export function fetchDecks(tournament: string): Promise<any[] | null> {
  const relativePath = `${encodeURIComponent(tournament)}/decks.json`;
  const urls = buildReportUrls(relativePath);
  const cacheKey = `decks:${relativePath}`;
  const now = Date.now();
  const existing = jsonCache.get(cacheKey);

  if (existing) {
    if (hasCachedData(existing) && existing.expiresAt > now) {
      logger.debug('Cache hit for decks.json', { tournament });
      return Promise.resolve(existing.data as any[] | null);
    }
    if (existing.promise) {
      return existing.promise as Promise<any[] | null>;
    }
    if (!existing.promise && existing.expiresAt <= now) {
      jsonCache.delete(cacheKey);
    }
  }

  const loader = (async () => {
    for (const url of urls) {
      try {
        logger.debug(`Fetching decks.json for: ${tournament}`, { url });
        const response = await fetchWithTimeout(url);
        const data = await safeJsonParse(response, url);
        validateType(data, 'array', 'decks');
        return data;
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        logger.debug('decks.json not available via url', {
          url,
          message: errMessage
        });
      }
    }
    return null;
  })();

  const tracked = loader
    .then(data => {
      cacheResolvedJson(cacheKey, data, CONFIG.API.JSON_CACHE_TTL_MS);
      return data;
    })
    .catch(error => {
      const entry = jsonCache.get(cacheKey);
      if (entry && entry.promise === tracked) {
        jsonCache.delete(cacheKey);
      }
      throw error;
    });

  cachePendingJson(cacheKey, tracked, CONFIG.API.JSON_CACHE_TTL_MS);
  return tracked;
}

/**
 * Fetch top 8 archetypes list (optional endpoint)
 * @param tournament
 * @returns
 */
export function fetchTop8ArchetypesList(tournament: string): Promise<string[] | null> {
  const relativePath = `${encodeURIComponent(tournament)}/archetypes/top8.json`;
  const urls = buildReportUrls(relativePath);
  const cacheKey = `top8:${relativePath}`;
  const now = Date.now();
  const existing = jsonCache.get(cacheKey);

  if (existing) {
    if (hasCachedData(existing) && existing.expiresAt > now) {
      logger.debug('Cache hit for top8 archetypes', { tournament });
      return Promise.resolve(existing.data as string[] | null);
    }
    if (existing.promise) {
      return existing.promise as Promise<string[] | null>;
    }
    if (!existing.promise && existing.expiresAt <= now) {
      jsonCache.delete(cacheKey);
    }
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
      cacheResolvedJson(cacheKey, data, CONFIG.API.JSON_CACHE_TTL_MS);
      return data;
    })
    .catch(error => {
      const entry = jsonCache.get(cacheKey);
      if (entry && entry.promise === tracked) {
        jsonCache.delete(cacheKey);
      }
      throw error;
    });

  cachePendingJson(cacheKey, tracked, CONFIG.API.JSON_CACHE_TTL_MS);
  return tracked;
}

/**
 * Fetch pricing data from the pricing API
 * @returns Pricing data with card prices
 */
export async function fetchPricingData(): Promise<PricingData> {
  if (pricingData) {
    return pricingData;
  }

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
    return { cardPrices: {} };
  }
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
    return entry;
  }

  try {
    const { getCanonicalCard, getCardVariants } = await import('./utils/cardSynonyms.js');

    const canonical = await getCanonicalCard(cardId);
    if (canonical && canonical !== cardId) {
      entry = getEntry(canonical);
      if (entry) {
        logger.debug(`Found ${logLabel} via canonical: ${canonical}`, {
          original: cardId
        });
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
        return entry;
      }
    }
  } catch (synonymError: unknown) {
    const errMessage = synonymError instanceof Error ? synonymError.message : String(synonymError);
    logger.debug(`Synonym resolution failed during ${logLabel} lookup`, errMessage);
  }

  logger.debug(`No ${logLabel} found for ${cardId} or its variants`);
  return null;
}

/**
 * Get price for a specific card (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns Price in USD or null if not found
 */
export async function getCardPrice(cardId: string): Promise<number | null> {
  try {
    const entry = await resolveCardPricingEntry(cardId, 'price', 'price');
    return entry?.price ?? null;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Failed to get price for ${cardId}`, errMessage);
    logger.error('Error in getCardPrice:', error);
    return null;
  }
}

/**
 * Get TCGPlayer ID for a specific card (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns TCGPlayer ID or null if not found
 */
export async function getCardTCGPlayerId(cardId: string): Promise<string | null> {
  try {
    const entry = await resolveCardPricingEntry(cardId, 'tcgPlayerId', 'TCGPlayer ID');
    return entry?.tcgPlayerId ?? null;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Failed to get TCGPlayer ID for ${cardId}`, errMessage);
    return null;
  }
}

/**
 * Get complete card data (price and TCGPlayer ID) (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns Object with price and tcgPlayerId or null if not found
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
