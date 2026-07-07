// Relative-time formatting for the "Updated … ago" freshness chip. Coarse by
// design: minutes, hours, days — never seconds, so the chip doesn't churn once
// per second and reads calmly. Pure and JSON-safe; `now` is injectable for tests.

/**
 * Format the gap between `iso` and `now` as a coarse relative label
 * ("3 minutes", "5 hours", "2 days"). Returns null when `iso` isn't a parseable
 * timestamp so callers can hide the chip entirely rather than show "NaN".
 */
export function relativeTimeAgo(iso: string, now: number = Date.now()): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return null;
  }
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return 'less than a minute';
  }
  if (minutes < 60) {
    return plural(minutes, 'minute');
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return plural(hours, 'hour');
  }
  const days = Math.floor(hours / 24);
  return plural(days, 'day');
}

/** Canonical ISO datetime for the tooltip; falls back to the raw string. */
export function absoluteIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
