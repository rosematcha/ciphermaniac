/**
 * Card synonyms utilities for handling reprints and alternate versions
 * @module utils/cardSynonyms
 */
import { CONFIG } from '../config.js';
// Lazy-loaded synonym data
let synonymData = null;
/**
 * Load synonym data from JSON file
 * @returns Synonym data object
 */
async function loadSynonymData() {
    if (synonymData) {
        return synonymData;
    }
    try {
        const response = await fetch(CONFIG.API.SYNONYMS_URL);
        if (!response.ok) {
            console.warn('Card synonyms data not found, synonym resolution disabled');
            return { synonyms: {}, canonicals: {} };
        }
        synonymData = await response.json();
        return synonymData;
    }
    catch (error) {
        console.warn('Failed to load card synonyms:', error);
        return { synonyms: {}, canonicals: {} };
    }
}
/**
 * Get the canonical UID for a given card UID or name
 * @param cardIdentifier - Card UID or name
 * @returns Canonical UID or original identifier if no mapping exists
 */
export async function getCanonicalCard(cardIdentifier) {
    if (!cardIdentifier) {
        return cardIdentifier;
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
 * @param cardIdentifier - Card UID or name
 * @returns True if card has synonyms
 */
export async function hasCardSynonyms(cardIdentifier) {
    if (!cardIdentifier) {
        return false;
    }
    const data = await loadSynonymData();
    return Boolean(data.synonyms[cardIdentifier] || data.canonicals[cardIdentifier]);
}
/**
 * Normalize card identifier for search/comparison
 * Always returns the canonical version
 * @param cardIdentifier - Card UID or name
 * @returns Normalized card identifier
 */
export function normalizeCardIdentifier(cardIdentifier) {
    return getCanonicalCard(cardIdentifier);
}
/**
 * Get all variant UIDs for a card by checking reverse mappings
 * @param cardIdentifier - Card UID or name
 * @returns Array of all variant UIDs including canonical
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
     * @param cardIdentifier
     * @returns
     */
    getCanonicalCard(cardIdentifier) {
        if (!cardIdentifier) {
            return cardIdentifier;
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
        return synonymData.canonicals[cardIdentifier] || synonymData.synonyms[cardIdentifier] || cardIdentifier;
    },
    /**
     * Check if synonyms are loaded
     * @returns
     */
    isLoaded() {
        return synonymData !== null;
    }
};
/**
 * Get image candidates from card variants (for fallback when primary image fails)
 * Returns candidates from all variants (newest to oldest, excluding the current identifier)
 * @param cardIdentifier - Card UID or name
 * @param useSm - Whether to use small (true) or extra-small (false) thumbnails
 * @param overrides - Image filename overrides
 * @returns Array of image URL candidates from variants
 */
export async function getVariantImageCandidates(cardIdentifier, useSm = false, overrides = {}) {
    try {
        const variants = await getCardVariants(cardIdentifier);
        if (!variants || variants.length <= 1) {
            return [];
        }
        // Import dependencies dynamically to avoid circular dependency
        const { buildThumbCandidates } = await import('../thumbs.js');
        const { getDisplayName, parseDisplayName } = await import('../card/identifiers.js');
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
            const variantCandidates = buildThumbCandidates(parsed.name, useSm, overrides, variant);
            candidates.push(...variantCandidates);
        }
        return candidates;
    }
    catch (error) {
        console.warn('Failed to get variant image candidates:', error);
        return [];
    }
}
// Pre-load synonym data on module import for better performance
loadSynonymData().catch(() => {
    // Silently continue - synonym resolution will be disabled
});
