/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, withRetry, validateType } from './utils/errorHandler.js';

let pricingData = null;

/**
 * Enhanced fetch with timeout and error handling
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
async function safeFetch(url, options = {}) {
  const supportsAbort = (typeof AbortController !== 'undefined');
  const controller = supportsAbort ? new AbortController() : null;
  const timeoutId = supportsAbort ? setTimeout(() => controller.abort(), CONFIG.API.TIMEOUT_MS) : null;

  try {
    const response = await fetch(url, {
      ...options,
      // Only pass signal when supported to avoid ReferenceErrors on older engines
      ...(controller ? { signal: controller.signal } : {})
    });

    if (!response.ok) {
      throw new AppError(
        `HTTP ${response.status}: ${response.statusText}`,
        ErrorTypes.NETWORK,
        { url, status: response.status }
      );
    }

    return response;
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.code === 20)) {
      throw new AppError(`Request timeout after ${CONFIG.API.TIMEOUT_MS}ms`, ErrorTypes.NETWORK, { url });
    }
    throw error;
  } finally {
    if (timeoutId) {clearTimeout(timeoutId);}
  }
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
    throw new AppError('Empty response body', ErrorTypes.PARSE, { url, contentType });
  }

  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
    throw new AppError(
      `Expected JSON response but got ${contentType || 'unknown content type'}`,
      ErrorTypes.PARSE,
      { url, contentType, preview }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (error.name === 'SyntaxError') {
      const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
      throw new AppError(
        `Invalid JSON response: ${error.message}`,
        ErrorTypes.PARSE,
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
 * @returns {Promise<T>}
 */
function fetchWithRetry(url, operation, expectedType, fieldName) {
  return withRetry(async () => {
    logger.debug(`Fetching ${operation}`);
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, expectedType, fieldName || operation);
    const count = Array.isArray(data) ? data.length : (data.items?.length || 'unknown');
    logger.info(`Loaded ${operation}`, { count });
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
}

/**
 * Fetch tournaments list
 * @returns {Promise<string[]>}
 */
export function fetchTournamentsList() {
  const url = `${CONFIG.API.REPORTS_BASE}/tournaments.json`;
  return fetchWithRetry(url, 'tournaments list', 'array', 'tournaments list');
}

/**
 * Fetch tournament report data
 * @param {string} tournament
 * @returns {Promise<object>}
 */
export function fetchReport(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/master.json`;
  return fetchWithRetry(url, `report for ${tournament}`, 'object', 'tournament report');
}

/**
 * Fetch thumbnail overrides configuration
 * @returns {Promise<object>}
 */
export async function fetchOverrides() {
  try {
    logger.debug('Fetching thumbnail overrides');
    const url = '/assets/overrides.json';
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'object', 'overrides');
    logger.info(`Loaded ${Object.keys(data).length} thumbnail overrides`);
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
  return fetchWithRetry(url, `archetypes for ${tournament}`, 'array', 'archetypes list');
}

/**
 * Fetch specific archetype report data
 * @param {string} tournament
 * @param {string} archetypeBase
 * @returns {Promise<object>}
 * @throws {AppError}
 */
export async function fetchArchetypeReport(tournament, archetypeBase) {
  logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`);
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;

  try {
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'object', 'archetype report');
    logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, { itemCount: data.items?.length });
    return data;
  } catch (error) {
    // For 404 errors (archetype doesn't exist), don't retry and log at debug level
    if (error instanceof AppError && error.context?.status === 404) {
      logger.debug(`Archetype ${archetypeBase} not found for ${tournament}`, { url });
      throw error;
    }

    // For other errors, use retry logic
    return withRetry(async () => {
      const response = await safeFetch(url);
      const data = await safeJsonParse(response, url);
      validateType(data, 'object', 'archetype report');
      logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, { itemCount: data.items?.length });
      return data;
    }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
  }
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

    try {
      const response = await safeFetch(url);
      const data = await safeJsonParse(response, url);
      validateType(data, 'object', 'archetype report');
      logger.info(`Loaded base archetype report ${archetypeBase}`, {
        deckTotal: data.deckTotal
      });
      return data;
    } catch (error) {
      if (error instanceof AppError && error.context?.status === 404) {
        logger.debug('Base archetype report not found', { tournament, archetypeBase });
        throw error;
      }

      return withRetry(async () => {
        const response = await safeFetch(url);
        const data = await safeJsonParse(response, url);
        validateType(data, 'object', 'archetype report');
        return data;
      }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
    }
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
  return fetchWithRetry(url, `meta for ${tournament}`, 'object', 'tournament meta');
}

/**
 * Fetch per-tournament card index (cardIndex.json)
 * @param {string} tournament
 * @returns {Promise<{deckTotal:number, cards: Record<string, any>}>}
 */
