/**
 * When a live event is worth looking at again: one rule for the poller reading
 * RK9 and for a browser reading the published index.
 *
 * Pacing comes from what has been observed rather than from venue time zones,
 * which the schedule does not carry. While results are changing, look at once.
 * Once nothing has changed for a while, look every ten minutes. A finished
 * event is never looked at again.
 *
 * The overnight break is the one lull worth sleeping through, and the event
 * says when its day starts: round two is posted about an hour into day one,
 * whatever the time zone. A finished round that has sat untouched since the
 * venue's evening is the end of a day, so the next look is a few hours before
 * the next day's start rather than every ten minutes all night. A lull in the
 * afternoon, like the wait between the last Swiss round and top cut, is never
 * mistaken for one: it began too early in the venue's day.
 * @module shared/live/pace
 */

/** Look at once for this long after the last observed change. */
export const ACTIVE_WINDOW_MS = 90 * 60 * 1000;
/** Gap between looks once the active window has lapsed. */
export const IDLE_INTERVAL_MS = 10 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/**
 * A lull beginning this far past round two's time of day began in the evening.
 * Round two goes up about an hour in, so eight hours past it is a day already
 * nine hours old; twenty past it is the small hours of the next morning.
 */
const EVENING_FROM = 8 * HOUR;
const EVENING_UNTIL = 20 * HOUR;
/** Wake this long before round two's time of day, since a new day's first round is posted before it starts. */
const WAKE_BEFORE = 3 * HOUR;

export interface LivePace {
  /** When the published round last changed. */
  changedAt: string;
  /** Every table in the current round has a result. */
  roundComplete: boolean;
  /** When round two was first published, which pins the venue's day. */
  round2At?: string;
  /** The final has a result; nothing more is coming. */
  finished?: boolean;
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** The first instant after `after` at the time of day `at` falls on. */
function nextTimeOfDay(at: number, after: number): number {
  return after + DAY - mod(after - at, DAY);
}

function isEvening(round2At: number, since: number): boolean {
  const into = mod(since - round2At, DAY);
  return into >= EVENING_FROM && into < EVENING_UNTIL;
}

/**
 * When to look next, given the last look; the last look itself means "at once",
 * on the caller's own cadence.
 * @param pace - What the last look saw
 * @param checkedAt - When that look was, in epoch milliseconds
 * @returns Epoch milliseconds of the next look, or null for never
 */
export function nextCheck(pace: LivePace, checkedAt: number): number | null {
  if (pace.finished) {
    return null;
  }
  const changed = Date.parse(pace.changedAt);
  if (checkedAt - changed < ACTIVE_WINDOW_MS) {
    return checkedAt;
  }
  const idle = checkedAt + IDLE_INTERVAL_MS;
  const anchor = pace.round2At ? Date.parse(pace.round2At) : NaN;
  if (!pace.roundComplete || Number.isNaN(anchor) || !isEvening(anchor, changed)) {
    return idle;
  }
  return Math.max(idle, nextTimeOfDay(anchor - WAKE_BEFORE, changed));
}
