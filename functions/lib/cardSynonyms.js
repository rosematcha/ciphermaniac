/**
 * Card synonyms utilities for server-side (Cloudflare Workers)
 * @module lib/cardSynonyms
 *
 * This module provides server-side card synonym resolution.
 * Core logic is shared with frontend via shared/synonyms.ts
 */

import {
  EMPTY_DATABASE,
  getCanonicalCardFromData,
  getCardVariantsFromData,
  hasCardSynonymsInData
} from '../../shared/synonyms.js';

// Re-export core functions with original names for backwards compatibility
export { getCanonicalCardFromData as getCanonicalCard };
export { hasCardSynonymsInData as hasCardSynonyms };
export { getCardVariantsFromData as getCardVariants };

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
    return EMPTY_DATABASE;
  } catch (error) {
    console.error('Failed to load card synonyms database:', error.message);
    return EMPTY_DATABASE;
  }
}
