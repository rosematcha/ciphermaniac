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
}

/**
 * A crawled finish with its age division resolved.
 *
 * Limitless's results table never states the division, so it can't be crawled
 * — the build infers it by crawling twice, once filtered to Masters: a row
 * present unfiltered but absent from the Masters pass was a Junior or Senior
 * finish.
 */
export interface DividedResult extends CrawledResult {
  division: EarningsDivision;
}

export interface CrawledPlayer {
  id: string;
  name: string;
  country: string;
  results: CrawledResult[];
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
