/**
 * Locals as series: one record per store slot, expanded into dates in the browser.
 *
 * Pokedata lists every week of a store's local as its own record with its own
 * GUID, about a thousand a day for months ahead. Stores run the same slot
 * every week, and a store's league ID is stable across weeks, so the locator
 * keeps one record per store with its weekday-and-time slots inside. A slot
 * seen on consecutive weeks is weekly and carries no dates; any other pattern
 * keeps the dates it was listed on.
 *
 * Pure, like ./build: the producer fetches and writes, and every rule about
 * what ships lives here where tests can reach it.
 * @module shared/events/locals
 */

import { CELL_DEGREES, cellKeyFor } from './cells';
import { LOCAL_FALLBACK_NAME, normalizeEvent, type SkipReason } from './normalize';
import type { LocalsCell, LocalsIndex, LocalSlot, LocalVenue, LocatorEvent } from './types';

export type LocalSkipReason = SkipReason | 'league';

export interface LocalsBuildStats {
  received: number;
  /** Occurrences that made it into a slot. */
  kept: number;
  past: number;
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
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
/** Name for a slot with no store-given name that is not weekly either. */
const IRREGULAR_FALLBACK_NAME = 'Local';

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

interface Occurrence {
  league: string;
  event: LocatorEvent;
}

function leagueOf(record: unknown): string {
  const raw = (record as { league?: unknown } | null)?.league;
  const league = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return /^\d+$/.test(league) ? league : '';
}

function collect(raw: unknown[], cutoff: string): { byLeague: Map<string, LocatorEvent[]>; stats: LocalsBuildStats } {
  const stats: LocalsBuildStats = {
    received: raw.length,
    kept: 0,
    past: 0,
    skipped: {},
    venues: 0,
    slots: 0,
    weekly: 0
  };
  const skip = (reason: LocalSkipReason) => {
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
  };
  const byLeague = new Map<string, LocatorEvent[]>();
  for (const record of raw) {
    const result = normalizeEvent(record && typeof record === 'object' ? (record as Record<string, unknown>) : {});
    if (!result.ok) {
      skip(result.reason);
      continue;
    }
    const occurrence: Occurrence = { league: leagueOf(record), event: result.event };
    if (result.event.kind !== 'local') {
      skip('kind');
    } else if (!occurrence.league) {
      skip('league');
    } else if (result.event.date < cutoff) {
      stats.past++;
    } else {
      byLeague.set(occurrence.league, [...(byLeague.get(occurrence.league) ?? []), result.event]);
      stats.kept++;
    }
  }
  return { byLeague, stats };
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

function isWeekly(dates: string[]): boolean {
  return (
    dates.length >= 2 &&
    dates.every((date, i) => i === 0 || dayNumber(date) - dayNumber(dates[i - 1] ?? date) === WEEK_DAYS)
  );
}

/** One slot from every occurrence of it: dates ascending, name by majority. */
function slotOf(occurrences: LocatorEvent[]): LocalSlot {
  const dates = [...new Set(occurrences.map(event => event.date))].sort();
  const weekly = isWeekly(dates);
  const first = occurrences[0] as LocatorEvent;
  const named = mode(occurrences.map(event => event.name));
  const name = !weekly && named === LOCAL_FALLBACK_NAME ? IRREGULAR_FALLBACK_NAME : named;
  const fee = occurrences.find(event => event.fee)?.fee;
  return {
    weekday: weekdayOf(first.date),
    time: first.time,
    name,
    ...(fee ? { fee } : {}),
    ...(weekly ? {} : { dates })
  };
}

function venueOf(league: string, occurrences: LocatorEvent[]): LocalVenue {
  const bySlot = new Map<string, LocatorEvent[]>();
  for (const event of occurrences) {
    const key = `${weekdayOf(event.date)}|${event.time}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), event]);
  }
  const slots = [...bySlot.values()].map(slotOf).sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
  const { shop, address, city, region, cc, lat, lon } = occurrences[0] as LocatorEvent;
  return { id: league, shop, address, city, region, cc, lat, lon, slots };
}

function buildCells(venues: LocalVenue[]): Map<string, LocalsCell> {
  const cells = new Map<string, LocalsCell>();
  for (const venue of venues) {
    const key = cellKeyFor(venue.lat, venue.lon);
    const cell = cells.get(key) ?? { version: 1 as const, key, venues: [] };
    cell.venues.push(venue);
    cells.set(key, cell);
  }
  return new Map([...cells.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Build the locals artifacts from raw Pokedata locals records.
 * @param raw - Records from the locals table, within the producer's horizon
 * @param options - Clock, attribution, horizon, and cell hashing
 */
export function buildLocalsArtifacts(raw: unknown[], options: LocalsBuildOptions): LocalsArtifacts {
  // Yesterday in UTC: the earliest date still "today" somewhere on Earth.
  const cutoff = new Date(options.now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const { byLeague, stats } = collect(raw, cutoff);
  const venues = [...byLeague.entries()]
    .map(([league, occurrences]) => venueOf(league, occurrences))
    .sort((a, b) => a.id.localeCompare(b.id));
  const cells = buildCells(venues);
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

/** Dates of a weekly slot from today through the horizon. */
function weeklyDates(today: string, horizonDays: number, weekday: number): string[] {
  const last = addDays(today, horizonDays);
  const dates: string[] = [];
  for (
    let date = addDays(today, (weekday - weekdayOf(today) + WEEK_DAYS) % WEEK_DAYS);
    date <= last;
    date = addDays(date, WEEK_DAYS)
  ) {
    dates.push(date);
  }
  return dates;
}

function occurrenceOf(venue: LocalVenue, slot: LocalSlot, date: string): LocatorEvent {
  const { slots: _slots, id, ...place } = venue;
  return {
    id: `${id}-${date}-${slot.time || 'tba'}`,
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
        const dates = slot.dates
          ? slot.dates.filter(date => date >= today)
          : weeklyDates(today, horizonDays, slot.weekday);
        events.push(...dates.map(date => occurrenceOf(venue, slot, date)));
      }
    }
  }
  return events;
}
