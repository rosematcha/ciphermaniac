/**
 * Shared deck-card identity helpers.
 *
 * `buildCardId` (re-exported from clientSideFiltering) builds the `SET~NUMBER`
 * key the filter aggregator uses. `canonicalizeDeckCard` rewrites a deck card to
 * its canonical printing so a cardId built from a canonicalized report item (the
 * data layer canonicalizes reports at read time) matches the deck-side card.
 *
 * Both were originally local to AdvancedPanel; lifted here so the card-impact
 * analyzer counts cards exactly the same way.
 */
import type { DeckCard } from '../types';
import { getCanonicalCardFromData } from '../../shared/synonyms.js';
import { normalizeCardNumber } from '../../shared/cardUtils.js';
import { buildCardId } from './clientSideFiltering';

export { buildCardId };

/**
 * Rewrite a deck card's (name, set, number) to the canonical printing. Without
 * this, a rule built from e.g. Dragapult ex PRE/073 would match zero decks that
 * list the card under TWM/130.
 *
 * The synonym DB keys numbers in zero-padded form (e.g. JTG::098) but deck cards
 * carry the raw integer (e.g. JTG/98), so normalize before the lookup.
 */
export function canonicalizeDeckCard(card: DeckCard, db: Parameters<typeof getCanonicalCardFromData>[0]): DeckCard {
  if (!card?.name || !card?.set || card.number === undefined || card.number === null) {
    return card;
  }
  const normalizedNumber = normalizeCardNumber(card.number) || String(card.number);
  const variantUid = `${card.name}::${card.set}::${normalizedNumber}`;
  const canonical = getCanonicalCardFromData(db, variantUid);
  if (canonical === variantUid) {
    return card;
  }
  const parts = canonical.split('::');
  if (parts.length < 3) {
    return card;
  }
  return { ...card, name: parts[0], set: parts[1], number: parts[2] };
}
