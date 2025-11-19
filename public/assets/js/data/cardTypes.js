/**
 * Card type database utilities
 * Provides access to scraped card type information from Limitless TCG
 * @module data/cardTypes
 */

import { logger } from '../utils/logger.js';

/** @type {Object<string, {cardType: string, subType?: string, evolutionInfo?: string, fullType: string, lastUpdated: string, aceSpec?: boolean}>|null} */
let cardTypesDatabase = null;

/** @type {Promise<object> | null} */
let loadPromise = null;

/**
 * Load the card types database
 * @returns {Promise<object>}
 */
async function loadCardTypesDatabase() {
  if (cardTypesDatabase) {
    return cardTypesDatabase;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const response = await fetch('/assets/data/card-types.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      cardTypesDatabase = await response.json();
      logger.info(`Loaded card types database with ${Object.keys(cardTypesDatabase).length} cards`);
      return cardTypesDatabase;
    } catch (error) {
      logger.warn('Failed to load card types database', error.message);
      cardTypesDatabase = {};
      return cardTypesDatabase;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Get card type information for a specific card
 * @param {string} setCode - Card set code (e.g., "PAL")
 * @param {string|number} number - Card number (e.g., "188")
 * @returns {Promise<{cardType: string, subType?: string, evolutionInfo?: string, fullType: string, aceSpec?: boolean}|null>}
 */
export async function getCardType(setCode, number) {
  if (!setCode || !number) {
    return null;
  }

  const db = await loadCardTypesDatabase();
  const key = `${setCode}::${number}`;
  return db[key] || null;
}

/**
 * Get trainer subtype for a card
 * @param {string} setCode
 * @param {string|number} number
 * @returns {Promise<string|null>} - Returns 'item', 'supporter', 'stadium', 'tool', 'ace-spec', etc.
 */
export async function getTrainerSubtype(setCode, number) {
  const typeInfo = await getCardType(setCode, number);
  if (!typeInfo || typeInfo.cardType !== 'trainer') {
    return null;
  }
  return typeInfo.subType || null;
}

/**
 * Get energy subtype for a card
 * @param {string} setCode
 * @param {string|number} number
 * @returns {Promise<string|null>} - Returns 'basic' or 'special'
 */
export async function getEnergySubtype(setCode, number) {
  const typeInfo = await getCardType(setCode, number);
  if (!typeInfo || typeInfo.cardType !== 'energy') {
    return null;
  }
  return typeInfo.subType || null;
}

/**
 * Check if database has information for a card
 * @param {string} setCode
 * @param {string|number} number
 * @returns {Promise<boolean>}
 */
export async function hasCardType(setCode, number) {
  if (!setCode || !number) {
    return false;
  }

  const db = await loadCardTypesDatabase();
  const key = `${setCode}::${number}`;
  return key in db;
}

/**
 * Get all cards in the database
 * @returns {Promise<object>}
 */
export async function getAllCardTypes() {
  return await loadCardTypesDatabase();
}

/**
 * Enrich a card item with type information from the database
 * @param {object} card - Card object with set and number properties
 * @returns {Promise<object>} - Card object enriched with cardType, trainerType, energyType
 */
export async function enrichCardWithType(card) {
  if (!card || !card.set || !card.number) {
    return card;
  }

  const typeInfo = await getCardType(card.set, card.number);
  if (!typeInfo) {
    return card;
  }

  const enriched = { ...card };

  // Set category if not already set
  if (!enriched.category) {
    enriched.category = typeInfo.cardType;
  }

  // Set trainer subtype
  if (typeInfo.cardType === 'trainer' && typeInfo.subType && !enriched.trainerType) {
    enriched.trainerType = typeInfo.subType;
  }

  // Set energy subtype
  if (typeInfo.cardType === 'energy' && typeInfo.subType && !enriched.energyType) {
    enriched.energyType = typeInfo.subType;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.aceSpec) {
    enriched.aceSpec = true;
  }

  return enriched;
}
