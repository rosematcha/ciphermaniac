/**
 * Card synonyms utilities for handling reprints and alternate versions
 * @module utils/cardSynonyms
 *
 * This module provides browser-side card synonym resolution.
 * Core logic is shared with backend via shared/synonyms
 */

import { EMPTY_DATABASE, type SynonymDatabase } from '../../shared/synonyms.js';

const SYNONYMS_URL = 'https://r2.ciphermaniac.com/assets/card-synonyms.json';

// The promise is memoized (not the resolved value) so the concurrent callers
// on a cold page load — fetchMaster/fetchArchetype/etc. all ask for the DB in
// parallel — share one network fetch. A failed load resolves to the empty
// database for its callers but is evicted so a later navigation retries
// instead of silently losing canonicalization for the whole session.
let synonymPromise: Promise<SynonymDatabase> | null = null;

async function loadSynonymData(): Promise<SynonymDatabase> {
  // Try sessionStorage first to avoid re-fetching on page navigation within same session
  try {
    const cached = sessionStorage.getItem('cardSynonymsData');
    if (cached) {
      return (JSON.parse(cached) as SynonymDatabase | null) ?? EMPTY_DATABASE;
    }
  } catch {
    // sessionStorage unavailable or parse error — fall through to fetch
  }

  try {
    const response = await fetch(SYNONYMS_URL);
    if (!response.ok) {
      console.warn('Card synonyms data not found, synonym resolution disabled');
      synonymPromise = null;
      return EMPTY_DATABASE;
    }
    const data = ((await response.json()) as SynonymDatabase | null) ?? EMPTY_DATABASE;
    // Cache in sessionStorage for subsequent page navigations
    try {
      sessionStorage.setItem('cardSynonymsData', JSON.stringify(data));
    } catch {
      // Quota exceeded — still works via the memoized promise
    }
    return data;
  } catch (error) {
    console.warn('Failed to load card synonyms:', error);
    synonymPromise = null;
    return EMPTY_DATABASE;
  }
}

/**
 * Get the cached synonym database, loading it on first call.
 * Concurrent callers share the in-flight fetch; the result is cached in
 * sessionStorage so later sessions in the same tab skip the network.
 */
export async function getSynonymDatabase(): Promise<SynonymDatabase> {
  if (!synonymPromise) {
    synonymPromise = loadSynonymData();
  }
  return synonymPromise;
}
