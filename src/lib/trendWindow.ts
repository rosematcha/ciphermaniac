/**
 * Date/window helpers for the Trends page's online (daily) view.
 *
 * Extracted from TrendsPage so the boundary math is unit-testable: the online
 * trend report's `windowEnd` can be a bare `YYYY-MM-DD` OR a full ISO timestamp
 * (the producer emits `toISOString()`), and the window must be inclusive of the
 * anchor day without silently drifting to wall-clock `Date.now()`.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a report date to epoch ms. A bare `YYYY-MM-DD` is anchored to noon UTC
 * (so it lands on the intended calendar day regardless of the viewer's zone); a
 * full ISO timestamp is parsed as-is. Returns NaN when unparseable — callers
 * must not silently fall back to `Date.now()`, which drifts past the data when
 * the cron lags.
 */
export function parseReportDate(value: string | undefined): number {
  if (!value) {
    return NaN;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T12:00:00Z`);
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Inclusive window cutoff: the earliest ms still inside a `windowDays` window
 * that ends on (and includes) `anchorMs`. Subtracting the full `windowDays`
 * would admit N+1 calendar days.
 */
export function windowCutoff(anchorMs: number, windowDays: number): number {
  return anchorMs - (windowDays - 1) * DAY_MS;
}
