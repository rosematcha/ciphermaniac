/**
 * The tournament side of the Fraudulent comparison.
 *
 * Fraudulent reads a card's reputation off the rolling online window and its
 * result off the tournament the user picked, so this turns that tournament's
 * master report into something the online rows can be looked up against.
 *
 * The lookup re-keys every event row onto TODAY's canonical print. Rebaked
 * events are already canonicalized to their own event-date print (D17), which
 * is the right thing for displaying that event but leaves the two sides of this
 * comparison speaking different UIDs — Worlds keys Dudunsparce as TEF 129 while
 * the online window keys it as PRE 080, and an unmapped join reports a 20%
 * online card as literally unplayed at the event. Only the join key is
 * rewritten; every rendered field still comes from the online row.
 * @module src/pages/socialGraphics/eventField
 */

import { getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/synonyms.js';
import { fetchMaster, type MasterPayload } from '../../lib/data';
import { itemUid } from '../../lib/data/compat';
import { getSynonymDatabase } from '../../utils/cardSynonyms';

/** One tournament's card counts, keyed so the online rows can join against them. */
export interface EventField {
  /** Decks at the tournament. */
  deckTotal: number;
  /** Canonical card UID to the number of those decks playing the card. */
  found: Map<string, number>;
  /**
   * Set codes that appeared at the tournament, the legality guard for the
   * comparison. The online window is always current, so any set released after
   * the chosen event would otherwise put its whole roster at the top of the
   * list — heavily played online, in none of the event's decks.
   */
  sets: Set<string>;
}

/**
 * Index a tournament's master report by today's canonical UID.
 * @param payload - The tournament's master report
 * @param db - The synonym database, or null to key by the report's own UIDs
 * @returns The indexed field
 */
export function buildEventField(payload: MasterPayload, db: SynonymDatabase | null): EventField {
  const found = new Map<string, number>();
  const sets = new Set<string>();
  for (const item of payload.items) {
    const uid = itemUid(item);
    const key = db ? getCanonicalCardFromData(db, uid) : uid;
    found.set(key, (found.get(key) ?? 0) + item.found);
    if (item.set) {
      sets.add(item.set.toUpperCase());
    }
  }
  return { deckTotal: payload.deckTotal, found, sets };
}

/**
 * Load the field for one tournament.
 *
 * The master report is fetched again rather than threaded down from the page's
 * own resource: the data client dedupes it, and keeping the fetch here means
 * the field is always built from the same payload it is keyed against.
 * @param tournament - The tournament key
 * @returns The indexed field, or null when the report has no decks
 */
export async function fetchEventField(tournament: string): Promise<EventField | null> {
  const [payload, db] = await Promise.all([fetchMaster(tournament), getSynonymDatabase()]);
  const field = buildEventField(payload, db);
  return field.deckTotal > 0 ? field : null;
}
