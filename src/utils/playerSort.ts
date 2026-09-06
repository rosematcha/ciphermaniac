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
    return (sortValue(a, key) - sortValue(b, key)) * factor;
  };
}