export function fetchCardIndex(tournament) {
  return withRetry(async () => {
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/cardIndex.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);
    validateType(data, 'object', 'card index');
    if (typeof data.deckTotal !== 'number' || !data.cards || typeof data.cards !== 'object') {
      throw new AppError('Invalid card index schema', ErrorTypes.PARSE, { tournament });
    }
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
}

/**
 * Fetch raw deck list export (decks.json)
 * @param {string} tournament
 * @returns {Promise<Array>|null}
 */
export async function fetchDecks(tournament) {
  try {
    logger.debug(`Fetching decks.json for: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/decks.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);
    validateType(data, 'array', 'decks');
    return data;
  } catch (err) {
    logger.debug('decks.json not available', err.message);
    return null;
  }
}

/**
 * Fetch top 8 archetypes list (optional endpoint)
 * @param {string} tournament
 * @returns {Promise<string[]|null>}
 */
export async function fetchTop8ArchetypesList(tournament) {
  try {
    logger.debug(`Fetching top 8 archetypes for: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/top8.json`;
    const response = await safeFetch(url);
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
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'object', 'pricing data');
    if (!data.cardPrices || typeof data.cardPrices !== 'object') {
      throw new AppError('Invalid pricing data schema', ErrorTypes.PARSE);
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
 * Get price for a specific card (with canonical fallback)
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<number|null>} Price in USD or null if not found
 */
export async function getCardPrice(cardId) {
  try {
    const pricing = await fetchPricingData();

    // Try exact match first
    let cardData = pricing.cardPrices[cardId];
    if (cardData?.price) {
      return cardData.price;
    }

    // Try canonical resolution if exact match failed
    try {
      const { getCanonicalCard, getCardVariants } = await import('./utils/cardSynonyms.js');

      // Get canonical version
      const canonical = await getCanonicalCard(cardId);
      if (canonical && canonical !== cardId) {
        cardData = pricing.cardPrices[canonical];
        if (cardData?.price) {
          logger.debug(`Found price via canonical: ${canonical}`, { original: cardId });
          return cardData.price;
        }
      }

      // Try all variants if canonical didn't work
      const variants = await getCardVariants(cardId);
      for (const variant of variants) {
        if (variant !== cardId) {
          cardData = pricing.cardPrices[variant];
          if (cardData?.price) {
            logger.debug(`Found price via variant: ${variant}`, { original: cardId });
            return cardData.price;
          }
        }
      }
    } catch (synonymError) {
      logger.debug('Synonym resolution failed during price lookup', synonymError.message);
    }

    logger.debug(`No price found for ${cardId} or its variants`);
    return null;
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
    const pricing = await fetchPricingData();

    // Try exact match first
    let cardData = pricing.cardPrices[cardId];
    if (cardData?.tcgPlayerId) {
      return cardData.tcgPlayerId;
    }

    // Try canonical resolution if exact match failed
    try {
      const { getCanonicalCard, getCardVariants } = await import('./utils/cardSynonyms.js');

      // Get canonical version
      const canonical = await getCanonicalCard(cardId);
      if (canonical && canonical !== cardId) {
        cardData = pricing.cardPrices[canonical];
        if (cardData?.tcgPlayerId) {
          logger.debug(`Found TCGPlayer ID via canonical: ${canonical}`, { original: cardId });
          return cardData.tcgPlayerId;
        }
      }

      // Try all variants if canonical didn't work
      const variants = await getCardVariants(cardId);
      for (const variant of variants) {
        if (variant !== cardId) {
          cardData = pricing.cardPrices[variant];
          if (cardData?.tcgPlayerId) {
            logger.debug(`Found TCGPlayer ID via variant: ${variant}`, { original: cardId });
            return cardData.tcgPlayerId;
          }
        }
      }
    } catch (synonymError) {
      logger.debug('Synonym resolution failed during TCGPlayer ID lookup', synonymError.message);
    }

    logger.debug(`No TCGPlayer ID found for ${cardId} or its variants`);
    return null;
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
    const pricing = await fetchPricingData();

    // Try exact match first
    let cardData = pricing.cardPrices[cardId];
    if (cardData) {
      return cardData;
    }

    // Try canonical resolution if exact match failed
    try {
      const { getCanonicalCard, getCardVariants } = await import('./utils/cardSynonyms.js');

      // Get canonical version
      const canonical = await getCanonicalCard(cardId);
      if (canonical && canonical !== cardId) {
        cardData = pricing.cardPrices[canonical];
        if (cardData) {
          logger.debug(`Found card data via canonical: ${canonical}`, { original: cardId });
          return cardData;
        }
      }

      // Try all variants if canonical didn't work
      const variants = await getCardVariants(cardId);
      for (const variant of variants) {
        if (variant !== cardId) {
          cardData = pricing.cardPrices[variant];
          if (cardData) {
            logger.debug(`Found card data via variant: ${variant}`, { original: cardId });
            return cardData;
          }
        }
      }
    } catch (synonymError) {
      logger.debug('Synonym resolution failed during card data lookup', synonymError.message);
    }

    logger.debug(`No card data found for ${cardId} or its variants`);
    return null;
  } catch (error) {
    logger.debug(`Failed to get card data for ${cardId}`, error.message);
    return null;
  }
}
