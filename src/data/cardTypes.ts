/**
 * Card type database utilities
 * Provides access to scraped card type information from Limitless TCG
 * @module data/cardTypes
 */

import { logger } from '../utils/logger.js';

export interface CardTypeInfo {
  cardType: string;
  subType?: string;
  evolutionInfo?: string;
  fullType: string;
  lastUpdated: string;
  aceSpec?: boolean;
}

type CardTypeDB = Record<string, CardTypeInfo>;

let cardTypesDatabase: CardTypeDB | null = null;
let loadPromise: Promise<CardTypeDB> | null = null;

function buildCardKey(setCode: string, number: string | number): string {
  return `${setCode}::${number}`;
}

/**
 * Load the card types database (cached).
 */
async function loadCardTypesDatabase(): Promise<CardTypeDB> {
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
      cardTypesDatabase = (await response.json()) as CardTypeDB;
      logger.info(`Loaded card types database with ${Object.keys(cardTypesDatabase).length} cards`);
      return cardTypesDatabase;
    } catch (error: any) {
      logger.warn('Failed to load card types database', error?.message || error);
      cardTypesDatabase = {};
      return cardTypesDatabase;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Clear cached card types (used by tests).
 */
export function clearCardTypesCache(): void {
  cardTypesDatabase = null;
  loadPromise = null;
}

/**
 * Get card type information for a specific card.
 */
export async function getCardType(setCode: string, number: string | number): Promise<CardTypeInfo | null> {
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
export async function getTrainerSubtype(setCode: string, number: string | number): Promise<string | null> {
  const typeInfo = await getCardType(setCode, number);
  if (!typeInfo || typeInfo.cardType !== 'trainer') {
    return null;
  }
  return typeInfo.subType || null;
}

/**
 * Get energy subtype for a card.
 */
export async function getEnergySubtype(setCode: string, number: string | number): Promise<string | null> {
  const typeInfo = await getCardType(setCode, number);
  if (!typeInfo || typeInfo.cardType !== 'energy') {
    return null;
  }
  return typeInfo.subType || null;
}

/**
 * Check if database has information for a card.
 */
export async function hasCardType(setCode: string, number: string | number): Promise<boolean> {
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
export async function getAllCardTypes(): Promise<CardTypeDB> {
  return loadCardTypesDatabase();
}

export interface CardTypeEnrichable {
  set?: string;
  number?: string | number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  [key: string]: any;
}

/**
 * Enrich a card item with type information from the database.
 */
export async function enrichCardWithType<T extends CardTypeEnrichable>(card: T | null | undefined): Promise<T> {
  if (!card || !card.set || !card.number) {
    return card as T;
  }

  const typeInfo = await getCardType(card.set, card.number);
  if (!typeInfo) {
    return card;
  }

  const enriched: T = { ...card };

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
