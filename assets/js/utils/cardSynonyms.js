/**
 * Card synonyms utilities for handling reprints and alternate versions
 * @module utils/cardSynonyms
 */

// Lazy-loaded synonym data
let synonymData = null;

/**
 * Load synonym data from JSON file
 * @returns {Promise<object>} Synonym data object
 */
async function loadSynonymData() {
  if (synonymData) {return synonymData;}

  try {
    const response = await fetch('/assets/card-synonyms.json');
    if (!response.ok) {
      console.warn('Card synonyms data not found, synonym resolution disabled');
      return { synonyms: {}, canonicals: {} };
    }
    // eslint-disable-next-line require-atomic-updates
    synonymData = await response.json();
    return synonymData;
  } catch (error) {
    console.warn('Failed to load card synonyms:', error);
    return { synonyms: {}, canonicals: {} };
  }
}

/**
 * Get the canonical UID for a given card UID or name
 * @param {string} cardIdentifier - Card UID or name
 * @returns {Promise<string>} Canonical UID or original identifier if no mapping exists
 */
export async function getCanonicalCard(cardIdentifier) {
  if (!cardIdentifier) {return cardIdentifier;}

  const data = await loadSynonymData();

  // If this looks like a UID (Name::SET::NUMBER), prefer the name-based canonical
  // when available (this keeps older canonicals prioritized), otherwise fall back
  // to the explicit synonym mapping for the UID.
  if (cardIdentifier.includes('::')) {
    const baseName = String(cardIdentifier).split('::')[0];
    if (data.canonicals && data.canonicals[baseName]) {
      return data.canonicals[baseName];
    }
    if (data.synonyms && data.synonyms[cardIdentifier]) {
      return data.synonyms[cardIdentifier];
    }
    return cardIdentifier;
  }

  // For name inputs, return configured canonical if present
  if (data.canonicals && data.canonicals[cardIdentifier]) {
    return data.canonicals[cardIdentifier];
  }

  // Fall back to direct synonym mapping if someone passed a name mapped in synonyms
  if (data.synonyms && data.synonyms[cardIdentifier]) {
    return data.synonyms[cardIdentifier];
  }

  return cardIdentifier;
}

/**
 * Check if a card has reprints/synonyms
 * @param {string} cardIdentifier - Card UID or name
 * @returns {Promise<boolean>} True if card has synonyms
 */
export async function hasCardSynonyms(cardIdentifier) {
  if (!cardIdentifier) {return false;}

  const data = await loadSynonymData();

  return Boolean(data.synonyms[cardIdentifier] || data.canonicals[cardIdentifier]);
}

/**
 * Normalize card identifier for search/comparison
 * Always returns the canonical version
 * @param {string} cardIdentifier - Card UID or name
 * @returns {Promise<string>} Normalized card identifier
 */
export function normalizeCardIdentifier(cardIdentifier) {
  return getCanonicalCard(cardIdentifier);
}

/**
 * Get all variant UIDs for a card by checking reverse mappings
 * @param {string} cardIdentifier - Card UID or name
 * @returns {Promise<string[]>} Array of all variant UIDs including canonical
 */
export async function getCardVariants(cardIdentifier) {
  const data = await loadSynonymData();
  const canonical = await getCanonicalCard(cardIdentifier);

  // Find all UIDs that map to this canonical
  const variants = [canonical];

  for (const [uid, canonicalUID] of Object.entries(data.synonyms)) {
    if (canonicalUID === canonical && uid !== canonical) {
      variants.push(uid);
    }
  }

  return variants;
}

/**
 * Synchronous version for when synonym data is already loaded
 * Use with caution - prefer async versions
 */
export const sync = {
  /**
   * Get canonical card (sync) - only works if data already loaded
   * @param {string} cardIdentifier
   * @returns {string}
   */
  getCanonicalCard(cardIdentifier) {
    if (!synonymData || !cardIdentifier) {return cardIdentifier;} 

    if (String(cardIdentifier).includes('::')) {
      const baseName = String(cardIdentifier).split('::')[0];
      if (synonymData.canonicals && synonymData.canonicals[baseName]) {
        return synonymData.canonicals[baseName];
      }
      if (synonymData.synonyms && synonymData.synonyms[cardIdentifier]) {
        return synonymData.synonyms[cardIdentifier];
      }
      return cardIdentifier;
    }

    return synonymData.canonicals[cardIdentifier] || synonymData.synonyms[cardIdentifier] || cardIdentifier;
  },

  /**
   * Check if synonyms are loaded
   * @returns {boolean}
   */
  isLoaded() {
    return synonymData !== null;
  }
};

// Pre-load synonym data on module import for better performance
loadSynonymData().catch(() => {
  // Silently continue - synonym resolution will be disabled
});
