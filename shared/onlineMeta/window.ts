/**
 * Report windows on whole UTC days.
 *
 * The daily jobs run at 12:00 UTC. A window anchored to wall-clock "now" ends
 * on a half-finished day: the trailing point of every trend line is whatever
 * single event happened to finish before noon, which reads as a cliff. Windows
 * therefore end at the start of the current UTC day (exclusive) and cover the
 * `days` whole days before it; today's events arrive with tomorrow's run.
 * @module shared/onlineMeta/window
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UtcDayWindow {
  /** Inclusive start, 00:00:00.000Z. */
  start: Date;
  /** Exclusive end, 00:00:00.000Z of the current UTC day. */
  end: Date;
  /** Latest instant inside the window, for inclusive comparisons. */
  lastInstant: Date;
  days: number;
}

/**
 * The `days` whole UTC days ending yesterday.
 * @param now - Reference time
 * @param days - Window length in whole days (at least 1)
 * @returns The window bounds
 */
export function utcDayWindow(now: Date | number, days: number): UtcDayWindow {
  const length = Math.max(1, Math.floor(days));
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const endMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return {
    start: new Date(endMs - length * DAY_MS),
    end: new Date(endMs),
    lastInstant: new Date(endMs - 1),
    days: length
  };
}
