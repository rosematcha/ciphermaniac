/**
 * Core card synonym resolution logic - isomorphic (works in browser and Node/Workers)
 * @module shared/synonyms
 *
 * This module contains pure functions for resolving card synonyms.
 * Environment-specific data loading is handled by consumers:
 * - Frontend: src/utils/cardSynonyms.ts (fetch from URL)
 * - Backend: functions/lib/cardSynonyms.js (KV/R2)
 */

/**
 * Synonym database structure
 */
export interface SynonymDatabase {
  /** Maps variant UIDs to their canonical UID */
  synonyms: Record<string, string>;
  /** Maps card names to their preferred canonical UID */
  canonicals: Record<string, string>;
}

/**
 * Empty database for fallback scenarios
 */
export const EMPTY_DATABASE: SynonymDatabase = {
  synonyms: {},
  canonicals: {}
};

/**
 * Get the canonical UID for a given card identifier (pure function)
 *
 * Resolution rules:
 * 1. For UIDs (contains '::'): Check synonyms mapping only. Cards with same name
 * but different abilities must NOT be merged unless explicitly in synonyms.
 * 2. For name-only inputs: Check canonicals, then synonyms as fallback.
 * @param database - Synonym database (or null for no-op)
 * @param cardIdentifier - Card UID (Name::SET::NUMBER) or card name
 * @returns Canonical UID or original identifier if no mapping exists
 */
export function getCanonicalCardFromData(database: SynonymDatabase | null, cardIdentifier: string): string {
  if (!cardIdentifier) {
    return cardIdentifier;
  }

  if (!database) {
    return cardIdentifier;
  }

  // If this looks like a UID (Name::SET::NUMBER), check explicit synonym mapping first.
  // Cards with the same name but different abilities (e.g., Ralts PAF 027 vs Ralts MEG 058)
  // must not be merged - only cards explicitly listed in synonyms should be canonicalized.
  if (cardIdentifier.includes('::')) {
    if (database.synonyms && database.synonyms[cardIdentifier]) {
      return database.synonyms[cardIdentifier];
    }
    // UID not in synonyms means it's its own canonical - return as-is
    return cardIdentifier;
  }

  // For name-only inputs, return configured canonical if present
  if (database.canonicals && database.canonicals[cardIdentifier]) {
    return database.canonicals[cardIdentifier];
  }

  // Fall back to direct synonym mapping if someone passed a name mapped in synonyms
  if (database.synonyms && database.synonyms[cardIdentifier]) {
    return database.synonyms[cardIdentifier];
  }

  return cardIdentifier;
}
