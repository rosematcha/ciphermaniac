/**
 * Normalized events → the three locator artifacts: the index, one file per
 * grid cell, and the place list that powers instant search.
 *
 * Pure: the producer handles fetching and writing, so every rule about what
 * ships lives here where tests can reach it.
 * @module shared/events/build
 */

import { CELL_DEGREES, cellKeyFor } from './cells';
import { normalizeEvent, type SkipReason } from './normalize';
import {
  EVENT_KINDS,
  type EventKind,
  type LocatorCell,
  type LocatorCity,
  type LocatorEvent,
  type LocatorIndex,
  type LocatorPlaces,
  type LocatorVenue
} from './types';

export interface BuildStats {
  received: number;
  kept: number;
  /** Listings dated before yesterday (UTC), which no time zone still has ahead of it. */
  past: number;
  duplicates: number;
  skipped: Partial<Record<SkipReason, number>>;
}

export interface LocatorArtifacts {
  index: LocatorIndex;
  cells: Map<string, LocatorCell>;
  places: LocatorPlaces;
  stats: BuildStats;
}

export interface BuildOptions {
  now: Date;
  /** Human-facing upstream page, recorded for attribution. */
  source: string;
}

/**
 * A new generation smaller than this share of the last one is treated as an
 * upstream failure, not a quiet week. Event counts move a few percent a day;
 * losing forty percent overnight means pages went missing.
 */
export const MIN_SHARE_OF_PREVIOUS = 0.6;

/**
 * Place-list coordinates are only ever used to centre a search, so about a
 * hundred metres of precision is plenty. The rounding takes a sixth off a
 * file visitors download the first time they search.
 */
const PLACE_DIGITS = 3;

/** Folder name for a run, e.g. `20260915T100000Z`: sortable and path-safe. */
export function generationId(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}/, '')
    .replace(/[-:]/g, '');
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compareEvents(a: LocatorEvent, b: LocatorEvent): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id);
}

function foldKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** Normalize, drop the past, and de-duplicate (a later page's copy wins). */
function collectEvents(raw: unknown[], cutoff: string): { events: LocatorEvent[]; stats: BuildStats } {
  const stats: BuildStats = { received: raw.length, kept: 0, past: 0, duplicates: 0, skipped: {} };
  const byId = new Map<string, LocatorEvent>();
  for (const record of raw) {
    const result = normalizeEvent(record && typeof record === 'object' ? (record as Record<string, unknown>) : {});
    if (!result.ok) {
      stats.skipped[result.reason] = (stats.skipped[result.reason] ?? 0) + 1;
      continue;
    }
    if (result.event.date < cutoff) {
      stats.past++;
      continue;
    }
    if (byId.has(result.event.id)) {
      stats.duplicates++;
    }
    byId.set(result.event.id, result.event);
  }
  const events = [...byId.values()].sort(compareEvents);
  stats.kept = events.length;
  return { events, stats };
}

function buildCells(events: LocatorEvent[], generatedAt: string): Map<string, LocatorCell> {
  const cells = new Map<string, LocatorCell>();
  for (const event of events) {
    const key = cellKeyFor(event.lat, event.lon);
    const cell = cells.get(key) ?? { version: 1 as const, generatedAt, key, events: [] };
    cell.events.push(event);
    cells.set(key, cell);
  }
  return new Map([...cells.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function buildCities(events: LocatorEvent[]): LocatorCity[] {
  // Longitude is averaged on the circle, so a city straddling the antimeridian
  // stays there instead of landing on the far side of the world.
  const cities = new Map<string, LocatorCity & { latSum: number; lonX: number; lonY: number }>();
  for (const event of events) {
    if (!event.city) {
      continue;
    }
    const key = `${foldKey(event.city)}|${foldKey(event.region)}|${event.cc}`;
    const city = cities.get(key) ?? {
      name: event.city,
      region: event.region,
      cc: event.cc,
      lat: 0,
      lon: 0,
      count: 0,
      latSum: 0,
      lonX: 0,
      lonY: 0
    };
    city.latSum += event.lat;
    city.lonX += Math.cos((event.lon * Math.PI) / 180);
    city.lonY += Math.sin((event.lon * Math.PI) / 180);
    city.count++;
    cities.set(key, city);
  }
  return [...cities.values()]
    .map(({ latSum, lonX, lonY, ...city }) => ({
      ...city,
      lat: round(latSum / city.count, PLACE_DIGITS),
      lon: round((Math.atan2(lonY, lonX) * 180) / Math.PI, PLACE_DIGITS)
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildVenues(events: LocatorEvent[]): LocatorVenue[] {
  const venues = new Map<string, LocatorVenue>();
  for (const event of events) {
    if (!event.shop) {
      continue;
    }
    // Chains reuse a name across towns; the rounded position keeps branches apart.
    const key = `${foldKey(event.shop)}|${event.lat.toFixed(2)}|${event.lon.toFixed(2)}`;
    const venue = venues.get(key);
    if (venue) {
      venue.count++;
      continue;
    }
    // Events arrive sorted, so the first one seen is the venue's next event.
    venues.set(key, {
      shop: event.shop,
      city: event.city,
      region: event.region,
      cc: event.cc,
      lat: round(event.lat, PLACE_DIGITS),
      lon: round(event.lon, PLACE_DIGITS),
      count: 1,
      next: event.date
    });
  }
  return [...venues.values()].sort((a, b) => a.shop.localeCompare(b.shop) || a.city.localeCompare(b.city));
}

function countKinds(events: LocatorEvent[]): Record<EventKind, number> {
  const kinds = Object.fromEntries(EVENT_KINDS.map(kind => [kind, 0])) as Record<EventKind, number>;
  for (const event of events) {
    kinds[event.kind]++;
  }
  return kinds;
}

/**
 * Build every artifact from raw Pokedata records.
 * @param raw - Records from every page of the Pokedata listing
 * @param options - Clock and attribution source
 * @returns The artifacts plus counts of what was kept and why the rest was not
 */
export function buildLocatorArtifacts(raw: unknown[], options: BuildOptions): LocatorArtifacts {
  const generatedAt = options.now.toISOString();
  // Yesterday in UTC: the earliest date still "today" somewhere on Earth.
  const cutoff = isoDay(new Date(options.now.getTime() - 24 * 60 * 60 * 1000));
  const { events, stats } = collectEvents(raw, cutoff);
  const cells = buildCells(events, generatedAt);
  const index: LocatorIndex = {
    version: 1,
    generation: generationId(options.now),
    generatedAt,
    source: options.source,
    cellDegrees: CELL_DEGREES,
    cells: Object.fromEntries([...cells.entries()].map(([key, cell]) => [key, cell.events.length])),
    countries: [...new Set(events.map(event => event.cc))].sort(),
    kinds: countKinds(events),
    total: events.length
  };
  const places: LocatorPlaces = { version: 1, generatedAt, cities: buildCities(events), venues: buildVenues(events) };
  return { index, cells, places, stats };
}

/**
 * Why a new generation must not replace the last one, or null when it may.
 * @param previousTotal - Event count of the generation currently published, if any
 * @param nextTotal - Event count of the generation about to be published
 */
export function shrinkProblem(previousTotal: number | null, nextTotal: number): string | null {
  if (nextTotal === 0) {
    return 'the new generation has no events';
  }
  if (previousTotal && nextTotal < previousTotal * MIN_SHARE_OF_PREVIOUS) {
    return `the new generation has ${nextTotal} events, under ${Math.round(MIN_SHARE_OF_PREVIOUS * 100)}% of the ${previousTotal} published`;
  }
  return null;
}
