/**
 * Prize earnings, actual and restated at today's payouts.
 *
 * `scripts/build-earnings.ts` writes this shape to `static/earnings.json` from
 * the results crawl, and the /tools/earnings page reads it. The type lives here
 * so producer and consumer can't drift.
 * @module shared/earningsTypes
 */

/** Which prize table an event is paid from. */
export type EarningsTier = 'regional' | 'international' | 'worlds';

/**
 * Which column of that table applies. Pokemon publishes Masters separately
 * from a column Juniors and Seniors share.
 */
export type EarningsDivision = 'masters' | 'junior-senior';

export interface EarningsSeason {
  /** Season key, e.g. `2526` for 2025-26. */
  key: string;
  /** Rendered span, e.g. `2025-2026`. */
  label: string;
}

export interface EarningsTotals {
  /** Career sum of every season below. */
  total: number;
  /** Season key to prize money in whole dollars. Only non-zero seasons. */
  seasons: Record<string, number>;
}

export interface EarningsPlayer {
  /**
   * Limitless player id. NOT a ciphermaniac player id — the two namespaces
   * collide numerically but describe different people, so joining these rows
   * to `players/index.json` needs name matching, not an id lookup.
   */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 as Limitless renders it; empty when it shows no flag. */
  country: string;
  /** Prize money as actually paid at the time. */
  actual: EarningsTotals;
  /**
   * The same finishes paid at the current published rates. A player can have
   * adjusted money without ever having cashed: today's Regional table pays down
   * to 32nd, where older events often paid only a top cut.
   */
  adjusted: EarningsTotals;
}

/** One tournament finish, as read off a player's Limitless results page. */
export interface CrawledResult {
  /** Limitless tournament id. */
  tournamentId: string;
  name: string;
  /** Season key from the table's own sub-heading, e.g. `2526`. */
  season: string;
  /** Finishing position, or null when the page shows no placement. */
  place: number | null;
  /** Prize money actually paid, in whole dollars. */
  cash: number;
  /** Age division, read off the tournament link's `/JR` or `/SR` suffix. */
  division: EarningsDivision;
}

export interface CrawledPlayer {
  id: string;
  name: string;
  country: string;
  results: CrawledResult[];
}

/**
 * One tournament finish, as shown in an expanded row.
 *
 * Carries both money figures so the panel can follow whichever pay scale the
 * table is showing without a second lookup.
 */
export interface EarningsEvent {
  name: string;
  season: string;
  /** Finishing position, or null when the page showed none. */
  place: number | null;
  /** Prize money as paid at the time. */
  cash: number;
  /** The same finish at today's published rates. */
  adjusted: number;
}

/**
 * Per-event detail, keyed by player id.
 *
 * A separate file from the leaderboard: the table itself needs only season
 * aggregates, and this is three times the size, so it is fetched once on the
 * first row a visitor expands and never at all otherwise.
 */
export interface EarningsEventsPayload {
  generatedAt: string;
  /** Player id to their finishes, oldest first. */
  events: Record<string, EarningsEvent[]>;
}

export interface EarningsPayload {
  generatedAt: string;
  source: string;
  /** Where the current payout tables came from, for the page's footnote. */
  payoutSource: string;
  /** Newest season first. */
  seasons: EarningsSeason[];
  /** Career actual total, descending. */
  players: EarningsPlayer[];
}
