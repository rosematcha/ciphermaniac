/**
 * Card synonyms utilities for handling reprints and alternate versions
 * @module utils/cardSynonyms
 *
 * This module provides browser-side card synonym resolution.
 * Core logic is shared with backend via shared/synonyms
 */

import { CONFIG } from '../config.js';
import {
  EMPTY_DATABASE,
  getCanonicalCardFromData,
  getCardVariantsFromData,
  type SynonymDatabase
} from '../../shared/synonyms.js';

// Lazy-loaded synonym data (browser-side cache)
let synonymData: SynonymDatabase | null = null;

/**
 * Load synonym data from JSON file (browser-side via fetch)
 * @returns Synonym data object
 */
async function loadSynonymData(): Promise<SynonymDatabase> {
  if (synonymData) {
    return synonymData;
  }

  // Try sessionStorage first to avoid re-fetching on page navigation within same session
  try {
    const cached = sessionStorage.getItem('cardSynonymsData');
    if (cached) {
      synonymData = JSON.parse(cached);
      return synonymData ?? EMPTY_DATABASE;
    }
  } catch {
    // sessionStorage unavailable or parse error — fall through to fetch
  }

  try {
    const response = await fetch(CONFIG.API.SYNONYMS_URL);
    if (!response.ok) {
      console.warn('Card synonyms data not found, synonym resolution disabled');
      synonymData = EMPTY_DATABASE;
      return synonymData;
    }
    synonymData = await response.json();
    // Cache in sessionStorage for subsequent page navigations
    try {
      sessionStorage.setItem('cardSynonymsData', JSON.stringify(synonymData));
    } catch {
      // Quota exceeded — still works from module-level variable
    }
    return synonymData ?? EMPTY_DATABASE;
  } catch (error) {
    console.warn('Failed to load card synonyms:', error);
    synonymData = EMPTY_DATABASE;
    return synonymData;
  }
}

/**
 * Get the canonical UID for a given card UID or name
 * @param cardIdentifier - Card UID or name
 * @returns Canonical UID or original identifier if no mapping exists
 */
export async function getCanonicalCard(cardIdentifier: string): Promise<string> {
  if (!cardIdentifier) {
    return cardIdentifier;
  }

  const data = await loadSynonymData();
  return getCanonicalCardFromData(data, cardIdentifier);
}

/**
 * Get all variant UIDs for a card by checking reverse mappings
 * @param cardIdentifier - Card UID or name
 * @returns Array of all variant UIDs including canonical
 */
export async function getCardVariants(cardIdentifier: string): Promise<string[]> {
  const data = await loadSynonymData();
  const canonical = getCanonicalCardFromData(data, cardIdentifier);
  return getCardVariantsFromData(data, canonical);
}

/**
 * Get image candidates from card variants (for fallback when primary image fails).
 *
 * STUBBED: the original implementation depended on `../thumbs.js` and
 * `../card/identifiers.js`, both of which were UI modules deleted during the
 * frontend scrap. This function is reachable from nothing in the new SPA, so
 * it now returns an empty list. Reinstate the original (see git history of
 * `src/utils/cardSynonyms.ts`) when card thumbnail handling is reintroduced.
 */
export async function getVariantImageCandidates(
  cardIdentifier: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _useSm: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _overrides: Record<string, string> = {}
): Promise<string[]> {
  // Touch `cardIdentifier` so the parameter isn't unused.
  void cardIdentifier;
  return [];
}

/**
 * Get the cached synonym database, loading it on first call.
 * Shares the module-level / sessionStorage cache used by other helpers,
 * so callers don't trigger duplicate /synonyms.json fetches.
 */
export async function getSynonymDatabase(): Promise<SynonymDatabase> {
  return loadSynonymData();
}

// Pre-load synonym data on module import for better performance
