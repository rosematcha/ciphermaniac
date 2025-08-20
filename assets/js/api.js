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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.API.TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
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
    if (error.name === 'AbortError') {
      throw new AppError(`Request timeout after ${CONFIG.API.TIMEOUT_MS}ms`, ErrorTypes.NETWORK, { url });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
    const data = await response.json();
    
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
    const data = await response.json();
    
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
    const response = await safeFetch('assets/overrides.json');
    const data = await response.json();
    
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
    const data = await response.json();
    
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
  return withRetry(async () => {
    logger.debug(`Fetching archetype report: ${tournament}/${archetypeBase}`);
    const url = `${CONFIG.API.REPORTS_BASE}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}.json`;
    const response = await safeFetch(url);
    const data = await response.json();
    
    validateType(data, 'object', 'archetype report');
    logger.info(`Loaded archetype report ${archetypeBase} for ${tournament}`, { itemCount: data.items?.length });
    return data;
  }, CONFIG.API.RETRY_ATTEMPTS, CONFIG.API.RETRY_DELAY_MS);
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
    const data = await response.json();
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
    const data = await response.json();
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
    const data = await response.json();
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
    const data = await response.json();
    
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
