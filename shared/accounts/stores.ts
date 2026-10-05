/**
 * Stores: certified Play! Pokémon league locations, keyed by their league ID,
 * that run sanctioned events on the site. A store is its own record, not a
 * role: accounts join it as a Manager (edits the store, its staff and league
 * nights) or Staff (runs every event the store runs). What a store says
 * about itself is checked the same way on the page and in the functions.
 */

import { type AccountRole, canRunCommunityEvents } from './roles.js';

export type StoreRole = 'manager' | 'staff';
export const STORE_ROLES: readonly StoreRole[] = ['manager', 'staff'];

export type StoreStatus = 'active' | 'revoked';

/** How an applicant runs the store they apply for. */
export type Relationship = 'owner' | 'employee' | 'organizer';
export const RELATIONSHIPS: readonly Relationship[] = ['owner', 'employee', 'organizer'];

export const STORE_LIMITS = {
  name: 80,
  address: 200,
  city: 80,
  region: 80,
  postal: 20,
  url: 300,
  phone: 30,
  email: 200,
  details: 1000,
  nightName: 60,
  fee: 20,
  nights: 14,
  exceptions: 60,
  note: 120
} as const;

/** What a store tells players about itself. */
export interface StoreDetails {
  name: string;
  address: string;
  city: string;
  region: string;
  postal: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  website: string;
  discord: string;
  phone: string;
  email: string;
  details: string;
}

/** Where the store is, for the locator and its clock. */
export interface StorePlace {
  lat: number;
  lon: number;
  /** IANA time zone, from the store's location. */
  timeZone: string;
}

/** One weekly league night: a weekday and a local start time. */
export interface LeagueNight {
  id: string;
  /** 0 is Sunday. */
  weekday: number;
  /** Store-local start, HH:MM. */
  time: string;
  name: string;
  fee: string;
}

/** A date a league night does not run as usual: closed, or moved to another time. */
export interface NightException {
  /** Store-local date, YYYY-MM-DD. */
  date: string;
  /** The night it changes; null for every night that day. */
  nightId: string | null;
  /** HH:MM it moves to; null when the night is off. */
  time: string | null;
  note: string;
}

