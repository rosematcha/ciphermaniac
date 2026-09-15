/**
 * An iCalendar (RFC 5545) file for one event, for "Add to calendar".
 *
 * Times are floating (no zone): the listing only has the venue's wall clock,
 * and a floating time shows as that clock reading on whatever device opens
 * it — right for anyone in the venue's time zone, which is nearly everyone
 * driving to a League Cup.
 * @module lib/events/calendar
 */

import type { LocatorEvent } from '../../../shared/events/types';
import { addressLine, titleCase } from './format';

const LINE_LIMIT = 74;

/** Escape text per RFC 5545 section 3.3.11. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 74 characters, continuing with a leading space. */
export function foldLine(line: string): string {
  const chunks: string[] = [];
  for (let at = 0; at < line.length; at += LINE_LIMIT) {
    chunks.push(line.slice(at, at + LINE_LIMIT));
  }
  return chunks.join('\r\n ');
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function start(event: LocatorEvent): string {
  const day = event.date.replace(/-/g, '');
  return event.time ? `DTSTART:${day}T${event.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${day}`;
}

export function eventCalendar(event: LocatorEvent, now: Date = new Date()): string {
  const location = [titleCase(event.shop), addressLine(event.address, event.cc)].filter(Boolean).join(', ');
  const source = event.url ? [`URL:${event.url}`, `DESCRIPTION:${escapeText(event.url)}`] : [];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ciphermaniac//Event Locator//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@ciphermaniac.com`,
    `DTSTAMP:${utcStamp(now)}`,
    start(event),
    `SUMMARY:${escapeText(titleCase(event.name))}`,
    `LOCATION:${escapeText(location)}`,
    ...source,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function calendarFileName(event: LocatorEvent): string {
  return `pokemon-event-${event.id}.ics`;
}
