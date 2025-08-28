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
 * @param {RequestInit} [options]
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
 * @returns {Promise<Object>}
 */
export function fetchReport(tournament) {
  const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/master.json`;
  return fetchWithRetry(url, `report for ${tournament}`, 'object', 'tournament report');
}

/**
 * Fetch thumbnail overrides configuration
 * @returns {Promise<Object>}
 */
export async function fetchOverrides() {
  try {
    logger.debug('Fetching thumbnail overrides');
    const url = 'assets/overrides.json';
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
 * @returns {Promise<Object>}
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
 * Fetch tournament metadata (meta.json)
 * @param {string} tournament
 * @returns {Promise<Object>}
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
    if(typeof data.deckTotal !== 'number' || !data.cards || typeof data.cards !== 'object'){
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
export async function fetchDecks(tournament){
  try{
    logger.debug(`Fetching decks.json for: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/decks.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);
    validateType(data, 'array', 'decks');
    return data;
  }catch(err){
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
 * @returns {Promise<Object>} Pricing data with card prices
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
    
    pricingData = data;
    logger.info(`Loaded pricing data for ${Object.keys(data.cardPrices).length} cards`);
    return data;
  } catch (error) {
    logger.warn('Failed to fetch pricing data', error.message);
    return { cardPrices: {} };
  }
}

/**
 * Get price for a specific card
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<number|null>} Price in USD or null if not found
 */
export async function getCardPrice(cardId) {
  try {
    console.log('getCardPrice called with cardId:', cardId);
    const pricing = await fetchPricingData();
    console.log('Pricing data loaded, total cards:', Object.keys(pricing.cardPrices).length);
    
    const cardData = pricing.cardPrices[cardId];
    console.log('Lookup result for', cardId, ':', cardData);
    
    if (!cardData) {
      // If exact match failed, let's see if there are similar cards
      const similarKeys = Object.keys(pricing.cardPrices).filter(key => 
        key.toLowerCase().includes(cardId.toLowerCase().split('::')[0])
      ).slice(0, 3);
      console.log('Similar cards found:', similarKeys);
    }
    
    // FIX: The pricing data stores prices as numbers directly, not as objects with .price property
    return cardData || null;
  } catch (error) {
    logger.debug(`Failed to get price for ${cardId}`, error.message);
    console.error('Error in getCardPrice:', error);
    return null;
  }
}

/**
 * Get TCGPlayer ID for a specific card
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"
 * @returns {Promise<string|null>} TCGPlayer ID or null if not found
 */
export async function getCardTCGPlayerId(cardId) {
  try {
    const pricing = await fetchPricingData();
    const cardData = pricing.cardPrices[cardId];
    // Since cardData is now a number (price), we don't have TCGPlayer IDs stored anymore
    // This function should return null or we need to restructure the data
    return null;
  } catch (error) {
    logger.debug(`Failed to get TCGPlayer ID for ${cardId}`, error.message);
    return null;
  }
}

/**
 * Get complete card data (price and TCGPlayer ID)
 * @param {string} cardId - Card identifier in format "Name::SET::NUMBER"  
 * @returns {Promise<Object|null>} Object with price and tcgPlayerId or null if not found
 */
export async function getCardData(cardId) {
  try {
    const pricing = await fetchPricingData();
    const cardPrice = pricing.cardPrices[cardId];
    // Since pricing data now stores numbers directly, return in expected object format
    return cardPrice ? { price: cardPrice, tcgPlayerId: null } : null;
  } catch (error) {
    logger.debug(`Failed to get card data for ${cardId}`, error.message);
    return null;
  }
}
