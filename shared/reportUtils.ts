/**
 * shared/reportUtils.ts
 * Common report generation utilities shared between backend and client-side code.
 *
 * This module provides isomorphic utility functions for report generation that work
 * in both Node.js/Cloudflare Workers and browser environments.
 */

/**
 * Distribution entry representing how many players use a specific copy count
 */
export interface DistributionEntry {
  copies: number;
  players: number;
  percent: number;
}

/**
 * Calculate percentage with consistent rounding to 2 decimal places.
 * Uses epsilon-based rounding to avoid floating point precision issues.
 * @param numerator - The value to calculate percentage for
 * @param denominator - The total/base value
 * @returns Percentage rounded to 2 decimal places, or 0 if denominator is 0
 */
export function calculatePercentage(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) {
    return 0;
  }
  return Math.round(((numerator / denominator) * 100 + Number.EPSILON) * 100) / 100;
}

/**
 * Create a distribution array from a histogram of copy counts.
 * Takes a Map of (copies -> player count) and returns sorted distribution entries.
 * @param histogram - Map of copy count to number of players with that count
 * @param totalFound - Total number of decks/players that have the card
 * @returns Array of distribution entries sorted by copies ascending
 */
export function createDistFromHistogram(histogram: Map<number, number>, totalFound: number): DistributionEntry[] {
  return Array.from(histogram.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([copies, players]) => ({
      copies,
      players,
      percent: calculatePercentage(players, totalFound)
    }));
}

/**
 * Create a distribution array from an array of copy counts.
 * Used when you have raw count values rather than a pre-built histogram.
 * @param counts - Array of copy counts (one per deck that has the card)
 * @param totalFound - Total number of decks that have the card (usually counts.length)
 * @returns Array of distribution entries sorted by copies ascending
 */
export function createDistributionFromCounts(counts: number[], totalFound: number): DistributionEntry[] {
  const histogram = new Map<number, number>();

  for (const count of counts) {
    const key = Number(count) || 0;
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }

  return createDistFromHistogram(histogram, totalFound);
}

/**
 * Compose a category path from card type information.
 * Creates hierarchical category slugs like "trainer/supporter" or "energy/basic".
 * @param category - Base category (pokemon, trainer, energy)
 * @param trainerType - Trainer subtype (supporter, item, stadium, tool)
 * @param energyType - Energy subtype (basic, special)
 * @param options - Additional options
 * @param options.aceSpec - Whether the card is an Ace Spec
 * @returns Composed category path or empty string
 */
export function composeCategoryPath(
  category: string | null | undefined,
  trainerType: string | null | undefined,
  energyType: string | null | undefined,
  options: { aceSpec?: boolean } = {}
): string {
  const base = (category || '').toLowerCase();
  if (!base) {
    return '';
  }

  const parts = [base];

  if (base === 'trainer') {
    if (trainerType) {
      parts.push(trainerType.toLowerCase());
    }
    if (options.aceSpec) {
      // Ace Spec cards are tools, ensure tool is in path
      if (!parts.includes('tool') && (!trainerType || trainerType.toLowerCase() !== 'tool')) {
        parts.push('tool');
      }
      parts.push('acespec');
    }
  } else if (base === 'energy' && energyType) {
    parts.push(energyType.toLowerCase());
  }

  return parts.join('/');
}

/**
 * Sort report items by percentage (descending), then found count, then name.
 * This is the standard sorting for card usage reports.
 * @param items - Array of items with pct, found, and name properties
 * @returns New sorted array (does not mutate input)
 */
export function sortReportItems<T extends { pct: number; found: number; name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (right.pct !== left.pct) {
      return right.pct - left.pct;
    }
    if (right.found !== left.found) {
      return right.found - left.found;
    }
    return (left.name || '').localeCompare(right.name || '');
  });
}

/**
 * Assign ranks to sorted items (1-based).
 * @param items - Array of items to rank
 * @returns New array with rank property added
 */
export function assignRanks<T>(items: T[]): (T & { rank: number })[] {
  return items.map((item, index) => ({
    ...item,
    rank: index + 1
  }));
}
