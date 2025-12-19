/**
 * Card synonyms utilities for server-side (Cloudflare Workers)
 * @module lib/cardSynonyms
 */

/**
 * Fetch and parse card synonyms database from R2/KV
 * @param {object} env - Cloudflare Workers environment
 * @returns {Promise<Object>}
 */
export async function loadCardSynonyms(env) {
  try {
    // Try to get from KV first (faster)
    if (env.CARD_TYPES_KV) {
      const cached = await env.CARD_TYPES_KV.get('card-synonyms-database', 'json');
      if (cached) {
        return cached;
      }
    }

    // Fall back to R2 bucket
    if (env.REPORTS) {
      const object = await env.REPORTS.get('assets/card-synonyms.json');
      if (object) {
        const text = await object.text();
        const data = JSON.parse(text);

        // Cache in KV if available
        if (env.CARD_TYPES_KV) {
          await env.CARD_TYPES_KV.put('card-synonyms-database', JSON.stringify(data), {
            expirationTtl: 86400 // Cache for 24 hours
          });
        }

        return data;
      }
    }

    console.warn('Card synonyms database not found');
    return { synonyms: {}, canonicals: {} };
  } catch (error) {
    console.error('Failed to load card synonyms database:', error.message);
    return { synonyms: {}, canonicals: {} };
  }
}

/**
 * Get the canonical UID for a given card UID
 * @param {Object} database - Synonym database
 * @param {string} cardIdentifier - Card UID (Name::SET::NUMBER)
 * @returns {string} Canonical UID or original identifier
 */
export function getCanonicalCard(database, cardIdentifier) {
  if (!database || !cardIdentifier) {
    return cardIdentifier;
  }

  // Check explicit synonym mapping
  if (database.synonyms && database.synonyms[cardIdentifier]) {
    return database.synonyms[cardIdentifier];
  }

  // Check if it's already a canonical
  if (database.canonicals && database.canonicals[cardIdentifier]) {
    return database.canonicals[cardIdentifier];
  }

  return cardIdentifier;
}
