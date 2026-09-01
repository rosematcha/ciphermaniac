/**
 * Ranking for the earnings table.
 *
 * The page shows one table under three lenses, so the ordering rules live here
 * rather than inside the component: each lens pulls a different set of amounts
 * out of the same player records, and every lens shares the tie handling.
 */
import type { EarningsPlayer } from '../../shared/earningsTypes.js';

export type EarningsLens = 'career' | 'top-seasons' | 'current';

export interface EarningsRow {
  /**
   * Competition rank: equal amounts share a rank and the next distinct amount
   * skips, the way Limitless ranks its own leaderboards.
   */
  rank: number;
  player: EarningsPlayer;
  amount: number;
  /** Season the amount came from, or null under the career lens. */
  seasonKey: string | null;
}

type Scored = Omit<EarningsRow, 'rank'>;

/**
 * Every season a player cashed in, as its own row.
 *
 * Deliberately not one row per player: a player with two huge years should
 * occupy two places on a table of the biggest seasons ever, not have the
 * smaller one hidden behind the bigger one.
 */
function seasonRows(player: EarningsPlayer): Scored[] {
  return Object.entries(player.seasons).map(([seasonKey, amount]) => ({ player, amount, seasonKey }));
}

/** The amounts a lens reads off one player — none, one, or one per season. */
function lensRows(player: EarningsPlayer, lens: EarningsLens, currentSeason: string): Scored[] {
  if (lens === 'career') {
    return [{ player, amount: player.total, seasonKey: null }];
  }
  if (lens === 'top-seasons') {
    return seasonRows(player);
  }
  const amount = player.seasons[currentSeason];
  return amount == null ? [] : [{ player, amount, seasonKey: currentSeason }];
}

/**
 * Rank every row a lens produces. Players the lens doesn't apply to — someone
 * who didn't cash in the selected season — drop out rather than ranking at zero.
 *
 * Ties break by name, then season, so the order is stable across renders.
 */
export function rankByLens(players: EarningsPlayer[], lens: EarningsLens, currentSeason: string): EarningsRow[] {
  const scored = players.flatMap(player => lensRows(player, lens, currentSeason));
  scored.sort(
    (a, b) =>
      b.amount - a.amount ||
      a.player.name.localeCompare(b.player.name) ||
      (a.seasonKey ?? '').localeCompare(b.seasonKey ?? '')
  );

  let rank = 0;
  let previousAmount: number | null = null;
  return scored.map((row, index) => {
    if (row.amount !== previousAmount) {
      rank = index + 1;
      previousAmount = row.amount;
    }
    return { rank, ...row };
  });
}

/** Whole dollars, no cents — every Limitless payout is a round number. */
export function formatEarnings(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

/** `2025-2026` reads as `2025-26` in a column that repeats it on every row. */
export function shortSeasonLabel(label: string): string {
  const span = /(\d{4})\D+(\d{4})/.exec(label);
  return span ? `${span[1]}–${span[2].slice(2)}` : label;
}
