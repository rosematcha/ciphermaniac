/**
 * Card synonyms utilities for handling reprints and alternate versions
 * @module utils/cardSynonyms
 */

// Lazy-loaded synonym data
let synonymData = null;

/**
 * Basic energy canonical overrides
 * Basic energies should always resolve to the most recent cheap common version
 * rather than expensive special printings
 */
const BASIC_ENERGY_CANONICALS = {
  'Grass Energy': 'Grass Energy::SVE::017',
  'Psychic Energy': 'Psychic Energy::SVE::021',
  'Lightning Energy': 'Lightning Energy::SVE::019',
  'Fire Energy': 'Fire Energy::SVE::018',
  'Darkness Energy': 'Darkness Energy::SVE::015',
  'Metal Energy': 'Metal Energy::SVE::020',
  'Fighting Energy': 'Fighting Energy::SVE::016',
  'Water Energy': 'Water Energy::SVE::022',
};

/**
 * Load synonym data from JSON file
 * @returns {Promise<object>} Synonym data object
 */
async function loadSynonymData() {
  if (synonymData) {
    return synonymData;
  }

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
  if (!cardIdentifier) {
    return cardIdentifier;
  }

  // Check for basic energy override first (before loading synonym data)
  // This ensures basic energies always use the cheap common versions
  if (cardIdentifier.includes('::')) {
    const baseName = String(cardIdentifier).split('::')[0];
    if (BASIC_ENERGY_CANONICALS[baseName]) {
      return BASIC_ENERGY_CANONICALS[baseName];
    }
  } else if (BASIC_ENERGY_CANONICALS[cardIdentifier]) {
    return BASIC_ENERGY_CANONICALS[cardIdentifier];
  }

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
  if (!cardIdentifier) {
    return false;
  }

  const data = await loadSynonymData();

  return Boolean(
    data.synonyms[cardIdentifier] || data.canonicals[cardIdentifier]
  );
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

  // For basic energies, we need to find variants that map to the JSON canonical
  // (not our overridden cheap canonical), but still return our override as the primary
  let jsonCanonical = canonical;

  // Check if this is a basic energy
  const baseName = cardIdentifier.includes('::')
    ? String(cardIdentifier).split('::')[0]
    : cardIdentifier;

  if (BASIC_ENERGY_CANONICALS[baseName]) {
    // Get the "real" canonical from the JSON data (expensive version)
    if (cardIdentifier.includes('::')) {
      const baseNameFromId = String(cardIdentifier).split('::')[0];
      if (data.canonicals && data.canonicals[baseNameFromId]) {
        jsonCanonical = data.canonicals[baseNameFromId];
      }
    } else if (data.canonicals && data.canonicals[cardIdentifier]) {
      jsonCanonical = data.canonicals[cardIdentifier];
    }
  }

  // Find all UIDs that map to the JSON canonical
  const variants = [canonical]; // Start with our overridden canonical

  for (const [uid, canonicalUID] of Object.entries(data.synonyms)) {
    // Match against JSON canonical to find all variants
    if (canonicalUID === jsonCanonical && uid !== canonical) {
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
    if (!cardIdentifier) {
      return cardIdentifier;
    }

    // Check for basic energy override first
    if (String(cardIdentifier).includes('::')) {
      const baseName = String(cardIdentifier).split('::')[0];
      if (BASIC_ENERGY_CANONICALS[baseName]) {
        return BASIC_ENERGY_CANONICALS[baseName];
      }
    } else if (BASIC_ENERGY_CANONICALS[cardIdentifier]) {
      return BASIC_ENERGY_CANONICALS[cardIdentifier];
    }

    if (!synonymData) {
      return cardIdentifier;
    }

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

    return (
      synonymData.canonicals[cardIdentifier] ||
      synonymData.synonyms[cardIdentifier] ||
      cardIdentifier
    );
  },

  /**
   * Check if synonyms are loaded
   * @returns {boolean}
   */
  isLoaded() {
    return synonymData !== null;
  }
};

/**
 * Get image candidates from card variants (for fallback when primary image fails)
 * Returns candidates from all variants (newest to oldest, excluding the current identifier)
 * @param {string} cardIdentifier - Card UID or name
 * @param {boolean} useSm - Whether to use small (true) or extra-small (false) thumbnails
 * @param {object} overrides - Image filename overrides
 * @returns {Promise<string[]>} Array of image URL candidates from variants
 */
export async function getVariantImageCandidates(
  cardIdentifier,
  useSm = false,
  overrides = {}
) {
  try {
    const variants = await getCardVariants(cardIdentifier);
    if (!variants || variants.length <= 1) {
      return [];
    }

    // Import dependencies dynamically to avoid circular dependency
    const { buildThumbCandidates } = await import('../thumbs.js');
    const { getDisplayName, parseDisplayName } = await import(
      '../card/identifiers.js'
    );

    const candidates = [];

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

      let variant = {};
      if (parsed.setId) {
        const setMatch = parsed.setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
        if (setMatch) {
          variant = { set: setMatch[1], number: setMatch[2] };
        }
      }

      // Get candidates for this variant
      const variantCandidates = buildThumbCandidates(
        parsed.name,
        useSm,
        overrides,
        variant
      );
      candidates.push(...variantCandidates);
    }

    return candidates;
  } catch (error) {
    console.warn('Failed to get variant image candidates:', error);
    return [];
  }
}

// Pre-load synonym data on module import for better performance
loadSynonymData().catch(() => {
  // Silently continue - synonym resolution will be disabled
});
