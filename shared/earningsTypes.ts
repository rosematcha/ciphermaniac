/**
 * Prize earnings scraped from the Limitless earnings leaderboard.
 *
 * `scripts/scrape-player-earnings.ts` writes this shape to `static/earnings.json`
 * and the /tools/earnings page reads it. The type lives here so producer and
 * consumer can't drift.
 * @module shared/earningsTypes
 */

export interface EarningsSeason {
  /** Limitless season filter value, e.g. `2526` for 2025-26. */
  key: string;
  /** Limitless's own rendering of the span, e.g. `2025-2026`. */
  label: string;
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
  /** Season key to prize money in whole dollars. Only seasons the player cashed in. */
  seasons: Record<string, number>;
  /** Sum of every value in {@link seasons}. */
  total: number;
}

export interface EarningsPayload {
  generatedAt: string;
  source: string;
  /** How deep into each season's leaderboard the scrape went. */
  topPerSeason: number;
  /** Newest season first. */
  seasons: EarningsSeason[];
  /** Career total, descending. */
  players: EarningsPlayer[];
}
