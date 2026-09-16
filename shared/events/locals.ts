/**
 * Locals as series: one record per store slot, expanded into dates in the browser.
 *
 * Pokedata lists every week of a store's local as its own record with its own
 * GUID, about a thousand a day for months ahead. Stores run the same slot
 * every week, and a store's league ID is stable across weeks, so the locator
 * keeps one record per store with its weekday-and-time slots inside. A slot
 * listed on every week it could be is weekly and carries no dates; one that
 * starts or stops partway through the window says where; one that skips
 * weeks keeps the dates it was listed on.
 *
 * Pure, like ./build: the producer fetches and writes, and every rule about
 * what ships lives here where tests can reach it.
 * @module shared/events/locals
 */

import { isoDay, pastCutoff } from './build';
import { CELL_DEGREES, shardByCell } from './cells';
import { isUtcLocal, normalizeEvent, type SkipReason, type ZoneLookup } from './normalize';
import type { LocalsCell, LocalsIndex, LocalSlot, LocalVenue, LocatorEvent } from './types';

export type LocalSkipReason = SkipReason | 'league';

export interface LocalsBuildStats {
  received: number;
  /** Occurrences that made it into a slot. */
  kept: number;
  past: number;
  /** Past the window's last day once moved to venue-local time. */
  later: number;
  /** Unnamed records of a session the store also listed as an event. */
  doubles: number;
  skipped: Partial<Record<LocalSkipReason, number>>;
  venues: number;
  slots: number;
  weekly: number;
}

export interface LocalsArtifacts {
  index: LocalsIndex;
  cells: Map<string, LocalsCell>;
  stats: LocalsBuildStats;
}

