/**
 * Card synonyms utilities for server-side (Cloudflare Workers)
 * @module lib/cardSynonyms
 *
 * This module provides server-side card synonym resolution.
 * Core logic is shared with frontend via shared/data/cardIdentity
 */

import { coalescedRead } from '../coalesce';
import { EMPTY_DATABASE, getCanonicalCardFromData, type SynonymDatabase } from './cardIdentity';

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
 */
interface WorkerEnv {
  REPORTS?: R2Bucket;
}

const SYNONYM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Fetching and parsing the whole DB from R2 can outlast a D1 read, so joiners wait longer.
const SYNONYM_JOIN_MS = 5000;
const dbCache = new WeakMap<R2Bucket, { db: SynonymDatabase; expiresAt: number }>();
const readSynonyms = coalescedRead<SynonymDatabase>(SYNONYM_JOIN_MS);

async function fetchCardSynonyms(bucket: R2Bucket): Promise<SynonymDatabase> {
  try {
    const object = await bucket.get('assets/card-synonyms.json');
    if (!object) {
      console.warn('Card synonyms database not found');
      return EMPTY_DATABASE;
    }
    return JSON.parse(await object.text()) as SynonymDatabase;
  } catch (error: unknown) {
    console.error('Failed to load card synonyms database:', error instanceof Error ? error.message : String(error));
    return EMPTY_DATABASE;
  }
}

/** Only a parsed DB is pinned; a fetch in flight is shared through `coalescedRead`, never cached. */
export async function loadCardSynonyms(env: WorkerEnv): Promise<SynonymDatabase> {
  const bucket = env.REPORTS;
  if (!bucket) {
    return EMPTY_DATABASE;
  }
  const cached = dbCache.get(bucket);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.db;
  }
  const db = await readSynonyms(bucket, 'synonyms', () => fetchCardSynonyms(bucket));
  if (db !== EMPTY_DATABASE) {
    dbCache.set(bucket, { db, expiresAt: Date.now() + SYNONYM_CACHE_TTL_MS });
  }
  return db;
}
