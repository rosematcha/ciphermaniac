/**
 * What a round is called. Its own module because the app shell's banner names
 * the round, and the shell must not carry the rest of the live view logic.
 * @module shared/live/rounds
 */

import type { LiveCut } from './types';

/** Players left in a top cut round, or null for a Swiss one. Each round halves the cut. */
function cutSize(round: number, cut: LiveCut | undefined): number | null {
  return cut && round >= cut.from ? Math.max(2, cut.size / 2 ** (round - cut.from)) : null;
}

/** A round as a sentence names it: `Round 9`, `Top 8`, `Final`. */
export function roundName(round: number, cut?: LiveCut): string {
  const size = cutSize(round, cut);
  if (size === null) {
    return `Round ${round}`;
  }
  return size === 2 ? 'Final' : `Top ${size}`;
}

/** A round where space is short: `R9`, `Top 8`, `Final`. */
export function roundShort(round: number, cut?: LiveCut): string {
  return cutSize(round, cut) === null ? `R${round}` : roundName(round, cut);
}