export interface LocalsBuildOptions {
  now: Date;
  source: string;
  horizonDays: number;
  /** Content hash of a cell, recorded in the index so unchanged cells are not rewritten. */
  hash: (cell: LocalsCell) => string;
  /** The time zone at a venue, for the records Pokedata lists in UTC. */
  zoneAt: ZoneLookup;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
/** How close to a listed event's start an unnamed record the same day is still the same session. */
const SAME_SESSION_MINUTES = 120;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** 0 is Sunday, as `Date#getUTCDay`. */
export function weekdayOf(date: string): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

/** The first date on or after `date` that falls on `weekday`. */
function nextOnWeekday(date: string, weekday: number): string {
  return addDays(date, (weekday - weekdayOf(date) + WEEK_DAYS) % WEEK_DAYS);
}

/** The last date on or before `date` that falls on `weekday`. */
function lastOnWeekday(date: string, weekday: number): string {
  return addDays(date, -((weekdayOf(date) - weekday + WEEK_DAYS) % WEEK_DAYS));
}

function leagueOf(record: unknown): string {
  const raw = (record as { league?: unknown } | null)?.league;
  const league = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return /^\d+$/.test(league) ? league : '';
}

/** The producer's window: the dates a listing could fall on. */
interface Window {
  start: string;
  end: string;
}

interface Occurrence {
  event: LocatorEvent;
  /** Listed as an event on pokemon.com, rather than one of the unnamed UTC records. */
  listed: boolean;
}

function collect(
  raw: unknown[],
  window: Window,
  options: LocalsBuildOptions
): { byLeague: Map<string, Occurrence[]>; stats: LocalsBuildStats } {
  const stats: LocalsBuildStats = {
    received: raw.length,
    kept: 0,
    past: 0,
    later: 0,
    doubles: 0,
    skipped: {},
    venues: 0,
    slots: 0,
    weekly: 0
  };
  const skip = (reason: LocalSkipReason) => {
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
  };
  const cutoff = pastCutoff(options.now);
  const byLeague = new Map<string, Occurrence[]>();
  for (const record of raw) {
    const fields = record && typeof record === 'object' ? (record as Record<string, unknown>) : {};
    const result = normalizeEvent(fields, options.zoneAt);
    if (!result.ok) {
      skip(result.reason);
      continue;
    }
    const league = leagueOf(record);
    if (result.event.kind !== 'local') {
      skip('kind');
    } else if (!league) {
      skip('league');
    } else if (result.event.date < cutoff) {
      stats.past++;
    } else if (result.event.date > window.end) {
      stats.later++;
    } else {
      byLeague.set(league, [...(byLeague.get(league) ?? []), { event: result.event, listed: !isUtcLocal(fields) }]);
    }
  }
  return { byLeague, stats };
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isSameSession(a: LocatorEvent, b: LocatorEvent): boolean {
  if (a.date !== b.date) {
    return false;
  }
  return !a.time || !b.time || Math.abs(minutesOf(a.time) - minutesOf(b.time)) <= SAME_SESSION_MINUTES;
}

/**
 * Stores often list one session twice: as an event on pokemon.com, and as an
 * unnamed record at the same time or a little before it. The listed event
 * carries the name and fee, so it stands and the unnamed record goes.
 */
function withoutDoubles(occurrences: Occurrence[]): LocatorEvent[] {
  const listed = occurrences.filter(occurrence => occurrence.listed).map(occurrence => occurrence.event);
  return occurrences
    .filter(occurrence => occurrence.listed || !listed.some(event => isSameSession(event, occurrence.event)))
    .map(occurrence => occurrence.event);
}

/** The most common value, earliest seen breaking ties. */
function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** No skipped weeks between the first and last listed date. */
function isConsecutive(dates: string[]): boolean {
  return dates.every((date, i) => i === 0 || dayNumber(date) - dayNumber(dates[i - 1] ?? date) === WEEK_DAYS);
}

/**
 * How a slot recurs. Listed on every week it could be inside the window:
 * weekly, with `from` or `until` where the listing starts late or stops
 * early. Any skipped week: the dates as listed.
 */
function recurrence(dates: string[], weekday: number, window: Window): Pick<LocalSlot, 'from' | 'until' | 'dates'> {
  if (!isConsecutive(dates)) {
    return { dates };
  }
  const first = dates[0] as string;
  const last = dates[dates.length - 1] as string;
  return {
    ...(first > nextOnWeekday(window.start, weekday) ? { from: first } : {}),
    ...(last < lastOnWeekday(window.end, weekday) ? { until: last } : {})
  };
}

/** One slot from every occurrence of it: name by majority, fee from the first that has one. */
function slotOf(occurrences: LocatorEvent[], window: Window): LocalSlot {
  const dates = [...new Set(occurrences.map(event => event.date))].sort();
  const first = occurrences[0] as LocatorEvent;
  const weekday = weekdayOf(first.date);
  const fee = occurrences.find(event => event.fee)?.fee;
  return {
    weekday,
    time: first.time,
    name: mode(occurrences.map(event => event.name)),
    ...(fee ? { fee } : {}),
    ...recurrence(dates, weekday, window)
  };
}

function venueOf(league: string, occurrences: LocatorEvent[], window: Window): LocalVenue {
  const bySlot = new Map<string, LocatorEvent[]>();
  for (const event of occurrences) {
    const key = `${weekdayOf(event.date)}|${event.time}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), event]);
  }
  const slots = [...bySlot.values()]
    .map(events => slotOf(events, window))
    .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
  const { shop, address, city, region, cc, lat, lon } = occurrences[0] as LocatorEvent;
  return { id: league, shop, address, city, region, cc, lat, lon, slots };
}

/**
 * Build the locals artifacts from raw Pokedata locals records.
 * @param raw - Records from the locals table, within the producer's horizon
 * @param options - Clock, attribution, horizon, cell hashing, and venue time zones
 */
export function buildLocalsArtifacts(raw: unknown[], options: LocalsBuildOptions): LocalsArtifacts {
  const window = { start: isoDay(options.now), end: addDays(isoDay(options.now), options.horizonDays) };
  const { byLeague, stats } = collect(raw, window, options);
  const venues = [...byLeague.entries()]
    .map(([league, occurrences]) => {
      const events = withoutDoubles(occurrences);
      stats.kept += events.length;
      stats.doubles += occurrences.length - events.length;
      return venueOf(league, events, window);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const cells = new Map(
    [...shardByCell(venues)].map(([key, cellVenues]) => [key, { version: 1 as const, key, venues: cellVenues }])
  );
  stats.venues = venues.length;
  for (const venue of venues) {
    stats.slots += venue.slots.length;
    stats.weekly += venue.slots.filter(slot => !slot.dates).length;
  }
  const index: LocalsIndex = {
    version: 1,
    updatedAt: options.now.toISOString(),
    source: options.source,
    cellDegrees: CELL_DEGREES,
    horizonDays: options.horizonDays,
    cells: Object.fromEntries(
      [...cells.entries()].map(([key, cell]) => [
        key,
        { slots: cell.venues.reduce((n, venue) => n + venue.slots.length, 0), hash: options.hash(cell) }
      ])
    ),
    total: stats.slots,
    venues: venues.length
  };
  return { index, cells, stats };
}

/** Dates of a weekly slot from today through the horizon, inside its `from` and `until`. */
function weeklyDates(slot: LocalSlot, today: string, horizonDays: number): string[] {
  const start = slot.from && slot.from > today ? slot.from : today;
  const horizon = addDays(today, horizonDays);
  const end = slot.until && slot.until < horizon ? slot.until : horizon;
  const dates: string[] = [];
  for (let date = nextOnWeekday(start, slot.weekday); date <= end; date = addDays(date, WEEK_DAYS)) {
    dates.push(date);
  }
  return dates;
}

function occurrenceOf(venue: LocalVenue, slot: LocalSlot, date: string): LocatorEvent {
  const { slots: _slots, id, ...place } = venue;
  return {
    // No colon: the ID becomes a calendar file name.
    id: `${id}-${date}-${slot.time.replace(':', '') || 'tba'}`,
    kind: 'local',
    name: slot.name,
    date,
    time: slot.time,
    ...place,
    ...(slot.fee ? { fee: slot.fee } : {})
  };
}

/**
 * Every dated local from today through the horizon, in the shape the rest of
 * the locator reads. Weekly slots recur from today; listed dates are kept as
 * listed, less the past.
 * @param cells - The locals cells around the visitor
 * @param today - The visitor's local date, `YYYY-MM-DD`
 * @param horizonDays - The index's horizon
 */
export function expandLocals(cells: readonly LocalsCell[], today: string, horizonDays: number): LocatorEvent[] {
  const events: LocatorEvent[] = [];
  for (const cell of cells) {
    for (const venue of cell.venues) {
      for (const slot of venue.slots) {
        const dates = slot.dates ? slot.dates.filter(date => date >= today) : weeklyDates(slot, today, horizonDays);
        events.push(...dates.map(date => occurrenceOf(venue, slot, date)));
      }
    }
  }
  return events;
}
