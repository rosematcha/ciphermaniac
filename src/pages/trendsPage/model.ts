/**
 * The trends page's small pure helpers: the payload shape the daily fallback
 * reads, the window options, and the mover slice. The chart projections live
 * in ./weekly.ts.
 * @module src/pages/trendsPage/model
 */

/** The subset of the online trends payload this module reads. */
export interface OnlineTrendReportLike {
  windowEnd?: string;
  series?: Array<{
    base: string;
    displayName: string;
    avgShare: number;
    timeline?: Array<{ date: string; share: number }>;
  }>;
}

/**
 * Take the top movers from each direction.
 * @param cardTrends - The payload's pre-computed lists
 * @param limit - How many to keep per direction
 * @returns Sliced rising and falling lists
 */
export function sliceCardMovers<T>(
  cardTrends: { rising?: T[]; falling?: T[] } | null | undefined,
  limit = 12
): { rising: T[]; falling: T[] } {
  return {
    rising: (cardTrends?.rising ?? []).slice(0, limit),
    falling: (cardTrends?.falling ?? []).slice(0, limit)
  };
}

/** Selectable day windows for the online (daily) view. */
export type OnlineWindow = '7d' | '14d' | '30d';

export const ONLINE_WINDOW_DAYS: Record<OnlineWindow, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30
};

/**
 * Opening window for the online view: two weeks on desktop, one week on phones,
 * where 14 daily points crowd together into an unreadable line.
 * @returns The default window key for this viewport
 */
export function defaultOnlineWindow(): OnlineWindow {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  return narrow ? '7d' : '14d';
}
