/**
 * Card-page route resolution for the SPA.
 *
 * The graph properties (terminal, acyclic, idempotent) live in
 * shared/data/canonicalCardRoute, which the edge redirect in
 * functions/cards/[set]/[number].ts uses too — one resolver, so the two sides
 * cannot 301 at each other. This module is the browser's binding of it: the
 * synonym-DB-keyed index cache and the item lookups built on top.
 * @module src/lib/data/routes
 */

import {
  buildCanonicalRouteIndex,
  type CanonicalRouteIndex,
  canonicalRouteKey,
  resolveCanonicalRoute
} from '../../../shared/data/canonicalCardRoute';
import type { SynonymDatabase } from '../../../shared/synonyms.js';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import type { CardItem } from '../../types';

// --- Card lookup helpers ---

/**
 * Find a card in the master report by its set + number identifier.
 * Set comparison is case-insensitive. Number comparison normalizes leading zeros
 * (so PAL/185 matches PAL/0185 etc.).
 *
 * Note: items in the returned list carry canonical set/number (the data layer
 * canonicalizes at read time — see `canonicalizeReport`), so a non-canonical
 * (reprint) set/number will not be found here. Callers wanting to handle
 * non-canonical URLs should resolve via `resolveCanonicalSetNumber` first, or
 * rely on the edge redirect in `functions/cards/[set]/[number].ts`.
 */
function findCardBySetNumber(items: CardItem[], set: string, number: string): CardItem | undefined {
  const setU = set.toUpperCase();
  const targetKey = normalizeCardNumberKey(number);
  return items.find(item => {
    if (!item.set || item.set.toUpperCase() !== setU) {
      return false;
    }
    if (!item.number) {
      return false;
    }
    return normalizeCardNumberKey(String(item.number)) === targetKey;
  });
}

/**
 * Resolve a (set, number) to the canonical `SET::NUMBER` key of its synonym
 * cluster. A variant pair maps to its global canonical; an already-canonical (or
 * unknown) pair maps to itself. Lets callers compare two prints of the same
 * cluster — a rolling-canonical master item and the global-canonical URL — for
 * equality without importing any date logic.
 */
function canonicalSetNumberKey(db: { synonyms: Record<string, string> }, set: string, number: string): string {
  return canonicalRouteKey(getSetNumberCanonicalIndex(db), set, number);
}

// Per items array: canonical SET::NUMBER key → item. Items on a rebaked master
// carry rolling prints, so a direct set/number match against the global-canonical
// URL misses; resolving both sides to the cluster's canonical key aligns them.
const canonicalItemIndexCache = new WeakMap<CardItem[], Map<string, CardItem>>();

/**
 * Like {@link findCardBySetNumber}, but cluster-aware: resolves both the
 * requested (set, number) and each item's (set, number) to their canonical
 * cluster key before comparing. Finds a rolling-variant master item from the
 * global-canonical URL, and vice versa (stale links to a variant print). Falls
 * back to the exact match when the DB is unavailable.
 */
export function findCardBySetNumberCanonical(
  items: CardItem[],
  set: string,
  number: string,
  db: SynonymDatabase | null
): CardItem | undefined {
  if (!db?.synonyms) {
    return findCardBySetNumber(items, set, number);
  }
  let index = canonicalItemIndexCache.get(items);
  if (!index) {
    index = new Map<string, CardItem>();
    for (const item of items) {
      if (!item.set || item.number == null) {
        continue;
      }
      const key = canonicalSetNumberKey(db, item.set, String(item.number));
      if (!index.has(key)) {
        index.set(key, item);
      }
    }
    canonicalItemIndexCache.set(items, index);
  }
  return index.get(canonicalSetNumberKey(db, set, number)) ?? findCardBySetNumber(items, set, number);
}

/**
 * Normalize a card number so reprints with leading zeros (PAL/185 vs PAL/0185)
 * collapse, but promo-suffixed variants (PAL/185 vs PAL/185a) do NOT. Splits
 * the number into a digit prefix and an alphabetic suffix; strips leading zeros
 * from the digit prefix only.
 */
export function normalizeCardNumberKey(raw: string): string {
  const upper = raw.toUpperCase();
  const match = upper.match(/^(\d+)(.*)$/);
  if (!match) {
    return upper;
  }
  const digits = match[1].replace(/^0+/, '') || '0';
  return `${digits}${match[2]}`;
}

/**
 * Resolve a (set, number) to its canonical (set, number) via the synonym DB.
 * Returns null if the input pair has no canonical mapping (i.e. it's already
 * canonical or unknown). Used by CardPage to redirect non-canonical URLs.
 */
export async function resolveCanonicalSetNumber(
  set: string,
  number: string
): Promise<{ set: string; number: string } | null> {
  const db = await getSynonymDatabase();
  if (!db || !db.synonyms) {
    return null;
  }
  const canonical = resolveCanonicalRoute(getSetNumberCanonicalIndex(db), set, number);
  return canonical ? { set: canonical.set, number: canonical.number } : null;
}

// (set,number) → canonical route index. Built lazily once per synonym DB load
// so we don't re-scan db.synonyms (~thousands of entries) on every cold card
// view. The build itself lives in shared/data/canonicalCardRoute so the edge
// redirect in functions/cards/[set]/[number].ts resolves identically.
const setNumberIndexCache = new WeakMap<object, CanonicalRouteIndex>();

function getSetNumberCanonicalIndex(db: { synonyms: Record<string, string> }): CanonicalRouteIndex {
  const cached = setNumberIndexCache.get(db);
  if (cached) {
    return cached;
  }
  const index = buildCanonicalRouteIndex(db);
  setNumberIndexCache.set(db, index);
  return index;
}
