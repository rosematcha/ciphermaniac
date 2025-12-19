/**
 * Shared performance tier definitions for filtering decks by tournament placement.
 * Used across trends, archetype pages, and other analysis views.
 * @module PerformanceTiers
 */

/**
 * All valid success tags in order of achievement level (highest to lowest)
 */
export const SUCCESS_TAGS = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'] as const;

export type SuccessTag = (typeof SUCCESS_TAGS)[number];

/**
 * Human-readable labels for each performance tier
 */
export const PERFORMANCE_TIER_LABELS: Record<string, string> = {
  all: 'All Finishes',
  winner: 'Winners',
  top2: 'Finals',
  top4: 'Top 4',
  top8: 'Top 8',
  top16: 'Top 16',
  top10: 'Top 10%',
  top25: 'Top 25%',
  top50: 'Top 50%'
};

/**
 * Short labels for compact UI elements (dropdowns, badges, etc.)
 */
export const PERFORMANCE_TIER_SHORT_LABELS: Record<string, string> = {
  all: 'All',
  winner: 'Winners',
  top2: 'Finals',
  top4: 'Top 4',
  top8: 'Top 8',
  top16: 'Top 16',
  top10: 'Top 10%',
  top25: 'Top 25%',
  top50: 'Top 50%'
};

/**
 * Performance tiers available for filtering, in display order.
 * 'all' represents no filter (all decks).
 */
export const PERFORMANCE_FILTER_OPTIONS = ['all', 'top16', 'top8', 'top4', 'top2', 'winner'] as const;

export type PerformanceFilter = (typeof PERFORMANCE_FILTER_OPTIONS)[number];

/**
 * Check if a deck matches a performance filter based on its success tags.
 * @param successTags - Array of success tags from the deck
 * @param filter - The performance filter to check against
 * @returns true if the deck matches the filter
 */
export function matchesPerformanceFilter(successTags: string[] | undefined, filter: string): boolean {
  if (filter === 'all') {
    return true;
  }
  if (!Array.isArray(successTags) || successTags.length === 0) {
    return false;
  }
  return successTags.includes(filter);
}

/**
 * Get the label for a performance filter
 */
export function getPerformanceLabel(filter: string, short = false): string {
  const labels = short ? PERFORMANCE_TIER_SHORT_LABELS : PERFORMANCE_TIER_LABELS;
  return labels[filter] || filter;
}
