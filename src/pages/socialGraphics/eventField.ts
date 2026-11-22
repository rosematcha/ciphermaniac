/**
 * One baseline event for the Rising graphic: how many of its decks ran each
 * card, and which sets it saw.
 *
 * The lookup re-keys every event row onto TODAY's canonical print. Rebaked
 * events are already canonicalized to their own event-date print, which is the
 * right thing for displaying that event but leaves it and the selected report
 * speaking different UIDs — Worlds keys Dudunsparce as TEF 129 while the online
 * window keys it as PRE 080, and an unmapped join reports a 20% card as
 * literally unplayed at the event.
 * @module src/pages/socialGraphics/eventField
 */

import { getCanonicalCardFromData, itemUid, type SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import { fetchMaster, type MasterPayload } from '../../lib/data';
import { getSynonymDatabase } from '../../utils/cardSynonyms';

/** One tournament's card counts, keyed by canonical UID. */
export interface EventField {
  /** Identity map used to align event-date prints with this field's keys. */
  synonymDatabase?: SynonymDatabase | null;
  /** Decks at the tournament. */
  deckTotal: number;
  /** Canonical card UID to the decks at the tournament that ran it. */
  cards: Map<string, number>;
  /**
   * Set codes that appeared at the tournament, the legality guard: a set
   * released after the event would otherwise count as a 0% baseline.
   */
  sets: Set<string>;
}

/**
 * Index a tournament's master report by canonical UID.
 * @param master - The tournament's master report
 * @param db - The synonym database, or null to key by the report's own UIDs
 * @returns The indexed field
 */
export function buildEventField(master: MasterPayload, db: SynonymDatabase | null): EventField {
  const cards = new Map<string, number>();
  const sets = new Set<string>();
  for (const item of master.items) {
    const uid = itemUid(item);
    const key = db ? getCanonicalCardFromData(db, uid) : uid;
    cards.set(key, (cards.get(key) ?? 0) + item.found);
    if (item.set) {
      sets.add(item.set.toUpperCase());
    }
  }
  return { deckTotal: master.deckTotal, cards, sets, synonymDatabase: db };
}

/**
 * Load the field for one tournament.
 * @param tournament - The tournament key
 * @returns The indexed field, or null when the report has no decks
 */
export async function fetchEventField(tournament: string): Promise<EventField | null> {
  const [master, db] = await Promise.all([fetchMaster(tournament), getSynonymDatabase()]);
  const field = buildEventField(master, db);
  return field.deckTotal > 0 ? field : null;
}
