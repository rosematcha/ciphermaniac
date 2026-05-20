/**
 * Card synonyms utilities for server-side (Cloudflare Workers)
 * @module lib/cardSynonyms
 *
 * This module provides server-side card synonym resolution.
 * Core logic is shared with frontend via shared/synonyms
 */

import { EMPTY_DATABASE, getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/synonyms';

// Re-export core functions with original names for backwards compatibility
export { getCanonicalCardFromData as getCanonicalCard };

/**
 * Fetch and parse card synonyms database from R2.
 *
 * Reads from `assets/card-synonyms.json` on the `REPORTS` bucket. No KV cache:
 * the synonym DB updates frequently (daily cron) and a 24h KV TTL would mask
 * fresh data from the Worker. Callers that re-invoke `loadCardSynonyms` within
 * the same isolate should pin the result themselves (see
 * `functions/cards/[set]/[number].ts` for an example).
 *
 * The `CARD_TYPES_KV` field is preserved on the `WorkerEnv` interface only so
 * legacy callers and tests don't break; nothing reads from it here anymore.
 */
interface WorkerEnv {
  CARD_TYPES_KV?: KVNamespace;
  REPORTS?: R2Bucket;
}

export async function loadCardSynonyms(env: WorkerEnv): Promise<SynonymDatabase> {
  try {
    if (env.REPORTS) {
      const object = await env.REPORTS.get('assets/card-synonyms.json');
      if (object) {
        const text = await object.text();
        return JSON.parse(text);
      }
    }

    console.warn('Card synonyms database not found');
    return EMPTY_DATABASE;
  } catch (error: any) {
    console.error('Failed to load card synonyms database:', error.message);
    return EMPTY_DATABASE;
  }
}
