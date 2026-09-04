/**
 * The tournament side of the Fraudulent comparison.
 *
 * Fraudulent asks two things of the event the user picked: how many of its
 * decks ran each card, and how those decks then did. The first comes from the
 * master report, the second from the Day 2 conversion index, and this joins
 * them into one lookup the online rows can be measured against.
 *
 * The lookup re-keys every event row onto TODAY's canonical print. Rebaked
 * events are already canonicalized to their own event-date print, which
 * is the right thing for displaying that event but leaves the two sides of this
 * comparison speaking different UIDs — Worlds keys Dudunsparce as TEF 129 while
 * the online window keys it as PRE 080, and an unmapped join reports a 20%
 * online card as literally unplayed at the event. Only the join key is
 * rewritten; every rendered field still comes from the online row.
 * @module src/pages/socialGraphics/eventField
 */

import { getCanonicalCardFromData, itemUid, type SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import { fetchConversionIndex, fetchMaster, type MasterPayload } from '../../lib/data';
import type { ConversionPayload } from '../../lib/data/events';
import { getSynonymDatabase } from '../../utils/cardSynonyms';

/** What one tournament did with a card: who played it, and how they finished. */
export interface EventCardStat {
  /** Decks at the tournament that ran the card. */
  found: number;
  /** Of those, how many had a Day 1 row in the conversion index. */
  day1: number;
  /** Of those, how many made Day 2. */
  day2: number;
}

/** One tournament's card counts, keyed so the online rows can join against them. */
export interface EventField {
  /** Decks at the tournament. */
  deckTotal: number;
  /** Canonical card UID to what the tournament did with it. */
  cards: Map<string, EventCardStat>;
  /**
   * Set codes that appeared at the tournament, the legality guard for the
   * comparison. The online window is always current, so any set released after
   * the chosen event would otherwise put its whole roster at the top of the
   * list — heavily played online, in none of the event's decks.
   */
  sets: Set<string>;
  /**
   * The event's own Day 1 to Day 2 rate (0..100), the yardstick a card's
   * conversion is read against. Null for events with no cut published, which
   * drops conversion out of the score rather than out of the graphic.
   */
  fieldConversion: number | null;
}

/** Resolve a raw UID onto today's canonical print. */
function canonical(uid: string, db: SynonymDatabase | null): string {
  return db ? getCanonicalCardFromData(db, uid) : uid;
}

/**
 * Index a tournament's master report and conversion cut by canonical UID.
 * @param master - The tournament's master report
 * @param conversion - Its Day 2 conversion index, when one was published
 * @param db - The synonym database, or null to key by the reports' own UIDs
 * @returns The indexed field
 */
export function buildEventField(
  master: MasterPayload,
  conversion: ConversionPayload | null,
  db: SynonymDatabase | null
): EventField {
  const cards = new Map<string, EventCardStat>();
  const sets = new Set<string>();
  for (const item of master.items) {
    const key = canonical(itemUid(item), db);
    const entry = cards.get(key) ?? { found: 0, day1: 0, day2: 0 };
    entry.found += item.found;
    cards.set(key, entry);
    if (item.set) {
      sets.add(item.set.toUpperCase());
    }
  }
  for (const [uid, counts] of Object.entries(conversion?.cards ?? {})) {
    const key = canonical(uid, db);
    const entry = cards.get(key) ?? { found: 0, day1: 0, day2: 0 };
    entry.day1 += counts.day1;
    entry.day2 += counts.day2;
    cards.set(key, entry);
  }
  return { deckTotal: master.deckTotal, cards, sets, fieldConversion: fieldConversionRate(conversion) };
}

/** The event's overall Day 2 rate, or null when it published no cut. */
function fieldConversionRate(conversion: ConversionPayload | null): number | null {
  if (!conversion || conversion.day1Total <= 0 || conversion.day2Total <= 0) {
    return null;
  }
  return (conversion.day2Total / conversion.day1Total) * 100;
}

/**
 * Load the field for one tournament.
 *
 * Both reports are fetched here rather than threaded down from the page's own
 * resources: the data client dedupes them, and keeping the fetches together
 * means the field is always built from the same payloads it is keyed against.
 * @param tournament - The tournament key
 * @returns The indexed field, or null when the report has no decks
 */
export async function fetchEventField(tournament: string): Promise<EventField | null> {
  const [master, conversion, db] = await Promise.all([
    fetchMaster(tournament),
    fetchConversionIndex(tournament),
    getSynonymDatabase()
  ]);
  const field = buildEventField(master, conversion, db);
  return field.deckTotal > 0 ? field : null;
}
