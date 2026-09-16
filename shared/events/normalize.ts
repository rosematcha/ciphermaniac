/**
 * Pokedata listing → {@link LocatorEvent}.
 *
 * Pokedata mirrors the official Play! Pokémon locator, including everything a
 * store typed by hand. This is the one place that distrusts it: URLs must be
 * http(s) before they can become links, contact details must look like
 * contact details, and a record missing what the page needs to place it on a
 * map is skipped with a reason rather than rendered half-empty.
 * @module shared/events/normalize
 */

import type { DivisionFees, EventKind, LocatorEvent } from './types';

type RawEvent = Record<string, unknown>;

export type SkipReason = 'kind' | 'cancelled' | 'id' | 'name' | 'date' | 'coordinates' | 'country';

interface Point {
  lat: number;
  lon: number;
}

interface Start {
  date: string;
  time: string;
}

/** IANA time zone at a point, e.g. `America/Chicago`. */
export type ZoneLookup = (lat: number, lon: number) => string;

export type NormalizeResult = { ok: true; event: LocatorEvent } | { ok: false; reason: SkipReason };

const EVENT_ID = /^\d{2}-\d{2}-\d{6}$/;
const EVENT_PAGE_ID = /\/play-pokemon-tournaments\/\d{2}-\d{2}-\d{6}\/?$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const MIDNIGHT = '00:00';
const CLOCK = /^(\d{2}):(\d{2})/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(\/|$)/;
const DETAILS_LIMIT = 600;
const COORDINATE_DIGITS = 5;
/** Name for a local whose store gave it none. */
const LOCAL_FALLBACK_NAME = 'Weekly local';

/** Single-line text: whitespace collapsed, trimmed. Numbers are stringified. */
function text(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Which locator kind a Pokedata `type` names, or null for anything else. */
export function eventKindOf(type: unknown): EventKind | null {
  const value = text(type).toLowerCase();
  if (value.includes('league cup')) {
    return 'cup';
  }
  if (value.includes('league challenge')) {
    return 'challenge';
  }
  if (value.includes('prerelease') || value.includes('pre-release')) {
    return 'prerelease';
  }
  if (value === 'nonpremier tcg') {
    return 'local';
  }
  return null;
}

function isCancelled(raw: RawEvent): boolean {
  return /cancel/i.test(`${text(raw.Status)} ${text(raw.status)}`);
}

/**
 * An http(s) URL, or undefined. Stores often type a bare domain
 * (`www.example.com`), which becomes https. Anything else — `javascript:`,
 * `mailto:`, free text — is dropped, because every value here ends up in an
 * `href`.
 */
export function safeUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) {
    return undefined;
  }
  const candidate = /^https?:\/\//i.test(raw) || !BARE_DOMAIN.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The event's pokemon.com page. Falls back to the page's canonical address,
 * which is built from the event ID, when the listed URL is missing or points
 * anywhere but pokemon.com.
 */
function eventPageUrl(value: unknown, id: string): string {
  const listed = safeUrl(value);
  const host = listed ? new URL(listed).hostname : '';
  if (listed && (host === 'pokemon.com' || host.endsWith('.pokemon.com'))) {
    return listed.replace(/^http:/, 'https:');
  }
  return `https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/${id}/`;
}

function eventIdentity(raw: RawEvent, kind: EventKind): string {
  const displayId = text(raw.Display_id);
  if (EVENT_ID.test(displayId)) {
    return displayId;
  }
  const guid = text(raw.guid) || text(raw.Guid);
  return kind === 'local' && GUID.test(guid) ? guid.toLowerCase() : '';
}

function coordinates(latValue: unknown, lonValue: unknown): { lat: number; lon: number } | null {
  const lat = Number(text(latValue));
  const lon = Number(text(lonValue));
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  // (0, 0) is the geocoder's "no idea", not an event in the Gulf of Guinea.
  if (!valid || (lat === 0 && lon === 0)) {
    return null;
  }
  return { lat: Number(lat.toFixed(COORDINATE_DIGITS)), lon: Number(lon.toFixed(COORDINATE_DIGITS)) };
}

function clock(value: unknown): string {
  const match = CLOCK.exec(text(value));
  return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? `${match[1]}:${match[2]}` : '';
}

/** The sanctioned listing has no UTC locals to move; the locals build passes a real lookup. */
const UTC: ZoneLookup = () => 'UTC';

/**
 * Pokedata's locals table holds two kinds of record. One a store listed as
 * an event on pokemon.com has a name, an event ID in its URL, and a `when` in
 * the venue's wall time. One without an event ID has no name either, and its
 * `when` and `date` are UTC: its starts move an hour across daylight saving,
 * where the listed events' do not.
 */
