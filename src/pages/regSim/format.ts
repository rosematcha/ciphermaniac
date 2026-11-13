/**
 * How the fake registration page words its dates and prices, the way a real
 * registration page does: event-local times, a 12-hour clock with zone names in
 * the US and Canada, a 24-hour clock with a numeric offset everywhere else.
 */

import { addDays, type CalendarDate, offsetMs } from './model';

const TWELVE_HOUR_COUNTRIES = new Set(['United States', 'Canada']);

export type Clock = '12h' | '24h';

export function clockFor(country: string): Clock {
  return TWELVE_HOUR_COUNTRIES.has(country) ? '12h' : '24h';
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

function monthName(date: CalendarDate): string {
  return MONTH.format(Date.UTC(date.year, date.month - 1, 1));
}

/** "January 9-10, 2027", spelling out the month or year only when it changes. */
export function weekendRange(saturday: CalendarDate): string {
  const sunday = addDays(saturday, 1);
  if (sunday.year !== saturday.year) {
    return `${monthName(saturday)} ${saturday.day}, ${saturday.year}-${monthName(sunday)} ${sunday.day}, ${sunday.year}`;
  }
  if (sunday.month !== saturday.month) {
    return `${monthName(saturday)} ${saturday.day}-${monthName(sunday)} ${sunday.day}, ${sunday.year}`;
  }
  return `${monthName(saturday)} ${saturday.day}-${sunday.day}, ${sunday.year}`;
}

/** "January 9, 2027" in the event's zone. */
export function zonedDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric', year: 'numeric' }).format(instant);
}

/** "2027-01-09" in the event's zone. */
export function isoDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant
  );
}

/** "11:59 PM" or "23:59". */
export function clockTime(instant: number, timeZone: string, clock: Clock): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: clock === '12h' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: clock === '12h' ? 'h12' : 'h23'
  }).format(instant);
}

/** "PST" where the zone has a common name, otherwise its offset: "-03", "+0530". */
export function zoneAbbreviation(instant: number, timeZone: string, clock: Clock): string {
  if (clock === '12h') {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(instant);
    return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone;
  }
  const minutes = Math.round(offsetMs(instant, timeZone) / 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0');
  const rest = Math.abs(minutes) % 60;
  return `${sign}${hours}${rest ? String(rest).padStart(2, '0') : ''}`;
}

/** "11:59 PM PST (America/Los_Angeles)" or "23:59 -03 (America/Recife)". */
export function zonedTime(instant: number, timeZone: string, clock: Clock): string {
  return `${clockTime(instant, timeZone, clock)} ${zoneAbbreviation(instant, timeZone, clock)} (${timeZone})`;
}

/** "2026-11-11 23:15:08", in UTC. */
export function utcStamp(instant: number): string {
  return new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
}

/** "R$220.00", "¥6,200", "CA$54.00": the currency's own symbol and decimals. */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** "2:07.4": minutes, seconds and tenths, for the time it took to register. */
export function elapsed(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}
