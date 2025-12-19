/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, safeFetch, validateType, withRetry } from './utils/errorHandler.js';

interface CacheEntry<T = any> {
  data?: T;
  promise?: Promise<T>;
  expiresAt: number;
}

interface LimitlessTournament {
  id: string;
  name: string;
  game: string | null;
  format: string | null;
  date: string | null;
  players: number | null;
  source: 'limitless';
}

interface LimitlessResponse {
  success: boolean;
  data: any[];
}

interface PricingData {
  cardPrices: Record<string, { price?: number; tcgPlayerId?: string }>;
}

interface ArchetypeIndexEntry {
  name: string;
  label: string;
  deckCount: number | null;
  percent: number | null;
  thumbnails: string[];
}

let pricingData: PricingData | null = null;
const jsonCache = new Map<string, CacheEntry>();
export const ONLINE_META_NAME = 'Online - Last 14 Days';
// const _ONLINE_META_SEGMENT = `/${encodeURIComponent(ONLINE_META_NAME)}`; // Reserved for future use

function hasCachedData(entry: CacheEntry): entry is CacheEntry & { data: any } {
  return Object.hasOwn(entry, 'data');
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

function normalizeLimitlessTournament(entry: any): LimitlessTournament | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : String(entry.id ?? '').trim();
  if (!id) {
    return null;
  }

  return {
    id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Unnamed Tournament',
    game: typeof entry.game === 'string' ? entry.game.trim() : null,
    format: typeof entry.format === 'string' ? entry.format.trim() : null,
    date: typeof entry.date === 'string' ? entry.date : null,
    players: typeof entry.players === 'number' ? entry.players : null,
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
  } catch (error: any) {
    if (error.name === 'SyntaxError') {
      const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
      throw new AppError(ErrorTypes.PARSE, `Invalid JSON response: ${error.message}`, null, {
        url,
        contentType,
        preview
      });
    }
    throw error;
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

  const fetchPromise = withRetry(loader, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS).catch(error => {
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
    } catch (error: any) {
      lastError = error;
      logger.warn(`${operation} failed via ${url}`, {
        message: error?.message || error
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
 * Fetch tournament report data
 * @param tournament
 * @returns
 */
export function fetchReport(tournament: string): Promise<any> {
  const encodedTournament = encodeURIComponent(tournament);
  return fetchReportResource(
    `${encodedTournament}/master.json`,
    `report for ${tournament}`,
    'object',
    'tournament report',
    { cache: true }
  );
}

/**
 * Fetch archetype trend data for a tournament group
 * @param tournament
 * @returns
 */
export function fetchTrendReport(tournament: string): Promise<any> {
  const encodedTournament = encodeURIComponent(tournament);
  return fetchReportResource(`${encodedTournament}/trends.json`, `trends for ${tournament}`, 'object', 'trend report', {
    cache: true
  });
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
  } catch (error: any) {
    logger.warn('Failed to load overrides, using empty object', error.message);
    return {};
  }
}

/**
 * Normalize a single archetype index entry into a consistent object.
 * @param entry
 * @returns
 */
function normalizeArchetypeIndexEntry(entry: any): ArchetypeIndexEntry | null {
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
    const name = String(entry.name || entry.base || entry.id || '').trim();
    if (!name) {
      return null;
    }
    const label = entry.label || entry.display || name.replace(/_/g, ' ');
    const deckCount = Number.isFinite(entry.deckCount) ? Number(entry.deckCount) : null;
    const percentValue = Number(entry.percent);
    const percent = Number.isFinite(percentValue) ? percentValue : null;
    const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails.filter(Boolean) : [];
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
 * @returns
 * @throws AppError
 */
export async function fetchArchetypeReport(tournament: string, archetypeBase: string): Promise<any> {
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
  } catch (newPathError: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
    logger.error('Client-side filtering failed', {
      tournament,
      archetypeBase,
      include: includeId,
      includeOperator,
      includeCount,
      exclude: excludeId,
      message: error?.message || error
    });
    throw error;
  }
}

/**
 * Fetch tournament metadata (meta.json)
 * @param tournament
 * @returns
 */
export function fetchMeta(tournament: string): Promise<any> {
  return fetchReportResource(
    `${encodeURIComponent(tournament)}/meta.json`,
    `meta for ${tournament}`,
    'object',
    'tournament meta',
    { cache: true }
  );
}

/**
 * Fetch per-tournament card index (cardIndex.json)
 * @param tournament
 * @returns
 */
export async function fetchCardIndex(tournament: string): Promise<{ deckTotal: number; cards: Record<string, any> }> {
  const data = await fetchReportResource(
    `${encodeURIComponent(tournament)}/cardIndex.json`,
    `card index for ${tournament}`,
    'object',
    'card index',
    { cache: true }
  );
  if (typeof data.deckTotal !== 'number' || !data.cards || typeof data.cards !== 'object') {
    throw new AppError(ErrorTypes.PARSE, 'Invalid card index schema', null, {
      tournament
    });
  }
  return data;
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
      return Promise.resolve(existing.data);
    }
    if (existing.promise) {
      return existing.promise;
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
      } catch (err: any) {
        logger.debug('decks.json not available via url', {
          url,
          message: err.message
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
      return Promise.resolve(existing.data);
    }
    if (existing.promise) {
      return existing.promise;
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
      } catch (error: any) {
        logger.debug(`Top 8 archetypes not available via ${url}`, error.message);
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

    // eslint-disable-next-line require-atomic-updates
    pricingData = data;
    logger.info(`Loaded pricing data for ${Object.keys(data.cardPrices).length} cards`);
    return data;
  } catch (error: any) {
    logger.warn('Failed to fetch pricing data', error.message);
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
  } catch (synonymError: any) {
    logger.debug(`Synonym resolution failed during ${logLabel} lookup`, synonymError.message);
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
  } catch (error: any) {
    logger.debug(`Failed to get price for ${cardId}`, error.message);
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
  } catch (error: any) {
    logger.debug(`Failed to get TCGPlayer ID for ${cardId}`, error.message);
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
  } catch (error: any) {
    logger.debug(`Failed to get card data for ${cardId}`, error.message);
    return null;
  }
}
