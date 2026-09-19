/**
 * Events the live poller watches. Hand-listed while the feature is being
 * proven; the RK9 event list carries the same fields and will replace this.
 * @module shared/live/schedule
 */

import type { LiveEvent } from './types';

export const LIVE_EVENTS: LiveEvent[] = [
  {
    labsCode: '0072',
    name: 'Baltimore Regional Championships',
    rk9Id: 'BA001-nEN1xl5ZJLGtFk',
    pod: 2,
    firstDay: '2026-09-18',
    lastDay: '2026-09-20'
  }
];

const HOUR = 60 * 60 * 1000;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The poller's window: the listed days with a day either side, so no time zone is cut short. */
export function isEventLive(event: LiveEvent, now: Date): boolean {
  return now.getTime() >= dayStart(event.firstDay) - 24 * HOUR && now.getTime() < dayStart(event.lastDay) + 48 * HOUR;
}

/**
 * The window the site advertises the event in: its listed days as the venue
 * lives them, which is the UTC days stretched by the widest offsets either way.
 */
export function isEventOn(event: LiveEvent, now: Date): boolean {
  return now.getTime() >= dayStart(event.firstDay) - 14 * HOUR && now.getTime() < dayStart(event.lastDay) + 36 * HOUR;
}

export function eventsOn(now: Date): LiveEvent[] {
  return LIVE_EVENTS.filter(event => isEventOn(event, now));
}
