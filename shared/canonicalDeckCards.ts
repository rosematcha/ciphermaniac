/**
 * Per-deck canonical card aggregation.
 *
 * When two printings of the same card appear in a single deck (e.g. an old and
 * a reprinted variant that a synonym mapping collapses to one canonical UID),
 * counting per row instead of per deck inflates presence counts — yielding
 * `found > deckTotal` and `pct > 100`. This helper resolves every card in a
 * deck to its canonical UID and sums copies per canonical UID, so downstream
 * counters can increment presence exactly once per deck.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add environment-specific dependencies here.
 * @module shared/canonicalDeckCards
 */

import { canonicalizeVariant } from './cardUtils';
import { getCanonicalCardFromData, type SynonymDatabase } from './synonyms';

export interface RawDeckCard {
  name?: string;
  set?: string | null;
  number?: string | number | null;
  count?: number | string | null;
}

export interface CanonicalDeckCard {
  /** Canonical UID (Name::SET::NUMBER) or bare name when set/number are absent. */
  uid: string;
  /** Display name derived from the canonical UID when possible. */
  name: string;
  /** Set code derived from the canonical UID, or null. */
  set: string | null;
  /** Card number derived from the canonical UID, or null. */
  number: string | null;
  /** Total copies of this canonical card across all matching rows in the deck. */
  copies: number;
}

/**
 * Aggregate a single deck's cards by canonical UID.
 *
 * The returned meta (`name`/`set`/`number`) is parsed from the canonical UID so
 * that it stays mutually consistent with the UID even when a synonym mapping
 * rewrote the variant (avoids emitting e.g. `uid: X::NEW::001` with the
 * first-seen variant's `set: OLD`, `number: 002`).
 * @param cards - Raw deck card rows
 * @param synonymDb - Synonym database (or null for no canonicalization)
 * @returns Map keyed by canonical UID → aggregated canonical card
 */
export function aggregateCanonicalCardsPerDeck(
  cards: RawDeckCard[] | null | undefined,
  synonymDb: SynonymDatabase | null
): Map<string, CanonicalDeckCard> {
  const result = new Map<string, CanonicalDeckCard>();
  const rows = Array.isArray(cards) ? cards : [];

  for (const card of rows) {
    const copies = Number(card?.count) || 0;
    if (!copies) {
      continue;
    }

    const name = card?.name || 'Unknown Card';
    const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
    const baseUid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;
    const uid = synonymDb ? getCanonicalCardFromData(synonymDb, baseUid) : baseUid;

    const existing = result.get(uid);
    if (existing) {
      existing.copies += copies;
      continue;
    }

    // Derive meta from the canonical UID so it stays consistent with the UID.
    let metaName = name;
    let metaSet: string | null = canonSet;
    let metaNumber: string | null = canonNumber;
    if (uid.includes('::')) {
      const parts = uid.split('::');
      metaName = parts[0] || name;
      metaSet = parts[1] || null;
      metaNumber = parts[2] || null;
    }

    result.set(uid, {
      uid,
      name: metaName,
      set: metaSet,
      number: metaNumber,
      copies
    });
  }

  return result;
}
