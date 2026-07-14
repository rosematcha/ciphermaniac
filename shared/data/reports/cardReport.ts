/**
 * Canonical card-report builder — the single home for the legacy-shape usage
 * report ({@link LegacyCardReport}: `{ deckTotal, items[] }` with `pct` 0-100,
 * `dist`, and `uid`/`set`/`number` derived from the canonical UID).
 *
 * Consolidated from `functions/lib/data/reportBuilder.ts` (the tested authority)
 * in DB-MASTER-PLAN Phase 2, slice 3. `reportBuilder.ts` now re-exports from
 * here so existing callers keep working unchanged.
 *
 * Behavioral notes vs. the legacy authority (both recorded as approved semantic
 * differences in `.github/data-migration-status.json`):
 * - D9: items carry an explicit total order. They are sorted by `pct`/`found`
 *   descending, then `name`, then canonical `uid` (see {@link sortReportItems}),
 *   so equal-found ties are input-order-independent. The previous builder sorted
 *   by found only, leaving ties dependent on first-seen deck order.
 * - D4 (preserved): `set`/`number` are always derived from the canonical UID,
 *   never from the first-seen variant's meta, so `uid`/`set`/`number` stay
 *   mutually consistent after a synonym rewrite.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/reports/cardReport
 */

import { canonicalizeVariant, getCanonicalCardFromData, type SynonymDatabase } from '../cardIdentity';
import { sanitizeDisplayName } from '../../cardUtils';
import {
  calculatePercentage,
  composeCategoryPath,
  createDistributionFromCounts,
  sortReportItems,
  type DistributionEntry
} from '../../reportUtils';

/**
 * A single card row of a deck accepted by {@link generateReportFromDecks}.
 * Production decks carry richer types; only these fields are consumed here.
 */
export interface CardEntry {
  name?: string;
  count?: number;
  set?: string;
  number?: string | number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

/**
 * A single deck accepted by {@link generateReportFromDecks}.
 */
export interface DeckEntry {
  cards?: CardEntry[];
}

/**
 * A single card row in the legacy-shape report.
 */
export interface ReportItem {
  rank: number;
  name: string;
  found: number;
  total: number;
  pct: number;
  dist: DistributionEntry[];
  set?: string;
  number?: string | number;
  uid?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
  category?: string;
}

/**
 * The legacy-shape card usage report.
 */
export interface LegacyCardReport {
  deckTotal: number;
  items: ReportItem[];
}

/**
 * Build the legacy-shape usage report from a list of decks.
 *
 * Presence is counted once per deck per canonical UID (two synonym variants in
 * one deck collapse to a single row — never yielding `pct > 100`). `set`/
 * `number`/`uid` are derived from the canonical UID so they stay mutually
 * consistent after a synonym rewrite (D4). Items carry an explicit total order:
 * `pct`/`found` descending, then `name`, then `uid` (D9).
 * @param deckList - Decks to aggregate
 * @param deckTotal - Denominator for `pct`/`total` (usually `deckList.length`)
 * @param synonymDb - Synonym database (or null for no canonicalization)
 * @returns Legacy-shape report `{ deckTotal, items }`
 */
export function generateReportFromDecks(
  deckList: DeckEntry[],
  deckTotal: number,
  synonymDb: SynonymDatabase | null
): LegacyCardReport {
  const cardData = new Map<string, number[]>();
  const nameCasing = new Map<string, string>();
  const uidMeta = new Map<string, CardMeta>();
  const uidCategory = new Map<string, CardMeta>();

  const decks = Array.isArray(deckList) ? deckList : [];

  for (const deck of decks) {
    const perDeckCounts = new Map<string, number>();
    const perDeckMeta = new Map<string, CardMeta>();
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];

    for (const card of cards) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const name = card?.name || 'Unknown Card';
      const category = card?.category || null;
      const trainerType = card?.trainerType || null;
      const energyType = card?.energyType || null;
      const aceSpec = Boolean(card?.aceSpec);
      const regulationMark = card?.regulationMark || null;

      const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
      let uid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;

      // Resolve to canonical synonym if database is available
      if (synonymDb) {
        uid = getCanonicalCardFromData(synonymDb, uid);
      }

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: canonSet || undefined,
        number: canonNumber || undefined,
        category: category || undefined,
        trainerType: trainerType || undefined,
        energyType: energyType || undefined,
        aceSpec: aceSpec || undefined,
        regulationMark: regulationMark || undefined
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, name);
      }
      if ((category || trainerType || energyType || aceSpec || regulationMark) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: category || undefined,
          trainerType: trainerType || undefined,
          energyType: energyType || undefined,
          aceSpec: aceSpec || undefined,
          regulationMark: regulationMark || undefined
        });
      }
    }

    perDeckCounts.forEach((totalCopies, uid) => {
      if (!cardData.has(uid)) {
        cardData.set(uid, []);
      }
      cardData.get(uid)!.push(totalCopies);

      if (!uidMeta.has(uid)) {
        uidMeta.set(uid, perDeckMeta.get(uid)!);
      }
    });
  }

  const items = Array.from(cardData.keys()).map(uid => {
    const countsList = cardData.get(uid) || [];
    const foundCount = countsList.length;
    // Preserve the display name's punctuation (e.g. the colon in "Technical
    // Machine: Evolution") while still stripping traversal/injection. Path
    // safety for keys/filenames is applied separately, not to display names.
    const rawName = nameCasing.get(uid) || uid;
    const safeName = sanitizeDisplayName(rawName);
    const item: ReportItem = {
      rank: 0,
      name: safeName,
      found: foundCount,
      total: deckTotal,
      pct: calculatePercentage(foundCount, deckTotal),
      dist: createDistributionFromCounts(countsList, foundCount)
    };

    if (uid.includes('::')) {
      // Derive set/number from the canonical UID itself so uid/set/number stay
      // mutually consistent. Reading them from the first-seen variant's
      // perDeckMeta would emit e.g. uid `X::NEW::001` alongside set `OLD` /
      // number `002` whenever a synonym mapping rewrote the variant.
      const [, canonicalSet, canonicalNumber] = uid.split('::');
      if (canonicalSet) {
        item.set = canonicalSet;
      }
      if (canonicalNumber) {
        item.number = canonicalNumber;
      }
      item.uid = uid;
    }

    const categoryInfo = uidCategory.get(uid) || uidMeta.get(uid);
    if (categoryInfo) {
      if (categoryInfo.trainerType) {
        item.trainerType = categoryInfo.trainerType;
      }
      if (categoryInfo.energyType) {
        item.energyType = categoryInfo.energyType;
      }
      if (categoryInfo.aceSpec) {
        item.aceSpec = true;
      }
      if (categoryInfo.regulationMark) {
        item.regulationMark = categoryInfo.regulationMark;
      }
      const categorySlug = composeCategoryPath(
        categoryInfo.category,
        categoryInfo.trainerType,
        categoryInfo.energyType,
        { aceSpec: Boolean(categoryInfo.aceSpec) }
      );
      if (categorySlug) {
        item.category = categorySlug;
      } else if (categoryInfo.category) {
        item.category = categoryInfo.category;
      }
    }

    return item;
  });

  // D9: total-order tie-breakers (pct/found desc, then name, then canonical
  // uid) make equal-found ties input-order-independent, then assign 1-based rank
  // over the deterministic order.
  const sorted = sortReportItems(items);
  sorted.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    deckTotal,
    items: sorted
  };
}

/**
 * Internal per-UID metadata accumulated while scanning decks.
 */
interface CardMeta {
  set?: string;
  number?: string;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}
