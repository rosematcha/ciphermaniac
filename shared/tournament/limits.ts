/**
 * How many events an organizer starts. A Community organizer holds at most
 * one event on any date, and starts at most three in a day, deleted ones
 * counting; a store starts up to twenty in a day, a ceiling only abuse
 * reaches. An Admin's own events have no limits.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Events created in any 24 hours, by who creates them. */
export const CREATIONS_PER_DAY = { community: 3, store: 20 } as const;

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day an event is on: the date its start time names, or, with
 * none set, `today`, the organizer's own date as their browser gives it.
 */
export function eventDay(startsAt: string, today: string): string {
  const day = startsAt.slice(0, 10);
  return ISO_DAY_RE.test(day) ? day : today;
}

/**
 * The organizer's date, as their browser sent it (YYYY-MM-DD): taken when it
 * is within a day of the server's, as every time zone's date is; the server's
 * UTC date otherwise.
 */
export function organizerToday(value: unknown, now: number): string {
  const utc = new Date(now).toISOString().slice(0, 10);
  if (typeof value !== 'string' || !ISO_DAY_RE.test(value)) {
    return utc;
  }
  const gap = Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`));
  return gap <= DAY_MS ? value : utc;
}
