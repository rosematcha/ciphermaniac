/**
 * Sorting for the players index table. Lives outside the page component so the
 * small-sample handling stays unit-testable.
 */
import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.js';

export type PlayerSortKey = 'events' | 'day2s' | 'topCuts' | 'titles' | 'day2Rate';
export type PlayerSortDir = 'asc' | 'desc';

/**
 * Below this many events a Day 2 rate is a small sample: dimmed in the table
 * and ranked below qualified players when sorting by rate.
 */
export const DAY2_RATE_MIN_EVENTS = 5;

export function day2Rate(p: PlayerIndexSlimEntry): number {
  return p.eventCount > 0 ? p.day2s / p.eventCount : 0;
}

export function sortValue(p: PlayerIndexSlimEntry, key: PlayerSortKey): number {
  switch (key) {
    case 'day2s':
      return p.day2s;
    case 'topCuts':
      return p.topCuts;
    case 'titles':
      return p.tournamentWins;
    case 'day2Rate':
      return day2Rate(p);
    case 'events':
    default:
      return p.eventCount;
  }
}

/**
 * Comparator for the players table. For the rate sort, players under
 * {@link DAY2_RATE_MIN_EVENTS} always rank below qualified ones regardless of
 * direction — a 2-for-2 weekend must not outrank a 35-of-42 season.
 */
export function comparePlayers(
  key: PlayerSortKey,
  dir: PlayerSortDir
): (a: PlayerIndexSlimEntry, b: PlayerIndexSlimEntry) => number {
  const factor = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    if (key === 'day2Rate') {
      const aQualified = a.eventCount >= DAY2_RATE_MIN_EVENTS;
      const bQualified = b.eventCount >= DAY2_RATE_MIN_EVENTS;
      if (aQualified !== bQualified) {
        return aQualified ? -1 : 1;
      }
    }
    return (sortValue(a, key) - sortValue(b, key)) * factor;
  };
}
