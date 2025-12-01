/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, safeFetch, validateType, withRetry } from './utils/errorHandler.js';
let pricingData = null;
const jsonCache = new Map();
export const ONLINE_META_NAME = 'Online - Last 14 Days';
// const _ONLINE_META_SEGMENT = `/${encodeURIComponent(ONLINE_META_NAME)}`; // Reserved for future use
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
 * @param response
 * @param url
 * @returns
 */
async function safeJsonParse(response, url) {
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
        throw new AppError(ErrorTypes.PARSE, `Expected JSON response but got ${contentType || 'unknown content type'}`, null, { url, contentType, preview });
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
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
/**
 * Common API fetch wrapper with retry, validation, and logging
 * @param url - API endpoint URL
 * @param operation - Description for logging
 * @param expectedType - Expected data type for validation
 * @param fieldName - Field name for validation errors
 * @param options
 * @returns
 */
function fetchWithRetry(url, operation, expectedType, fieldName, options = {}) {
    const { cache = false, cacheKey = url, ttl = CONFIG.API.JSON_CACHE_TTL_MS } = options;
    if (cache) {
        const entry = jsonCache.get(cacheKey);
        const now = Date.now();
        if (entry) {
            if (hasCachedData(entry) && entry.expiresAt > now) {
                logger.debug(`Cache hit for ${operation}`, { cacheKey });
                return Promise.resolve(entry.data);
            }
            if (entry.promise) {
                logger.debug(`Awaiting in-flight request for ${operation}`, {
                    cacheKey
                });
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
function buildReportUrls(relativePath) {
    const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    const urls = [];
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
export async function fetchReportResource(relativePath, operation, expectedType, fieldName, options = {}) {
    const urls = buildReportUrls(relativePath);
    let lastError = null;
    for (const url of urls) {
        try {
            return await fetchWithRetry(url, operation, expectedType, fieldName, {
                ...options,
                cacheKey: url
            });
        }
        catch (error) {
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
export function fetchTournamentsList() {
    return fetchReportResource('tournaments.json', 'tournaments list', 'array', 'tournaments list', { cache: true });
}
/**
 * Fetch tournament summaries from the Limitless API via our proxy.
 * @param filters
 * @returns
 */
export async function fetchLimitlessTournaments(filters = {}) {
    const { game = CONFIG.API.LIMITLESS_DEFAULT_GAME, format, organizerId, limit = CONFIG.API.LIMITLESS_DEFAULT_LIMIT, page } = filters;
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
    const payload = await fetchWithRetry(url, 'Limitless tournaments', 'object', 'Limitless tournaments payload', {
        cache: true,
        cacheKey
    });
    if (!payload || payload.success !== true) {
        throw new AppError(ErrorTypes.API, 'Limitless tournaments request failed', null, { url, payload });
    }
    if (!Array.isArray(payload.data)) {
        throw new AppError(ErrorTypes.DATA_FORMAT, 'Limitless tournaments response missing data array', null, {
            url,
            payload
        });
    }
    const normalized = payload.data.map(normalizeLimitlessTournament).filter((t) => Boolean(t));
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
export function fetchReport(tournament) {
    const encodedTournament = encodeURIComponent(tournament);
    return fetchReportResource(`${encodedTournament}/master.json`, `report for ${tournament}`, 'object', 'tournament report', { cache: true });
}
/**
 * Fetch archetype trend data for a tournament group
 * @param tournament
 * @returns
 */
export function fetchTrendReport(tournament) {
    const encodedTournament = encodeURIComponent(tournament);
    return fetchReportResource(`${encodedTournament}/trends.json`, `trends for ${tournament}`, 'object', 'trend report', {
        cache: true
    });
}
/**
 * Fetch thumbnail overrides configuration
 * @returns
 */
export async function fetchOverrides() {
    try {
        const url = '/assets/overrides.json';
        const data = await fetchWithRetry(url, 'thumbnail overrides', 'object', 'thumbnail overrides', {
            cache: true,
            cacheKey: 'thumbnail-overrides'
        });
        logger.debug(`Loaded ${Object.keys(data).length} thumbnail overrides`);
        return data;
    }
    catch (error) {
        logger.warn('Failed to load overrides, using empty object', error.message);
        return {};
    }
}
/**
 * Normalize a single archetype index entry into a consistent object.
 * @param entry
 * @returns
 */
function normalizeArchetypeIndexEntry(entry) {
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
export async function fetchArchetypesList(tournament) {
    const result = await fetchReportResource(`${encodeURIComponent(tournament)}/archetypes/index.json`, `archetypes for ${tournament}`, 'array', 'archetypes list', { cache: true });
    if (!Array.isArray(result)) {
        return [];
    }
    return result.map(normalizeArchetypeIndexEntry).filter((e) => Boolean(e));
}
/**
 * Fetch specific archetype report data
 * @param tournament
 * @param archetypeBase
 * @returns
 * @throws AppError
 */
export function fetchArchetypeReport(tournament, archetypeBase) {
    logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`);
    const relativePath = `${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;
    return fetchReportResource(relativePath, `archetype report ${archetypeBase} for ${tournament}`, 'object', 'archetype report', { cache: true })
        .then(data => {
        logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, { itemCount: data.items?.length });
        return data;
    })
        .catch(error => {
        if (error instanceof AppError && error.context?.status === 404) {
            logger.debug(`Archetype ${archetypeBase} not found for ${tournament}`, {
                relativePath
            });
        }
        throw error;
    });
}
/**
 * Fetch include/exclude filtered archetype report data
 * Performs all filtering client-side using deck data
 * @param tournament
 * @param archetypeBase
 * @param includeId
 * @param excludeId
 * @param includeOperator - Quantity operator (=, <, <=, >, >=)
 * @param includeCount - Quantity threshold
 * @returns
 */
export async function fetchArchetypeFiltersReport(tournament, archetypeBase, includeId, excludeId, includeOperator = null, includeCount = null) {
    // If both include and exclude are null, fetch the base archetype report
    const isBaseReport = !includeId && !excludeId;
    if (isBaseReport) {
        const relativePath = `${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;
        logger.debug('Fetching base archetype report', {
            tournament,
            archetypeBase
        });
        return fetchReportResource(relativePath, `base archetype report ${archetypeBase}`, 'object', 'archetype report', {
            cache: true
        })
            .then(data => {
            logger.info(`Loaded base archetype report ${archetypeBase}`, {
                deckTotal: data.deckTotal
            });
            return data;
        })
            .catch(error => {
            if (error instanceof AppError && error.context?.status === 404) {
                logger.debug('Base archetype report not found', {
                    tournament,
                    archetypeBase
                });
            }
            throw error;
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
        const allDecks = await fetchAllDecks(tournament);
        const report = generateFilteredReport(allDecks, archetypeBase, includeId, excludeId, includeOperator, includeCount);
        logger.info(`Generated filtered archetype report ${archetypeBase}`, {
            include: includeId,
            includeOperator,
            includeCount,
            exclude: excludeId,
            deckTotal: report.deckTotal
        });
        return report;
    }
    catch (error) {
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
export function fetchMeta(tournament) {
    return fetchReportResource(`${encodeURIComponent(tournament)}/meta.json`, `meta for ${tournament}`, 'object', 'tournament meta', { cache: true });
}
/**
 * Fetch per-tournament card index (cardIndex.json)
 * @param tournament
 * @returns
 */
export async function fetchCardIndex(tournament) {
    const data = await fetchReportResource(`${encodeURIComponent(tournament)}/cardIndex.json`, `card index for ${tournament}`, 'object', 'card index', { cache: true });
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
export function fetchDecks(tournament) {
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
            }
            catch (err) {
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
export function fetchTop8ArchetypesList(tournament) {
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
            }
            catch (error) {
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
export async function fetchPricingData() {
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
    }
    catch (error) {
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
async function resolveCardPricingEntry(cardId, requiredField, logLabel) {
    const pricing = await fetchPricingData();
    const cardPrices = pricing.cardPrices || {};
    const getEntry = (candidateId) => {
        if (!candidateId) {
            return null;
        }
        const entry = cardPrices[candidateId];
        if (!entry) {
            return null;
        }
        if (requiredField && entry[requiredField] == null) {
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
    }
    catch (synonymError) {
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
export async function getCardPrice(cardId) {
    try {
        const entry = await resolveCardPricingEntry(cardId, 'price', 'price');
        return entry?.price ?? null;
    }
    catch (error) {
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
export async function getCardTCGPlayerId(cardId) {
    try {
        const entry = await resolveCardPricingEntry(cardId, 'tcgPlayerId', 'TCGPlayer ID');
        return entry?.tcgPlayerId ?? null;
    }
    catch (error) {
        logger.debug(`Failed to get TCGPlayer ID for ${cardId}`, error.message);
        return null;
    }
}
/**
 * Get complete card data (price and TCGPlayer ID) (with canonical fallback)
 * @param cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns Object with price and tcgPlayerId or null if not found
 */
export async function getCardData(cardId) {
    try {
        const entry = await resolveCardPricingEntry(cardId, null, 'card data');
        return entry ?? null;
    }
    catch (error) {
        logger.debug(`Failed to get card data for ${cardId}`, error.message);
        return null;
    }
}
