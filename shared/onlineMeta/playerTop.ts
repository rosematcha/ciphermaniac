/**
 * The players page's first page, published beside the slim index so /players can paint 50 rows
 * before the full index (about 300 KB) arrives. The page re-sorts what it shows with its own
 * comparator; this one only has to pick the same 50 players.
 * @module shared/onlineMeta/playerTop
 */

import type { PlayerIndexEntry } from '../playerTypes';

export const TOP_PLAYERS_KEY = 'players/top.json';
export const TOP_PLAYERS_COUNT = 50;

const byName = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * The page's default ranking (src/utils/playerSort.ts): Day 2s, then events, then name. Everyone
 * tied with the 50th on Day 2s and events comes too: names sort by the visitor's locale, not this
 * one, so the page must be able to pick its own 50th from among them.
 */
export function topPlayers(index: readonly PlayerIndexEntry[]): PlayerIndexEntry[] {
  const ranked = [...index].sort(
    (a, b) => b.day2s - a.day2s || b.eventCount - a.eventCount || byName.compare(a.name, b.name)
  );
  const last = ranked[TOP_PLAYERS_COUNT - 1];
  if (!last) {
    return ranked;
  }
  const tied = (entry: PlayerIndexEntry) => entry.day2s === last.day2s && entry.eventCount === last.eventCount;
  let end = TOP_PLAYERS_COUNT;
  while (end < ranked.length && tied(ranked[end])) {
    end += 1;
  }
  return ranked.slice(0, end);
}
