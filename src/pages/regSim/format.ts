/**
 * How the fake registration page words its dates and prices: event-local
 * times with the zone spelled out, the way a real registration page does.
 */

import { addDays, type CalendarDate } from './model';

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

/** "January 9, 2027, 8:30 AM GMT-3 (America/Recife)". */
export function zonedDateTime(instant: number, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(instant);
  return `${text} (${timeZone})`;
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
