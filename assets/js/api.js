/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, safeFetch, withRetry, validateType } from './utils/errorHandler.js';

let pricingData = null;
const jsonCache = new Map();

function hasCachedData(entry) {
  return Object.prototype.hasOwnProperty.call(entry, 'data');
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

function cacheResolvedJson(cacheKey, data, ttl) {
  jsonCache.set(cacheKey, { data, expiresAt: Date.now() + ttl });
  pruneJsonCache();
}

function cachePendingJson(cacheKey, promise, ttl) {
  jsonCache.set(cacheKey, { promise, expiresAt: Date.now() + ttl });
}

export function clearApiCache() {
  jsonCache.clear();
}

function fetchWithTimeout(url, options = {}) {
  return safeFetch(url, { timeout: CONFIG.API.TIMEOUT_MS, ...options });
}

function buildQueryString(params = {}) {
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

function normalizeLimitlessTournament(entry) {
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
 * @param {Response} response
 * @param {string} url
 * @returns {Promise<any>}
 */
async function safeJsonParse(response, url) {
  const contentType = response.headers.get('content-type') || '';

  const text = await response.text();

  if (!text.trim()) {
    throw new AppError(ErrorTypes.PARSE, 'Empty response body', null, { url, contentType });
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
  } catch (error) {
    if (error.name === 'SyntaxError') {
      const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
      throw new AppError(
        ErrorTypes.PARSE,
        `Invalid JSON response: ${error.message}`,
        null,
        { url, contentType, preview }
      );
    }
    throw error;
  }
}

/**
 * Common API fetch wrapper with retry, validation, and logging
 * @template T
 * @param {string} url - API endpoint URL
 * @param {string} operation - Description for logging
 * @param {string} expectedType - Expected data type for validation
 * @param {string} [fieldName] - Field name for validation errors
 * @param {object} [options]
 * @param {boolean} [options.cache]
 * @param {string} [options.cacheKey]
 * @param {number} [options.ttl]
 * @returns {Promise<T>}
 */
function fetchWithRetry(url, operation, expectedType, fieldName, options = {}) {
  const {
    cache = false,
    cacheKey = url,
    ttl = CONFIG.API.JSON_CACHE_TTL_MS
  } = options;

  if (cache) {
    const entry = jsonCache.get(cacheKey);
    const now = Date.now();
    if (entry) {
      if (hasCachedData(entry) && entry.expiresAt > now) {
        logger.debug(`Cache hit for ${operation}`, { cacheKey });
        return Promise.resolve(entry.data);
      }
      if (entry.promise) {
        logger.debug(`Awaiting in-flight request for ${operation}`, { cacheKey });
        return entry.promise;
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
    const count = Array.isArray(data) ? data.length : (data.items?.length || 'unknown');
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
    return fetchPromise;
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
  return trackedPromise;
}

/**
 * Fetch tournaments list
 * @returns {Promise<string[]>}
 */
export function fetchTournamentsList() {
  const url = `${CONFIG.API.REPORTS_BASE}/tournaments.json`;
  return fetchWithRetry(url, 'tournaments list', 'array', 'tournaments list', { cache: true });
}

/**
 * Fetch tournament summaries from the Limitless API via our proxy.
 * @param {{game?: string, format?: string, organizerId?: number|string, limit?: number, page?: number}} [filters]
 * @returns {Promise<Array<{id:string,name:string,game:string|null,format:string|null,date:string|null,players:number|null,source:string}>>}
 */
export async function fetchLimitlessTournaments(filters = {}) {
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

  const payload = await fetchWithRetry(
    url,
    'Limitless tournaments',
    'object',
    'Limitless tournaments payload',
    { cache: true, cacheKey }
  );

  if (!payload || payload.success !== true) {
    throw new AppError(
      ErrorTypes.API,
      'Limitless tournaments request failed',
      null,
      { url, payload }
    );
  }

  if (!Array.isArray(payload.data)) {
    throw new AppError(
      ErrorTypes.DATA_FORMAT,
      'Limitless tournaments response missing data array',
      null,
      { url, payload }
    );
  }

  const normalized = payload.data
    .map(normalizeLimitlessTournament)
    .filter(Boolean);

  logger.info('Fetched Limitless tournaments', {
    query: params,
    count: normalized.length
  });

  return normalized;
}

/**
 * Fetch tournament report data
 * @param {string} tournament
 * @returns {Promise<object>}
 */
export function fetchReport(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/master.json`;
  return fetchWithRetry(
    url,
    `report for ${tournament}`,
    'object',
    'tournament report',
    { cache: true }
  );
}

/**
 * Fetch thumbnail overrides configuration
 * @returns {Promise<object>}
 */
export async function fetchOverrides() {
  try {
    const url = '/assets/overrides.json';
    const data = await fetchWithRetry(
      url,
      'thumbnail overrides',
      'object',
      'thumbnail overrides',
      { cache: true, cacheKey: 'thumbnail-overrides' }
    );
    logger.debug(`Loaded ${Object.keys(data).length} thumbnail overrides`);
    return data;
  } catch (error) {
    logger.warn('Failed to load overrides, using empty object', error.message);
    return {};
  }
}

/**
 * Fetch archetype list for a tournament
 * @param {string} tournament
 * @returns {Promise<string[]>}
 */
export function fetchArchetypesList(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/index.json`;
  return fetchWithRetry(
    url,
    `archetypes for ${tournament}`,
    'array',
    'archetypes list',
    { cache: true }
  );
}

/**
 * Fetch archetype JSON payload with common retry/error handling
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.validateLabel
 * @param {(data: object, context: { isRetry: boolean }) => void} [options.onSuccess]
 * @param {{ message: string, meta?: object }} [options.notFoundLog]
 * @param {boolean} [options.logOnRetry] - Defaults to true.
 * @returns {Promise<object>}
 */
async function fetchArchetypeData({
  url,
  validateLabel,
  onSuccess,
  notFoundLog,
  logOnRetry = true
}) {
  const attempt = async isRetry => {
    const response = await fetchWithTimeout(url);
    const data = await safeJsonParse(response, url);
    validateType(data, 'object', validateLabel);
    if (onSuccess && (!isRetry || logOnRetry)) {
      onSuccess(data, { isRetry });
    }
    return data;
  };

  try {
    return await attempt(false);
  } catch (error) {
    if (error instanceof AppError && error.context?.status === 404) {
      if (notFoundLog) {
        logger.debug(notFoundLog.message, notFoundLog.meta);
      }
      throw error;
    }

    return withRetry(() => attempt(true), CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
  }
}

/**
 * Fetch specific archetype report data
 * @param {string} tournament
 * @param {string} archetypeBase
 * @returns {Promise<object>}
 * @throws {AppError}
 */
export function fetchArchetypeReport(tournament, archetypeBase) {
  logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`);
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;

  return fetchArchetypeData({
    url,
    validateLabel: 'archetype report',
    onSuccess: data => {
      logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, { itemCount: data.items?.length });
    },
    notFoundLog: {
      message: `Archetype ${archetypeBase} not found for ${tournament}`,
      meta: { url }
    }
  });
}

/**
 * Fetch include/exclude filtered archetype report data
 * Uses the new deduplicated structure with index.json + unique_subsets/
 * @param {string} tournament
 * @param {string} archetypeBase
 * @param {string|null} includeId
 * @param {string|null} excludeId
 * @returns {Promise<object>}
 */
export async function fetchArchetypeFiltersReport(tournament, archetypeBase, includeId, excludeId) {
  // If both include and exclude are null, fetch the base archetype report
  const isBaseReport = !includeId && !excludeId;

  if (isBaseReport) {
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;
    logger.debug('Fetching base archetype report', { tournament, archetypeBase, url });

    return fetchArchetypeData({
      url,
      validateLabel: 'archetype report',
      onSuccess: data => {
        logger.info(`Loaded base archetype report ${archetypeBase}`, {
          deckTotal: data.deckTotal
        });
      },
      notFoundLog: {
        message: 'Base archetype report not found',
        meta: { tournament, archetypeBase }
      },
      logOnRetry: false
    });
  }

  // Use the new deduplicated structure via archetypeCache
  const { archetypeCache } = await import('./utils/archetypeCache.js');

  logger.debug('Fetching filtered archetype report via cache', {
    tournament,
    archetypeBase,
    include: includeId,
    exclude: excludeId
  });

  try {
    const data = await archetypeCache.getFilteredData(tournament, archetypeBase, includeId, excludeId);
    validateType(data, 'object', 'archetype include/exclude report');
    logger.info(`Loaded filtered archetype report ${archetypeBase}`, {
      include: includeId,
      exclude: excludeId,
      deckTotal: data.deckTotal
    });
    return data;
  } catch (error) {
    if (error instanceof AppError && error.context?.status === 404) {
      logger.debug('Filtered archetype report not found', {
        tournament,
        archetypeBase,
        include: includeId,
        exclude: excludeId
      });
      throw error;
    }

    // Retry logic is already built into archetypeCache
    throw error;
  }
}

/**
 * Fetch tournament metadata (meta.json)
 * @param {string} tournament
 * @returns {Promise<object>}
 */
export function fetchMeta(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/meta.json`;
  return fetchWithRetry(
    url,
    `meta for ${tournament}`,
    'object',
    'tournament meta',
    { cache: true }
  );
}

/**
 * Fetch per-tournament card index (cardIndex.json)
 * @param {string} tournament
 * @returns {Promise<{deckTotal:number, cards: Record<string, any>}>}
 */
export async function fetchCardIndex(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/cardIndex.json`;
  const data = await fetchWithRetry(
    url,
    `card index for ${tournament}`,
    'object',
    'card index',
    { cache: true }
  );
  if (typeof data.deckTotal !== 'number' || !data.cards || typeof data.cards !== 'object') {
    throw new AppError(ErrorTypes.PARSE, 'Invalid card index schema', null, { tournament });
  }
  return data;
}

/**
 * Fetch raw deck list export (decks.json)
 * @param {string} tournament
 * @returns {Promise<Array|null>}
 */
export function fetchDecks(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/decks.json`;
  const cacheKey = `decks:${url}`;
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
    try {
      logger.debug(`Fetching decks.json for: ${tournament}`);
      const response = await fetchWithTimeout(url);
      const data = await safeJsonParse(response, url);
      validateType(data, 'array', 'decks');
      return data;
    } catch (err) {
      logger.debug('decks.json not available', err.message);
      return null;
    }
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
 * @param {string} tournament
 * @returns {Promise<string[]|null>}
 */
export function fetchTop8ArchetypesList(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/top8.json`;
  const cacheKey = `top8:${url}`;
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
    try {
      logger.debug(`Fetching top 8 archetypes for: ${tournament}`);
      const response = await fetchWithTimeout(url);
      const data = await safeJsonParse(response, url);

      if (Array.isArray(data)) {
        logger.info(`Loaded ${data.length} top 8 archetypes for ${tournament}`);
        return data;
      }

      logger.warn('Top 8 data is not an array, returning null');
      return null;
    } catch (error) {
      logger.debug(`Top 8 archetypes not available for ${tournament}`, error.message);
      return null;
    }
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
 * @returns {Promise<object>} Pricing data with card prices
 */
export async function fetchPricingData() {
  if (pricingData) {
    return pricingData;
  }

  try {
    logger.debug('Fetching pricing data...');
    const url = 'https://ciphermaniac.com/api/get-prices';
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
  } catch (error) {
    logger.warn('Failed to fetch pricing data', error.message);
    return { cardPrices: {} };
  }
}

/**
 * Resolve pricing entry for a card, optionally requiring a field on the entry
 * @param {string} cardId
 * @param {string|null} requiredField
 * @param {string} logLabel
 * @returns {Promise<object|null>}
 */
async function resolveCardPricingEntry(cardId, requiredField, logLabel) {
  const pricing = await fetchPricingData();
  const cardPrices = pricing.cardPrices || {};

  const getEntry = candidateId => {
    if (!candidateId) {return null;}
    const entry = cardPrices[candidateId];
    if (!entry) {return null;}
    if (requiredField && entry[requiredField] == null) {return null;}
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
        logger.debug(`Found ${logLabel} via canonical: ${canonical}`, { original: cardId });
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
        logger.debug(`Found ${logLabel} via variant: ${variant}`, { original: cardId });
        return entry;
      }
    }
  } catch (synonymError) {
    logger.debug(`Synonym resolution failed during ${logLabel} lookup`, synonymError.message);
  }

  logger.debug(`No ${logLabel} found for ${cardId} or its variants`);
  return null;
}

/**
 * Get price for a specific card (with canonical fallback)
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<number|null>} Price in USD or null if not found
 */
export async function getCardPrice(cardId) {
  try {
    const entry = await resolveCardPricingEntry(cardId, 'price', 'price');
    return entry?.price ?? null;
  } catch (error) {
    logger.debug(`Failed to get price for ${cardId}`, error.message);
    logger.error('Error in getCardPrice:', error);
    return null;
  }
}

/**
 * Get TCGPlayer ID for a specific card (with canonical fallback)
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<string|null>} TCGPlayer ID or null if not found
 */
export async function getCardTCGPlayerId(cardId) {
  try {
    const entry = await resolveCardPricingEntry(cardId, 'tcgPlayerId', 'TCGPlayer ID');
    return entry?.tcgPlayerId ?? null;
  } catch (error) {
    logger.debug(`Failed to get TCGPlayer ID for ${cardId}`, error.message);
    return null;
  }
}

/**
 * Get complete card data (price and TCGPlayer ID) (with canonical fallback)
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<object | null>} Object with price and tcgPlayerId or null if not found
 */
export async function getCardData(cardId) {
  try {
    const entry = await resolveCardPricingEntry(cardId, null, 'card data');
    return entry ?? null;
  } catch (error) {
    logger.debug(`Failed to get card data for ${cardId}`, error.message);
    return null;
  }
}
