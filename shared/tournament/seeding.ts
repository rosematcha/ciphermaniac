/**
 * Bracket seeding, apart from the Swiss engine (pairing.ts) so a page that
 * only draws a bracket doesn't carry the engine.
 */

/**
 * Seed order for a single-elimination bracket of `size` (a power of two), so
 * that seed 1 meets seed `size` and the top two seeds can only meet in the
 * final: 8 gives 1, 8, 5, 4, 3, 6, 7, 2.
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed, i) => (i % 2 === 0 ? [seed, next - seed] : [next - seed, seed]));
  }
  return order;
}
