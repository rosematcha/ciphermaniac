/**
 * Choosing and ordering the events around a point.
 * @module lib/events/filter
 */

import type { EventKind, LocatorEvent } from '../../../shared/events/types';
import { distanceKm, type LatLon } from './geo';
import { daysBetween } from './format';

export interface LocatorQuery {
  center: LatLon;
  radiusKm: number;
  kinds: ReadonlySet<EventKind>;
  /** Only events within this many days of today; null for everything listed. */
  windowDays: number | null;
  /** The visitor's local date, `YYYY-MM-DD`. */
  today: string;
}

export interface PlacedEvent extends LocatorEvent {
  distanceKm: number;
}

export interface EventDay {
  date: string;
  events: PlacedEvent[];
}

/** A map marker: one per store, carrying how many listed events it has. */
export interface VenueMarker {
  key: string;
  shop: string;
  lat: number;
  lon: number;
  count: number;
  hasCup: boolean;
  /** ID of the store's soonest listed event, for jumping to it. */
  firstId: string;
}

function inWindow(event: LocatorEvent, query: LocatorQuery): boolean {
  const days = daysBetween(query.today, event.date);
  return days >= 0 && (query.windowDays === null || days < query.windowDays);
}

/**
 * Events inside the circle, kind, and date window, soonest first. Ties go to
 * the nearer store, so a day's list reads outward from the visitor.
 */
export function filterEvents(events: readonly LocatorEvent[], query: LocatorQuery): PlacedEvent[] {
  const placed: PlacedEvent[] = [];
  for (const event of events) {
    if (!query.kinds.has(event.kind) || !inWindow(event, query)) {
      continue;
    }
    const km = distanceKm(query.center, event);
    if (km <= query.radiusKm) {
      placed.push({ ...event, distanceKm: km });
    }
  }
  return placed.sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.distanceKm - b.distanceKm
  );
}

/** Consecutive events grouped by date. Expects input sorted by date. */
export function groupByDay(events: readonly PlacedEvent[]): EventDay[] {
  const days: EventDay[] = [];
  for (const event of events) {
    const last = days[days.length - 1];
    if (last?.date === event.date) {
      last.events.push(event);
    } else {
      days.push({ date: event.date, events: [event] });
    }
  }
  return days;
}

export function venueKey(event: Pick<LocatorEvent, 'shop' | 'lat' | 'lon'>): string {
  return `${event.shop}|${event.lat.toFixed(3)}|${event.lon.toFixed(3)}`;
}

/** One marker per store. Expects events sorted soonest first. */
export function venueMarkers(events: readonly PlacedEvent[]): VenueMarker[] {
  const markers = new Map<string, VenueMarker>();
  for (const event of events) {
    const key = venueKey(event);
    const marker = markers.get(key);
    if (marker) {
      marker.count++;
      marker.hasCup ||= event.kind === 'cup';
      continue;
    }
    markers.set(key, {
      key,
      shop: event.shop,
      lat: event.lat,
      lon: event.lon,
      count: 1,
      hasCup: event.kind === 'cup',
      firstId: event.id
    });
  }
  return [...markers.values()];
}
