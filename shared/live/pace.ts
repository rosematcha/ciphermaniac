/**
 * When a live event is worth looking at again: one rule for the poller reading
 * RK9 and for a browser reading the published index.
 *
 * Pacing comes from what has been observed rather than from venue time zones,
 * which the schedule does not carry. While results are changing, read the
 * round every minute, or every thirty seconds once only a few tables are left.
 * Once nothing has changed for a while, read every ten minutes. A finished
 * event is never looked at again.
 *
 * The poller also probes for the next round between reads, since a new round's
 * pairings are what players race RK9 for: every ten seconds in the minutes
 * after a round finishes, and through the morning a day is expected to start.
 * A probe for a round RK9 has not posted comes back empty, so it costs RK9
 * next to nothing.
 *
 * The overnight break is the one lull worth sleeping through, and the event
 * says when its day starts: round two is posted about an hour into day one,
 * whatever the time zone. The next look after a day ends is a few hours before
 * the next day's start rather than every ten minutes all night. A finished
 * round that has sat untouched since the venue's evening ends a day. So does
 * an unfinished one at day one's close, since RK9 sometimes leaves a day's
 * last results unfilled until morning: day one is eight Swiss rounds, and
 * round nine, the first of day two, is played that evening at some events and
 * the next morning at others. A lull in the afternoon, like the wait between
 * the last Swiss round and top cut, is never mistaken for one: it began too
 * early in the venue's day.
 * @module shared/live/pace
 */

/** Read at the active pace for this long after the last observed change. */
export const ACTIVE_WINDOW_MS = 90 * 60 * 1000;
/** Gap between reads while results are changing. */
export const ACTIVE_INTERVAL_MS = 60 * 1000;
/** Gap between reads while only a few tables are still playing. */
export const CLOSING_INTERVAL_MS = 30 * 1000;
/** Gap between reads once the active window has lapsed. */
export const IDLE_INTERVAL_MS = 10 * 60 * 1000;
/** Gap between probes for the next round when it is expected any minute. */
export const PROBE_INTERVAL_MS = 10 * 1000;
/** Probe this long after a round finishes. */
export const PROBE_WINDOW_MS = 10 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Tables still playing at or under which a round is closing. */
const CLOSING_TABLES = 5;
/**
 * A lull beginning this far past round two's time of day began in the evening.
 * Round two goes up about an hour in, so eight hours past it is a day already
 * nine hours old; twenty past it is the small hours of the next morning.
 */
const EVENING_FROM = 8 * HOUR;
const EVENING_UNTIL = 20 * HOUR;
/** Wake this long before round two's time of day, since a new day's first round is posted before it starts. */
const WAKE_BEFORE = 3 * HOUR;
/** Probe for the day's first round this long after waking. */
const MORNING_WINDOW = 4 * HOUR;
/** Day one's last Swiss round, and the first of day two, which some events play the same evening. */
const DAY_CLOSING_ROUNDS = new Set([8, 9]);

export interface LivePace {
  /** When the published round last changed. */
  changedAt: string;
  /** Every table in the current round has a result. */
  roundComplete: boolean;
  /** When round two was first published, which pins the venue's day. */
  round2At?: string;
  /** The final has a result; nothing more is coming. */
  finished?: boolean;
  /** The current round's number. */
  round?: number;
  /** The current round is part of the top cut. */
  topCut?: boolean;
  /** Tables in the current round without a result. */
  playing?: number;
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

function isDayClosingRound(pace: LivePace): boolean {
  return !pace.topCut && pace.round !== undefined && DAY_CLOSING_ROUNDS.has(pace.round);
}

function isClosing(pace: LivePace): boolean {
  return !pace.roundComplete && pace.playing !== undefined && pace.playing <= CLOSING_TABLES;
}

/**
 * When the next day's watch begins, if a lull in this round would end the day;
 * null if it would not, or if the day has no anchor yet.
 */
function dayWake(pace: LivePace): number | null {
  const anchor = pace.round2At ? Date.parse(pace.round2At) : NaN;
  if (Number.isNaN(anchor)) {
    return null;
  }
  const changed = Date.parse(pace.changedAt);
  const endsDay = isEvening(anchor, changed) && (pace.roundComplete || isDayClosingRound(pace));
  return endsDay ? nextTimeOfDay(anchor - WAKE_BEFORE, changed) : null;
}

/**
 * When to read the round next, given the last read.
 * @param pace - What the last read saw
 * @param checkedAt - When that read was, in epoch milliseconds
 * @returns Epoch milliseconds of the next read, or null for never
 */
export function nextCheck(pace: LivePace, checkedAt: number): number | null {
  if (pace.finished) {
    return null;
  }
  const changed = Date.parse(pace.changedAt);
  if (checkedAt - changed < ACTIVE_WINDOW_MS) {
    return checkedAt + (isClosing(pace) ? CLOSING_INTERVAL_MS : ACTIVE_INTERVAL_MS);
  }
  const idle = checkedAt + IDLE_INTERVAL_MS;
  const wake = dayWake(pace);
  return wake === null ? idle : Math.max(idle, wake);
}

/**
 * Whether the next round is expected any moment: just after a round finished,
 * or in the morning after a day ended.
 * @param pace - What the last look saw
 * @param now - Epoch milliseconds
 */
export function awaitsNextRound(pace: LivePace, now: number): boolean {
  if (pace.finished) {
    return false;
  }
  if (pace.roundComplete && now - Date.parse(pace.changedAt) < PROBE_WINDOW_MS) {
    return true;
  }
  const wake = dayWake(pace);
  return wake !== null && now >= wake && now < wake + MORNING_WINDOW;
}
