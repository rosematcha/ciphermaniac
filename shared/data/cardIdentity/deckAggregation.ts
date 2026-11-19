import { canonicalizeVariant, cardUidOrName, parseCardUid } from './identifiers';
import { getCanonicalCardFromData, type SynonymDatabase } from './synonyms';

export interface RawDeckCard {
  name?: string;
  set?: string | null;
  number?: string | number | null;
  count?: number | string | null;
}
export interface CanonicalDeckCard {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
  copies: number;
}

function canonicalCard(
  card: RawDeckCard,
  synonymDb: SynonymDatabase | null,
  resolveUid: ((uid: string) => string) | undefined
): CanonicalDeckCard {
  const name = card.name || 'Unknown Card';
  const [set, number] = canonicalizeVariant(card.set, card.number);
  const raw = cardUidOrName(name, set, number);
  const uid = resolveUid ? resolveUid(raw) : getCanonicalCardFromData(synonymDb, raw);
  const parsed = parseCardUid(uid);
  return {
    uid,
    name: parsed?.name ?? name,
    set: parsed?.set ?? set,
    number: parsed?.number ?? number,
    copies: Number(card.count) || 0
  };
}

/**
 * One deck's cards keyed by canonical UID, copies summed across printings.
 * @param cards - The deck's card rows
 * @param synonymDb - Synonym database for the global canonical (or null)
 * @param resolveUid - A scope's own print choice, used instead of the global canonical
 * @returns Canonical UID → card
 */
export function aggregateCanonicalCardsPerDeck(
  cards: RawDeckCard[] | null | undefined,
  synonymDb: SynonymDatabase | null,
  resolveUid?: (uid: string) => string
): Map<string, CanonicalDeckCard> {
  const result = new Map<string, CanonicalDeckCard>();
  for (const row of cards ?? []) {
    const card = canonicalCard(row, synonymDb, resolveUid);
    if (!card.copies) {
      continue;
    }
    const existing = result.get(card.uid);
    if (existing) {
      existing.copies += card.copies;
    } else {
      result.set(card.uid, card);
    }
  }
  return result;
}
