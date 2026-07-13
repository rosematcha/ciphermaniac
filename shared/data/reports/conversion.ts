/**
 * Canonical LEGACY-shape Day 2 conversion index builder — the single home for
 * the per-card Day 1 -> Day 2 counts production publishes as `conversion.json`.
 *
 * Schema (legacy, what `src/lib/data.ts` reads today):
 *   `{ day1Total, day2Total, cards: { "<canonicalUID>": { day1, day2 } } }`
 *
 * Consolidated in DB-MASTER-PLAN Phase 2, slice 4 as a faithful port of the only
 * current producer, Python's `download-tournament.py::build_conversion_index`.
 * Python can't run inside the JS test suite, so
 * `tests/data/card-usage-conversion-parity.test.ts` pins this builder against
 * hand-authored expectations derived from the Python semantics. There is no
 * TypeScript producer today; this becomes the canonical one.
 *
 * Semantics (mirroring Python exactly):
 * - Day 2 membership is the deck's `madePhase2` flag; `day2Total` counts Day 2
 *   decks and `day1Total` is the full deck population.
 * - A canonical card is counted once per deck (a deck listing two variant
 *   printings that collapse to one canonical UID counts once) — the per-deck
 *   `seen` set.
 * - Only cards with a canonicalizable set AND number are counted; bare-name
 *   cards (e.g. basic energy) are skipped, matching Python's guard.
 * - Returns `null` when no deck made Day 2 (no conversion without a Day 2), so
 *   `day2Total` in any emitted index is always >= 1.
 *
 * Ordering: `cards` keys follow first-seen order (deck order, then card order
 * within a deck), identical to Python's dict insertion — no re-sort is applied.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/reports/conversion
 */

import { canonicalizeVariant, getCanonicalCardFromData, type SynonymDatabase } from '../cardIdentity';

/** A single deck card row consumed by {@link buildConversionIndex}. */
export interface ConversionDeckCard {
  name?: string;
  set?: string | null;
  number?: string | number | null;
}

/** A single deck consumed by {@link buildConversionIndex}. */
export interface ConversionDeck {
  /** True when the deck advanced to Day 2. */
  madePhase2?: boolean;
  cards?: readonly ConversionDeckCard[] | null;
}

/** Day 1 / Day 2 deck counts for one card. */
export interface ConversionCounts {
  /** Decks (Day 1) that ran the card. */
  day1: number;
  /** Day 2 decks that ran the card. */
  day2: number;
}

/** The legacy `conversion.json` payload. */
export interface LegacyConversionIndex {
  /** Total decks (Day 1 population). */
  day1Total: number;
  /** Day 2 deck count. */
  day2Total: number;
  /** Canonical UID -> its Day 1 / Day 2 counts, in first-seen order. */
  cards: Record<string, ConversionCounts>;
}

/**
 * Build the legacy `conversion.json` index for one tournament — a faithful port
 * of Python's `build_conversion_index`. Buckets decks by their `madePhase2`
 * flag, dedupes cards per deck by canonical UID, and counts Day 1 / Day 2 decks
 * per card. Cards without a canonicalizable set+number are skipped.
 * @param allDecks - Every deck in the tournament
 * @param synonymDb - Synonym database for canonical UID resolution (or null)
 * @returns The conversion index, or `null` when no deck made Day 2
 */
export function buildConversionIndex(
  allDecks: readonly ConversionDeck[] | null | undefined,
  synonymDb: SynonymDatabase | null = null
): LegacyConversionIndex | null {
  if (!allDecks || allDecks.length === 0) {
    return null;
  }
  if (!allDecks.some(deck => deck?.madePhase2)) {
    return null;
  }

  const cards: Record<string, ConversionCounts> = {};
  let day2Total = 0;

  for (const deck of allDecks) {
    const isDay2 = Boolean(deck?.madePhase2);
    if (isDay2) {
      day2Total += 1;
    }
    const seen = new Set<string>();
    for (const card of deck?.cards ?? []) {
      const setCode = card?.set;
      const number = card?.number;
      if (!setCode || number === null || number === undefined || number === '') {
        continue;
      }
      const [sc, num] = canonicalizeVariant(setCode, number);
      if (!sc || !num) {
        continue;
      }
      const rawUid = `${card?.name ?? ''}::${sc}::${num}`;
      const uid = getCanonicalCardFromData(synonymDb, rawUid);
      if (seen.has(uid)) {
        continue;
      }
      seen.add(uid);
      const entry = (cards[uid] ??= { day1: 0, day2: 0 });
      entry.day1 += 1;
      if (isDay2) {
        entry.day2 += 1;
      }
    }
  }

  return { day1Total: allDecks.length, day2Total, cards };
}
