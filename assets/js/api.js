/**
 * API utilities for fetching tournament data and configurations
 * @module API
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, ErrorTypes, withRetry, validateType } from './utils/errorHandler.js';

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
 * Fetch tournaments list with retry logic
 * @returns {Promise<string[]>}
 * @throws {AppError}
 */
export async function fetchTournamentsList() {
  return withRetry(async () => {
    logger.debug('Fetching tournaments list');
    const url = `${CONFIG.API.REPORTS_BASE}/tournaments.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'array', 'tournaments list');
    logger.info(`Loaded ${data.length} tournaments`);
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
}

/**
 * Fetch tournament report data
 * @param {string} tournament
 * @returns {Promise<Object>}
 * @throws {AppError}
 */
export async function fetchReport(tournament) {
  return withRetry(async () => {
    logger.debug(`Fetching report for tournament: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/master.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'object', 'tournament report');
    logger.info(`Loaded report for ${tournament}`, { itemCount: data.items?.length });
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
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
 * @throws {AppError}
 */
export async function fetchArchetypesList(tournament) {
  return withRetry(async () => {
    logger.debug(`Fetching archetypes list for: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/index.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);

    validateType(data, 'array', 'archetypes list');
    logger.info(`Loaded ${data.length} archetypes for ${tournament}`);
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
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
export async function fetchMeta(tournament){
  return withRetry(async () => {
    logger.debug(`Fetching meta.json for: ${tournament}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/meta.json`;
    const response = await safeFetch(url);
    const data = await safeJsonParse(response, url);
    validateType(data, 'object', 'tournament meta');
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
}

/**
 * Fetch per-tournament card index (cardIndex.json)
 * @param {string} tournament
 * @returns {Promise<{deckTotal:number, cards: Record<string, any>}>}
 */
export async function fetchCardIndex(tournament){
  return withRetry(async () => {
    logger.debug(`Fetching cardIndex for: ${tournament}`);
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