export function isUtcLocal(raw: RawEvent): boolean {
  return !EVENT_PAGE_ID.test(text(raw.pokemon_url));
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** A UTC `YYYY-MM-DDTHH:MM` as wall time in `zone`, same shape. */
function inZone(utc: string, zone: string): string {
  const format =
    zoneFormats.get(zone) ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  zoneFormats.set(zone, format);
  const parts = Object.fromEntries(format.formatToParts(new Date(`${utc}Z`)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * A local's venue-local date and start, from Pokedata's `when`
 * (`YYYY-MM-DD HH:MM:SS`), moved out of UTC when the record is in UTC. Locals
 * have no `time` field, and a venue-local midnight is a store that listed no
 * time. A `when` that cannot be read leaves the listed date and no time.
 */
function localStart(raw: RawEvent, place: Point, zoneAt: ZoneLookup): Start {
  const when = wallTime(raw.when);
  if (!when) {
    return { date: text(raw.date), time: '' };
  }
  const [date = '', time = ''] = (isUtcLocal(raw) ? inZone(when, zoneAt(place.lat, place.lon)) : when).split('T');
  return { date, time: time === MIDNIGHT ? '' : time };
}

/** The listing's date and start. Sanctioned events list both; locals derive them from `when`. */
function start(raw: RawEvent, kind: EventKind, place: Point, zoneAt: ZoneLookup = UTC): Start {
  return kind === 'local' ? localStart(raw, place, zoneAt) : { date: text(raw.date), time: clock(raw.time) };
}

/** A real calendar date: shape and value (no 2026-02-30). */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Venue-local wall time, zone suffix discarded (see {@link LocatorEvent}). */
function wallTime(value: unknown): string | undefined {
  const match = WALL_TIME.exec(text(value));
  if (!match?.[1] || !isCalendarDate(match[1]) || !clock(match[2])) {
    return undefined;
  }
  return `${match[1]}T${match[2]}`;
}

/**
 * Admission as typed, or undefined when none is listed. A zero is treated as
 * unlisted rather than free: stores leave the field at 0 as often as they
 * mean it.
 */
function fee(value: unknown): string | undefined {
  const raw = text(value);
  const amount = Number.parseFloat(raw.replace(',', '.').replace(/[^\d.]/g, ''));
  if (!raw || amount === 0) {
    return undefined;
  }
  return raw;
}

function divisionFees(raw: RawEvent): DivisionFees | undefined {
  const fees: DivisionFees = {};
  const juniors = fee(raw.Admission_Juniors);
  const seniors = fee(raw.Admission_Seniors);
  const masters = fee(raw.Admission_Masters);
  if (juniors) {
    fees.juniors = juniors;
  }
  if (seniors) {
    fees.seniors = seniors;
  }
  if (masters) {
    fees.masters = masters;
  }
  return Object.keys(fees).length ? fees : undefined;
}

function email(value: unknown): string | undefined {
  const raw = text(value);
  return EMAIL.test(raw) ? raw : undefined;
}

function phone(value: unknown): string | undefined {
  const raw = text(value);
  const digits = raw.replace(/\D/g, '');
  return /^[\d\s()+.-]+$/.test(raw) && digits.length >= 6 ? raw : undefined;
}

/** Store description: line breaks kept, runs of blank lines collapsed, capped. */
export function details(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.length <= DETAILS_LIMIT) {
    return cleaned;
  }
  const cut = cleaned.slice(0, DETAILS_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > DETAILS_LIMIT * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

type OptionalFields = Omit<Partial<LocatorEvent>, 'divisionFees'> & { divisionFees?: DivisionFees };

/** Every optional field, present only when it has a usable value. */
function optionalFields(raw: RawEvent): OptionalFields {
  const candidates: OptionalFields = {
    // Sanctioned events list admission; locals list a cost.
    fee: fee(raw.Admission) ?? fee(raw.cost),
    divisionFees: divisionFees(raw),
    regOpens: wallTime(raw.Registration_start),
    regCloses: wallTime(raw.Registration_end),
    website: safeUrl(raw.Event_website),
    registrationUrl: safeUrl(raw.Third_party_registration_website),
    email: email(raw.contact_email),
    phone: phone(raw.contact_phone),
    details: details(raw.Details)
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined)) as OptionalFields;
}

function skip(reason: SkipReason): NormalizeResult {
  return { ok: false, reason };
}

/**
 * Normalize one Pokedata record.
 * @param raw - A record from the Pokedata `events` array
 * @param zoneAt - The time zone at a venue, for locals listed in UTC
 * @returns The event, or the reason it was skipped
 */
export function normalizeEvent(raw: RawEvent, zoneAt?: ZoneLookup): NormalizeResult {
  const kind = eventKindOf(raw.type);
  if (!kind) {
    return skip('kind');
  }
  if (isCancelled(raw)) {
    return skip('cancelled');
  }
  const id = eventIdentity(raw, kind);
  if (!id) {
    return skip('id');
  }
  const name = text(raw.name) || text(raw.Name) || (kind === 'local' ? LOCAL_FALLBACK_NAME : '');
  if (!name) {
    return skip('name');
  }
  const place = coordinates(raw.latitude, raw.longitude);
  if (!place) {
    return skip('coordinates');
  }
  const { date, time } = start(raw, kind, place, zoneAt);
  if (!isCalendarDate(date)) {
    return skip('date');
  }
  const cc = text(raw.country_code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) {
    return skip('country');
  }
  const event: LocatorEvent = {
    id,
    kind,
    name,
    date,
    time,
    shop: text(raw.shop),
    address: text(raw.street_address),
    city: text(raw.city),
    region: text(raw.state),
    cc,
    ...place,
    ...(kind === 'local' ? {} : { url: eventPageUrl(raw.pokemon_url, id) }),
    ...optionalFields(raw)
  };
  return { ok: true, event };
}
