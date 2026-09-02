/**
 * The online side of the Fraudulent comparison — how the ladder's own decks
 * finished with each card.
 *
 * Play rate is the reputation; this is whether the reputation was earned. The
 * counts come from `cardSuccess.json`, written by the online-meta cron beside
 * master.json, because the only other record of those finishes is a 36 MB
 * `decks.json` no browser should download.
 *
 * Keys are re-mapped onto today's canonical print for the same reason the event
 * side is: the artifact is canonicalized when the cron runs, and a synonym
 * update between then and now would silently unjoin a card.
 * @module src/pages/socialGraphics/onlineField
 */

import { getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/synonyms.js';
import type { CardSuccessIndex, SuccessCounts } from '../../../shared/data/reports/cardSuccess';
import { fetchCardSuccessIndex } from '../../lib/data';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import { ONLINE_META_NAME } from '../../lib/constants';

/** Online finish rates, keyed to join against the online master's rows. */
export interface OnlineField {
  /** Which finish counts as success (`top25`), for the graphic to name. */
  tag: string;
  /** Decks in fields large enough for that tag to be earnable. */
  deckTotal: number;
  /** Of those, how many earned it — the rate a card is read against. */
  successTotal: number;
  /** Canonical card UID to its eligible / successful deck counts. */
  cards: Map<string, SuccessCounts>;
}

/**
 * Re-key a published success index onto today's canonical prints.
 * @param index - The `cardSuccess.json` payload
 * @param db - The synonym database, or null to key by the artifact's own UIDs
 * @returns The indexed field
 */
export function buildOnlineField(index: CardSuccessIndex, db: SynonymDatabase | null): OnlineField {
  const cards = new Map<string, SuccessCounts>();
  for (const [uid, counts] of Object.entries(index.cards)) {
    const key = db ? getCanonicalCardFromData(db, uid) : uid;
    const entry = cards.get(key) ?? { decks: 0, success: 0 };
    entry.decks += counts.decks;
    entry.success += counts.success;
    cards.set(key, entry);
  }
  return { tag: index.tag, deckTotal: index.deckTotal, successTotal: index.successTotal, cards };
}

/**
 * Load the online window's finish rates.
 * @returns The field, or null when the cron has not published one yet
 */
export async function fetchOnlineField(): Promise<OnlineField | null> {
  const [index, db] = await Promise.all([fetchCardSuccessIndex(ONLINE_META_NAME), getSynonymDatabase()]);
  if (!index || index.deckTotal <= 0) {
    return null;
  }
  return buildOnlineField(index, db);
}

/** The window's own success rate (0..100), the null hypothesis for a card. */
export function onlineFieldRate(field: OnlineField): number {
  return field.deckTotal > 0 ? (field.successTotal / field.deckTotal) * 100 : 0;
}
