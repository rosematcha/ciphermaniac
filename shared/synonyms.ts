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

/**
 * Check if a card has reprints/synonyms (pure function)
 * @param database - Synonym database (or null)
 * @param cardIdentifier - Card UID or name
 * @returns True if card has synonyms
 */
export function hasCardSynonymsInData(database: SynonymDatabase | null, cardIdentifier: string): boolean {
  if (!cardIdentifier || !database) {
    return false;
  }

  return Boolean(
    (database.synonyms && database.synonyms[cardIdentifier]) ||
      (database.canonicals && database.canonicals[cardIdentifier])
  );
}

/**
 * Get all variant UIDs for a card by checking reverse mappings (pure function)
 * @param database - Synonym database (or null)
 * @param canonicalUid - The canonical UID to find variants for
 * @returns Array of all variant UIDs including canonical
 */
export function getCardVariantsFromData(database: SynonymDatabase | null, canonicalUid: string): string[] {
  if (!canonicalUid) {
    return [];
  }

  const variants = [canonicalUid];

  if (!database || !database.synonyms) {
    return variants;
  }

  // Find all UIDs that map to this canonical
  for (const [uid, canonical] of Object.entries(database.synonyms)) {
    if (canonical === canonicalUid && uid !== canonicalUid) {
      variants.push(uid);
    }
  }

  return variants;
}
