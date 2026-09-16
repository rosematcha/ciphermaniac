/**
 * Event locator artifacts: the shapes the producer writes to R2 and the browser
 * reads back.
 *
 * Everything lives under `events/v1/`. The version is in the path rather than
 * the payload so a future format can ship beside this one: a tab that loaded
 * the old bundle keeps reading the old files until it reloads.
 *
 * Listings are sharded into fixed latitude/longitude cells (see ./cells) so a
 * visitor downloads the few cells their search circle touches, not the world.
 * @module shared/events/types
 */

export type EventKind = 'cup' | 'challenge' | 'prerelease' | 'local';

export const EVENT_KINDS: readonly EventKind[] = ['cup', 'challenge', 'prerelease', 'local'];
export const DEFAULT_EVENT_KINDS: readonly EventKind[] = ['cup', 'challenge', 'prerelease'];

/** Admission a store lists per division, when it lists them separately. */
export interface DivisionFees {
  juniors?: string;
  seniors?: string;
  masters?: string;
}

/**
 * One sanctioned event, trimmed to what the locator shows.
 *
 * Dates and times are the venue's wall clock. Pokedata stamps registration
 * times with `Z` or `+00:00`, but they are local: a store's registration
 * closes at the same instant its event starts, whatever the time zone.
 */
export interface LocatorEvent {
  /** Play! Pokémon event ID, or the upstream GUID for an unsanctioned local. */
  id: string;
  /** Stable Play! Pokémon league identity, shared by scheduled events and weekly locals. */
  leagueId?: string;
  kind: EventKind;
  name: string;
  /** Venue-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Venue-local start time, `HH:MM`, or `''` when the listing has none. */
  time: string;
  /** Conflicting source times for one unnamed session; `time` stays empty. */
  reportedTimes?: string[];
  /** Store name as listed (usually upper case). */
  shop: string;
  address: string;
  city: string;
  /** State, province, or region as listed. Free text; not standardized. */
  region: string;
  /** ISO 3166-1 alpha-2 country code. */
  cc: string;
  lat: number;
  lon: number;
  /** The event's page on pokemon.com. Locals generally have no event page. */
  url?: string;
  /** Admission as the store typed it, e.g. `10`, `$10.00`, `7€`. */
  fee?: string;
  divisionFees?: DivisionFees;
  /** When the store opens registration, venue-local `YYYY-MM-DDTHH:MM`. */
  regOpens?: string;
  /** When the store closes registration, venue-local `YYYY-MM-DDTHH:MM`. */
  regCloses?: string;
  /** The store's own website. */
  website?: string;
  /** Where the store takes registrations, when it uses a separate site. */
  registrationUrl?: string;
  email?: string;
  phone?: string;
  /** The store's description, trimmed. */
  details?: string;
}

export interface LocatorIndex {
  version: 1;
  /**
   * This run's folder. Cells and places live under it, so publishing never
   * rewrites a file a visitor holding an older index might still request.
   */
  generation: string;
  generatedAt: string;
  /** Human-facing page for the upstream data, for attribution. */
  source: string;
  cellDegrees: number;
  /** Cell key to event count. Only cells with events are listed. */
  cells: Record<string, number>;
  /** Countries with at least one event, ISO alpha-2, sorted. */
  countries: string[];
  kinds: Record<EventKind, number>;
  total: number;
  /** The run before this one, kept one more cycle and deleted by the next run. */
  previous?: { generation: string; cells: string[] };
}

export interface LocatorCell {
  version: 1;
  generatedAt: string;
  key: string;
  /** Sorted by date, then time, then ID. */
  events: LocatorEvent[];
}

/** A city with events, for instant search suggestions. */
export interface LocatorCity {
  name: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  /** Upcoming events listed in this city. */
  count: number;
}

/** A store with events, for instant search suggestions. */
export interface LocatorVenue {
  shop: string;
  city: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  count: number;
  /** Date of the store's next listed event, `YYYY-MM-DD`. */
  next: string;
}

export interface LocatorPlaces {
  version: 1;
  generatedAt: string;
  cities: LocatorCity[];
  venues: LocatorVenue[];
}

/**
 * One recurring slot at a store: a weekday and a start time. Weekly unless
 * `dates` is present, in which case those are the only dates listed. A weekly
 * slot listed from partway through the producer's window, or only up to
 * partway, says so with `from` and `until`, so the browser never shows a week
 * the store did not list.
 */
export interface LocalSlot {
  /** 0 is Sunday, as `Date#getUTCDay`. */
  weekday: number;
  /** Venue-local start, `HH:MM`, or `''` when the store listed none. */
  time: string;
  /** Conflicting source times, without guessing which is the actual start. */
  reportedTimes?: string[];
  name: string;
  fee?: string;
  /** First listed date, `YYYY-MM-DD`, when the series starts after the window does. */
  from?: string;
  /** Last listed date, `YYYY-MM-DD`, when the series ends before the window does. */
  until?: string;
  /** Listed dates, `YYYY-MM-DD`, for a slot that skips weeks. */
  dates?: string[];
}

/** A store with locals. One record per store, however many weeks are listed. */
export interface LocalVenue {
  /** Pokedata's league ID: stable across weeks, unlike each occurrence's GUID. */
  id: string;
  shop: string;
  address: string;
  city: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  /** Sorted by weekday, then time. */
  slots: LocalSlot[];
}

/** The stores with locals in one grid cell. Rewritten only when its content changes. */
export interface LocalsCell {
  version: 1;
  key: string;
  venues: LocalVenue[];
}

export interface LocalsIndex {
  version: 1;
  /** When any cell last changed. */
  updatedAt: string;
  source: string;
  cellDegrees: number;
  /** How many days ahead the producer looked; weekly slots are shown that far. */
  horizonDays: number;
  /** Cell key to its slot count and content hash. Only cells with locals are listed. */
  cells: Record<string, { slots: number; hash: string }>;
  /** Slots across every cell. */
  total: number;
  venues: number;
}

/** R2 key prefix for every locator artifact. */
export const LOCATOR_ROOT = 'events/v1';
export const LOCATOR_INDEX_KEY = `${LOCATOR_ROOT}/index.json`;

export function locatorCellPath(generation: string, cell: string): string {
  return `${LOCATOR_ROOT}/${generation}/cells/${cell}.json`;
}

export function locatorPlacesPath(generation: string): string {
  return `${LOCATOR_ROOT}/${generation}/places.json`;
}

/**
 * Locals live apart from the sanctioned listing: they are off by default, so
 * the default view never downloads them, and their cells sit at stable paths
 * because each is replaced whole and only when it changes.
 */
export const LOCALS_ROOT = 'events/locals/v1';
export const LOCALS_INDEX_KEY = `${LOCALS_ROOT}/index.json`;

export function localsCellPath(cell: string): string {
  return `${LOCALS_ROOT}/cells/${cell}.json`;
}

/**
 * The visitor's approximate location, from Cloudflare's IP geolocation.
 * City-level at best; `/api/locate` answers `{ location: null }` when the
 * edge has none.
 */
export interface ApproximateLocation {
  lat: number;
  lon: number;
  city: string | null;
  region: string | null;
  /** Region code where the edge has one, e.g. `TX`. */
  regionCode: string | null;
  cc: string | null;
}