const LEAGUE_RE = /^\d{4,10}$/;
const LEAGUE_URL_RE = /\/leagues\/(\d{4,10})\/?(?:[?#].*)?$/;

/** A league ID out of what an applicant typed: the number, or its pokemon.com league page. */
export function readLeagueId(value: string): string | null {
  const trimmed = value.trim();
  if (LEAGUE_RE.test(trimmed)) {
    return trimmed;
  }
  const match = LEAGUE_URL_RE.exec(trimmed);
  return match?.[1] ?? null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = Record<string, unknown>;

const text = (body: Body, key: string, max: number): string | null => {
  const value = body[key] ?? '';
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : null;
};

/** An https address, or '' for none; null when it is neither. */
function link(value: string | null): string | null {
  if (value === null || value === '') {
    return value;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Whether `zone` is a time zone this runtime knows: formatting with it throws when it is not. */
export function isTimeZone(zone: string): boolean {
  try {
    return zone.length > 0 && new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0).length > 0;
  } catch {
    return false;
  }
}

/** Store details out of a request body, or null when one is missing or malformed. */
export function readStoreDetails(value: unknown): StoreDetails | null {
  const body = (typeof value === 'object' && value ? value : {}) as Body;
  const L = STORE_LIMITS;
  const details = {
    name: text(body, 'name', L.name),
    address: text(body, 'address', L.address),
    city: text(body, 'city', L.city),
    region: text(body, 'region', L.region),
    postal: text(body, 'postal', L.postal),
    country: text(body, 'country', 2)?.toUpperCase() ?? null,
    website: link(text(body, 'website', L.url)),
    discord: link(text(body, 'discord', L.url)),
    phone: text(body, 'phone', L.phone),
    email: text(body, 'email', L.email),
    details: text(body, 'details', L.details)
  };
  return detailsProblem(details) ? null : (details as StoreDetails);
}

function detailsProblem(details: Record<keyof StoreDetails, string | null>): boolean {
  if (Object.values(details).some(value => value === null)) {
    return true;
  }
  const { name, address, country, email } = details as StoreDetails;
  return !name || !address || !COUNTRY_RE.test(country) || (email !== '' && !EMAIL_RE.test(email));
}

function night(value: unknown): LeagueNight | null {
  const body = (typeof value === 'object' && value ? value : {}) as Body;
  const { id, weekday, time } = body;
  const name = text(body, 'name', STORE_LIMITS.nightName);
  const fee = text(body, 'fee', STORE_LIMITS.fee);
  const valid =
    typeof id === 'string' &&
    /^[\w-]{1,24}$/.test(id) &&
    Number.isInteger(weekday) &&
    (weekday as number) >= 0 &&
    (weekday as number) <= 6 &&
    typeof time === 'string' &&
    TIME_RE.test(time) &&
    name !== null &&
    fee !== null;
  return valid ? { id, weekday: weekday as number, time, name, fee } : null;
}

/** League nights out of a request body, or null when any is malformed or two share an ID. */
export function readNights(value: unknown): LeagueNight[] | null {
  if (!Array.isArray(value) || value.length > STORE_LIMITS.nights) {
    return null;
  }
  const nights = value.map(night);
  const ids = new Set(nights.map(item => item?.id));
  return nights.every(item => item !== null) && ids.size === nights.length ? (nights as LeagueNight[]) : null;
}

function exception(value: unknown, nights: readonly LeagueNight[]): NightException | null {
  const body = (typeof value === 'object' && value ? value : {}) as Body;
  const { date, nightId, time } = body;
  const note = text(body, 'note', STORE_LIMITS.note);
  const knownNight = nightId === null || nights.some(item => item.id === nightId);
  const valid =
    typeof date === 'string' &&
    DATE_RE.test(date) &&
    knownNight &&
    (time === null || (typeof time === 'string' && TIME_RE.test(time))) &&
    note !== null;
  return valid ? { date, nightId: nightId as string | null, time: time as string | null, note } : null;
}

/** Exceptions to `nights` out of a request body, or null when any is malformed. */
export function readExceptions(value: unknown, nights: readonly LeagueNight[]): NightException[] | null {
  if (!Array.isArray(value) || value.length > STORE_LIMITS.exceptions) {
    return null;
  }
  const read = value.map(item => exception(item, nights));
  return read.every(item => item !== null) ? (read as NightException[]) : null;
}

/** A store an account belongs to, as far as starting events goes. */
export interface Membership {
  status: StoreStatus;
}

/** Whether the account may start any event: under its own name, or for an active store it belongs to. */
export function canCreateEvents(role: AccountRole | null, stores: readonly Membership[]): boolean {
  return canRunCommunityEvents(role) || stores.some(store => store.status === 'active');
}

/** What an Application for a store carries, besides who sent it. */
export interface StoreApplication {
  leagueId: string;
  details: StoreDetails;
  place: StorePlace | null;
  timeZone: string;
  relationship: Relationship;
  /** The applicant confirms they are a certified Play! Pokémon organizer, or work with one. */
  certified: true;
  nights: LeagueNight[];
}

/** A store's place out of a request body: null for none, undefined when it is malformed. */
export function readPlace(value: unknown): StorePlace | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const body = (typeof value === 'object' ? value : {}) as Body;
  const { lat, lon, timeZone } = body;
  const valid =
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    typeof timeZone === 'string' &&
    isTimeZone(timeZone);
  return valid ? { lat, lon, timeZone } : undefined;
}

/** A store application out of a request body, or why it is not one. */
export function readStoreApplication(value: unknown): StoreApplication | string {
  const body = (typeof value === 'object' && value ? value : {}) as Body;
  const leagueId = typeof body.leagueId === 'string' ? readLeagueId(body.leagueId) : null;
  const details = readStoreDetails(body.details);
  const located = readPlace(body.place);
  const timeZone = typeof body.timeZone === 'string' && isTimeZone(body.timeZone) ? body.timeZone : null;
  const nights = readNights(body.nights ?? []);
  const relationship = RELATIONSHIPS.find(item => item === body.relationship);
  const problems: [boolean, string][] = [
    [!leagueId, 'Enter the store’s league ID'],
    [!details, 'Check the store’s details'],
    [located === undefined || !timeZone, 'Pick the store’s time zone'],
    [!relationship, 'Say how you run the store'],
    [body.certified !== true, 'Confirm you are a certified organizer, or work with one'],
    [!nights, 'Check the league nights']
  ];
  const problem = problems.find(([wrong]) => wrong);
  return problem
    ? problem[1]
    : {
        leagueId: leagueId as string,
        details: details as StoreDetails,
        place: located ?? null,
        timeZone: timeZone as string,
        relationship: relationship as Relationship,
        certified: true,
        nights: nights as LeagueNight[]
      };
}

/** The calendar date (YYYY-MM-DD) in `timeZone` at `now`. */
export function dateIn(timeZone: string, now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
