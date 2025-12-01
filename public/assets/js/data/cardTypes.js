/**
 * Card type database utilities
 * Provides access to scraped card type information from Limitless TCG
 * @module data/cardTypes
 */
import { logger } from '../utils/logger.js';
let cardTypesDatabase = null;
let loadPromise = null;
function buildCardKey(setCode, number) {
    return `${setCode}::${number}`;
}
/**
 * Load the card types database (cached).
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
            cardTypesDatabase = (await response.json());
            logger.info(`Loaded card types database with ${Object.keys(cardTypesDatabase).length} cards`);
            return cardTypesDatabase;
        }
        catch (error) {
            logger.warn('Failed to load card types database', error?.message || error);
            cardTypesDatabase = {};
            return cardTypesDatabase;
        }
        finally {
            loadPromise = null;
        }
    })();
    return loadPromise;
}
/**
 * Clear cached card types (used by tests).
 */
export function clearCardTypesCache() {
    cardTypesDatabase = null;
    loadPromise = null;
}
/**
 * Get card type information for a specific card.
 */
export async function getCardType(setCode, number) {
    if (!setCode || !number) {
        return null;
    }
    const db = await loadCardTypesDatabase();
    const key = buildCardKey(setCode, number);
    return db[key] || null;
}
/**
 * Get trainer subtype for a card.
 */
export async function getTrainerSubtype(setCode, number) {
    const typeInfo = await getCardType(setCode, number);
    if (!typeInfo || typeInfo.cardType !== 'trainer') {
        return null;
    }
    return typeInfo.subType || null;
}
/**
 * Get energy subtype for a card.
 */
export async function getEnergySubtype(setCode, number) {
    const typeInfo = await getCardType(setCode, number);
    if (!typeInfo || typeInfo.cardType !== 'energy') {
        return null;
    }
    return typeInfo.subType || null;
}
/**
 * Check if database has information for a card.
 */
export async function hasCardType(setCode, number) {
    if (!setCode || !number) {
        return false;
    }
    const db = await loadCardTypesDatabase();
    const key = buildCardKey(setCode, number);
    return key in db;
}
/**
 * Get all cards in the database.
 */
export async function getAllCardTypes() {
    return loadCardTypesDatabase();
}
/**
 * Enrich a card item with type information from the database.
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
    if (!enriched.category) {
        enriched.category = typeInfo.cardType;
    }
    if (typeInfo.cardType === 'trainer' && typeInfo.subType && !enriched.trainerType) {
        enriched.trainerType = typeInfo.subType;
    }
    if (typeInfo.cardType === 'energy' && typeInfo.subType && !enriched.energyType) {
        enriched.energyType = typeInfo.subType;
    }
    if (typeInfo.cardType === 'trainer' && typeInfo.aceSpec) {
        enriched.aceSpec = true;
    }
    return enriched;
}
