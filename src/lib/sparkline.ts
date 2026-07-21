/**
 * Vertical bounds for the market-price sparkline.
 *
 * Scaling a series to its own exact min/max is misleading for a near-flat card:
 * a 3% wobble gets stretched to the full height and reads as a violent swing.
 * Floor the visible range at a fraction of the price level so a card that barely
 * moved renders as a gently flat line, while genuine movers (range above the
 * floor) keep their true shape. The exact dollar delta is shown as text beside
 * the spark, so flattening the noise loses no information.
 */

/** Minimum visible range, as a fraction of the series' mid price. */
export const SPARK_MIN_REL_RANGE = 0.15;
/** Headroom above/below the range so the line never touches the edges. */
const SPARK_HEADROOM = 0.15;

/**
 * Low/high y-bounds for a price series. Expands a too-tight range symmetrically
 * around its midpoint to at least {@link SPARK_MIN_REL_RANGE} of that midpoint,
 * then adds headroom. Returns a degenerate-safe band for empty/flat input.
 * @param prices - The series' prices, in order
 * @param minRelRange - Override the relative-range floor (mainly for tests)
 */
export function computeSparkBounds(
  prices: number[],
  minRelRange: number = SPARK_MIN_REL_RANGE
): { lo: number; hi: number } {
  if (prices.length === 0) {
    return { lo: 0, hi: 1 };
  }
  let lo = prices[0];
  let hi = prices[0];
  for (const p of prices) {
    if (p < lo) {
      lo = p;
    }
    if (p > hi) {
      hi = p;
    }
  }
  const mid = (lo + hi) / 2;
  // Floor the range relative to the price level; `mid` is 0 only if the whole
  // series is 0, in which case the absolute floor below still gives a band.
  const floor = Math.max(Math.abs(mid) * minRelRange, 0.02);
  if (hi - lo < floor) {
    lo = mid - floor / 2;
    hi = mid + floor / 2;
  }
  const pad = (hi - lo) * SPARK_HEADROOM;
  return { lo: lo - pad, hi: hi + pad };
}
