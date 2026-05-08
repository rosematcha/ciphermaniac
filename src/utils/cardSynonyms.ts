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
} from '../../shared/synonyms';

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
 * Get image candidates from card variants (for fallback when primary image fails)
 * Returns candidates from all variants (newest to oldest, excluding the current identifier)
 * @param cardIdentifier - Card UID or name
 * @param useSm - Whether to use small (true) or extra-small (false) thumbnails
 * @param overrides - Image filename overrides
 * @returns Array of image URL candidates from variants
 */
export async function getVariantImageCandidates(
  cardIdentifier: string,
  useSm: boolean = false,
  overrides: Record<string, string> = {}
): Promise<string[]> {
  try {
    const variants = await getCardVariants(cardIdentifier);
    if (!variants || variants.length <= 1) {
      return [];
    }

    // Import dependencies dynamically to avoid circular dependency
    const { buildThumbCandidates } = await import('../thumbs.js');
    const { getDisplayName, parseDisplayName } = await import('../card/identifiers.js');

    const candidates: string[] = [];

    // Iterate variants from end to start (newest to oldest)
    // Try all variants EXCEPT the current cardIdentifier
    for (let i = variants.length - 1; i >= 0; i--) {
      const variantUid = variants[i];

      // Skip only the exact identifier we're currently displaying
      // This allows us to try the canonical even if we're showing a newer variant,
      // and vice versa - try newer variants even if we're showing the canonical
      if (variantUid === cardIdentifier) {
        continue;
      }

      // Convert UID to display format first ("Ultra Ball::DEX::102" -> "Ultra Ball DEX 102")
      const displayName = getDisplayName(variantUid);
      if (!displayName) {
        continue;
      }

      // Parse display name to get name, set, and number
      const parsed = parseDisplayName(displayName);
      if (!parsed || !parsed.name) {
        continue;
      }

      let variant: { set?: string; number?: string } = {};
      if (parsed.setId) {
        const setMatch = parsed.setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
        if (setMatch) {
          variant = { set: setMatch[1], number: setMatch[2] };
        }
      }

      // Get candidates for this variant
      const variantCandidates = buildThumbCandidates(parsed.name, useSm, overrides, variant);
      candidates.push(...variantCandidates);
    }

    return candidates;
  } catch (error) {
    console.warn('Failed to get variant image candidates:', error);
    return [];
  }
}

// Pre-load synonym data on module import for better performance
