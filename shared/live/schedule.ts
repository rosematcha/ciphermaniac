/**
 * When a scheduled event counts as live. The schedule itself is
 * `live/v1/schedule.json`, rebuilt from RK9's event list by the poller.
 * @module shared/live/schedule
 */

import { detectEventsBreakage, type Rk9EventsParse } from './rk9Events';
import type { LiveEvent, LiveSchedule } from './types';

export const LIVE_SCHEDULE_KEY = 'live/v1/schedule.json';

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

export function eventsOn(events: readonly LiveEvent[], now: Date): LiveEvent[] {
  return events.filter(event => isEventOn(event, now));
}

/** RK9 lists events weeks ahead, so twice a day is plenty. */
const SCHEDULE_MAX_AGE_MS = 12 * HOUR;

export function isScheduleStale(schedule: LiveSchedule | null, now: Date): boolean {
  return !schedule || now.getTime() - Date.parse(schedule.generatedAt) >= SCHEDULE_MAX_AGE_MS;
}

/**
 * The schedule a fresh read of RK9's list supports, or null when the read
 * should not replace the published one: the markup moved, or the list came back
 * without a single followed event, which has never been true of the real page.
 */
export function buildSchedule(parse: Rk9EventsParse, now: Date): LiveSchedule | null {
  const breakage = detectEventsBreakage(parse);
  if (breakage) {
    console.warn(`live schedule: ${breakage}`);
    return null;
  }
  return parse.events.length > 0 ? { generatedAt: now.toISOString(), events: parse.events } : null;
}
