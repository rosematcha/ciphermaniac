/**
 * Sorting for the players index table. Lives outside the page component so the
 * small-sample handling stays unit-testable.
 */
import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.js';

export type PlayerSortKey = 'events' | 'day2s' | 'winPct';
export type PlayerSortDir = 'asc' | 'desc';

/**
 * Below this many events a win rate is a small sample: dimmed in the table and
 * ranked below qualified players when sorting by it.
 */
export const RATE_MIN_EVENTS = 5;

/**
 * Reused rather than calling `String.prototype.localeCompare` per comparison —
 * the name tiebreak runs on most of the ~16k comparisons a 1,500-row re-sort
 * makes, and re-resolving the collator each time dominates that.
 */
const byName = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Wins over decided games (ties excluded), 0–1; 0 when unplayed. */
export function winPct(p: PlayerIndexSlimEntry): number {
  const games = p.wins + p.losses;
  return games > 0 ? p.wins / games : 0;
}

export function sortValue(p: PlayerIndexSlimEntry, key: PlayerSortKey): number {
  switch (key) {
    case 'day2s':
      return p.day2s;
    case 'winPct':
      return winPct(p);
    case 'events':
    default:
      return p.eventCount;
  }
}

/**
 * Comparator for the players table. For the rate sort, players under
 * {@link RATE_MIN_EVENTS} always rank below qualified ones regardless of
 * direction — a 6-0 weekend must not outrank a 326-123 career.
 *
 * Ties break on event count, then name, and never flip with `dir`. Day 2s over
 * 1,500 players are small integers with long runs of ties, so without a
 * tiebreak the bulk of every page is ordered by whatever the index happened to
 * emit, and paging through it looks random.
 */
export function comparePlayers(
  key: PlayerSortKey,
  dir: PlayerSortDir
): (a: PlayerIndexSlimEntry, b: PlayerIndexSlimEntry) => number {
  const factor = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    if (key === 'winPct') {
      const aQualified = a.eventCount >= RATE_MIN_EVENTS;
      const bQualified = b.eventCount >= RATE_MIN_EVENTS;
      if (aQualified !== bQualified) {
        return aQualified ? -1 : 1;
      }
    }
    const primary = (sortValue(a, key) - sortValue(b, key)) * factor;
    if (primary !== 0) {
      return primary;
    }
    if (key !== 'events' && a.eventCount !== b.eventCount) {
      return b.eventCount - a.eventCount;
    }
    return byName.compare(a.name, b.name);
  };
}
