/**
 * Card synonyms utilities for server-side (Cloudflare Workers)
 * @module lib/cardSynonyms
 *
 * This module provides server-side card synonym resolution.
 * Core logic is shared with frontend via shared/synonyms
 */

import { EMPTY_DATABASE, getCanonicalCardFromData, type SynonymDatabase } from '../synonyms';

// Re-export core functions with original names for backwards compatibility
export { getCanonicalCardFromData as getCanonicalCard };

/**
 * Fetch and parse card synonyms database from R2.
 *
 * Reads from `assets/card-synonyms.json` on the `REPORTS` bucket. No KV cache:
 * the synonym DB updates frequently (daily cron) and a 24h KV TTL would mask
 * fresh data from the Worker. Instead the parsed DB is pinned per bucket
 * binding for a short TTL, so a warm isolate skips the R2 fetch + JSON parse
 * on every request while still picking up the daily cron's fresh DB within
 * the hour. Keying by binding identity (WeakMap) rather than a module scalar
 * keeps test envs isolated from each other.
 *
 * The `CARD_TYPES_KV` field is preserved on the `WorkerEnv` interface only so
 * legacy callers and tests don't break; nothing reads from it here anymore.
 */
interface WorkerEnv {
  CARD_TYPES_KV?: KVNamespace;
  REPORTS?: R2Bucket;
}

const SYNONYM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const dbCache = new WeakMap<R2Bucket, { db: SynonymDatabase; at: number }>();

export async function loadCardSynonyms(env: WorkerEnv): Promise<SynonymDatabase> {
  try {
    if (env.REPORTS) {
      const cached = dbCache.get(env.REPORTS);
      if (cached && Date.now() - cached.at < SYNONYM_CACHE_TTL_MS) {
        return cached.db;
      }

      const object = await env.REPORTS.get('assets/card-synonyms.json');
      if (object) {
        const text = await object.text();
        const db = JSON.parse(text) as SynonymDatabase;
        dbCache.set(env.REPORTS, { db, at: Date.now() });
        return db;
      }
    }

    console.warn('Card synonyms database not found');
    return EMPTY_DATABASE;
  } catch (error: any) {
    console.error('Failed to load card synonyms database:', error.message);
    return EMPTY_DATABASE;
  }
}
