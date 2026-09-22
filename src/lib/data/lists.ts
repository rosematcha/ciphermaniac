/**
 * The compact list index (`lists.json`) and its decoding.
 *
 * The producer stores every repeated string once (see
 * shared/data/reports/listIndex); this module turns the positional rows back
 * into records a page can render, resolving each card once through the synonym
 * database so a card page finds its lists whichever printing the player
 * registered.
 * @module src/lib/data/lists
 */

import { dataClient } from './client';
import { tournamentPath } from './paths';
import { cardUid, getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import type { ListIndexPayload } from '../../../shared/data/reports/listIndex';

const { fetchJsonOptional } = dataClient;

export function fetchListIndex(tournament: string): Promise<ListIndexPayload | null> {
  return fetchJsonOptional<ListIndexPayload>(`${tournamentPath(tournament)}/lists.json`);
}

export interface ListCard {
  name: string;
  set: string;
  number: string;
  category: string;
  count: number;
  /** Global-canonical UID, '' for a bare-name card. */
  uid: string;
}

/** One published list, decoded from the index. */
export interface ListRecord {
  /** Position in the index; stable for the payload's lifetime. */
  id: number;
  player: string;
  country: string;
  /** 0 when unknown. */
  placement: number;
  /** Archetype label as the producer stored it (join via normalizeArchetypeName). */
  archetype: string;
  event: { id: string; name: string; date: string; players: number } | null;
  tags: ReadonlySet<string>;
  cards: ListCard[];
  /** Global-canonical UID of every card in the list. */
  uids: ReadonlySet<string>;
}

/** Card dictionary entry -> global canonical UID ('' for bare-name cards). */
function canonicalUids(payload: ListIndexPayload, db: SynonymDatabase | null): string[] {
  return payload.cards.map(([name, set, number]) => {
    const uid = set && number ? cardUid(name, set, number) : null;
    return uid ? getCanonicalCardFromData(db, uid) : '';
  });
}

/**
 * Decode every row of the index. Done once per payload rather than per query;
 * 8k rows decode in a few milliseconds and the result is what the card page
 * filters.
 */
export function decodeListIndex(payload: ListIndexPayload, db: SynonymDatabase | null): ListRecord[] {
  const uids = canonicalUids(payload, db);
  const events = payload.events.map(([id, name, date, players]) => ({ id, name, date, players }));
  return payload.decks.map((row, id) => {
    const [player, country, placement, archetype, event, tagBits, pairs] = row;
    const cards: ListCard[] = [];
    const listUids = new Set<string>();
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const entry = payload.cards[pairs[i]];
      if (!entry) {
        continue;
      }
      const [name, set, number, category] = entry;
      const uid = uids[pairs[i]] ?? '';
      cards.push({ name, set, number, category, count: pairs[i + 1], uid });
      if (uid) {
        listUids.add(uid);
      }
    }
    const tags = new Set<string>();
    payload.tags.forEach((tag, bit) => {
      if (tagBits & (1 << bit)) {
        tags.add(tag);
      }
    });
    return {
      id,
      player,
      country,
      placement,
      archetype: payload.archetypes[archetype] ?? '',
      event: events[event] ?? null,
      tags,
      cards,
      uids: listUids
    };
  });
}
