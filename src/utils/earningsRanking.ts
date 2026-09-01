/**
 * Ranking for the earnings table.
 *
 * The page shows one table under three lenses, so the ordering rules live here
 * rather than inside the component: each lens picks a different amount out of
 * the same player record, and every lens shares the tie handling.
 */
import type { EarningsPlayer } from '../../shared/earningsTypes.js';

export type EarningsLens = 'career' | 'best' | 'season';

export interface EarningsRow {
  /**
   * Competition rank: equal amounts share a rank and the next distinct amount
   * skips, the way Limitless itself ranks its leaderboards.
   */
  rank: number;
  player: EarningsPlayer;
  amount: number;
  /** Season the amount came from, or null under the career lens. */
  seasonKey: string | null;
}

/** The season a player made the most in. Null for a player with no seasons. */
export function bestSeason(player: EarningsPlayer): { key: string; amount: number } | null {
  let best: { key: string; amount: number } | null = null;
  for (const [key, amount] of Object.entries(player.seasons)) {
    if (!best || amount > best.amount) {
      best = { key, amount };
    }
  }
  return best;
}

/** The (amount, season) a lens reads off a player, or null if it doesn't apply. */
function lensAmount(
  player: EarningsPlayer,
  lens: EarningsLens,
  seasonKey: string
): { amount: number; seasonKey: string | null } | null {
  if (lens === 'career') {
    return { amount: player.total, seasonKey: null };
  }
  if (lens === 'best') {
    const best = bestSeason(player);
    return best ? { amount: best.amount, seasonKey: best.key } : null;
  }
  const amount = player.seasons[seasonKey];
  return amount == null ? null : { amount, seasonKey };
}

/**
 * Rank every player who has a value under this lens. Players the lens doesn't
 * apply to — someone who didn't cash in the selected season — drop out rather
 * than ranking at zero.
 *
 * Ties break by name so the order is stable across renders and lens switches.
 */
export function rankByLens(players: EarningsPlayer[], lens: EarningsLens, seasonKey: string): EarningsRow[] {
  const scored = players.flatMap(player => {
    const hit = lensAmount(player, lens, seasonKey);
    return hit ? [{ player, ...hit }] : [];
  });
  scored.sort((a, b) => b.amount - a.amount || a.player.name.localeCompare(b.player.name));

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
