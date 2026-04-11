/**
 * Shared performance tier definitions for filtering decks by tournament placement.
 * Used across trends, archetype pages, and other analysis views.
 * @module PerformanceTiers
 */

/**
 * All valid success tags in order of achievement level (highest to lowest)
 */
export const SUCCESS_TAGS = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'] as const;

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
