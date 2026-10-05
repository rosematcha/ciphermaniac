/**
 * Stores and community organizers from the browser: the calls behind the
 * apply page, store settings, the store page and the listing picker, and the
 * small readings of their data the pages share (a league night's line, a
 * listing as the setup it fills, an invite as a link).
 */

import type {
  GivenRole,
  LeagueNight,
  NightException,
  StoreApplication,
  StoreDetails,
  StoreRole
} from '../../../shared/accounts/stores';
import type {
  LeagueFound,
  Listing,
  MyApplication,
  PublicStore,
  Store,
  StoreInvite,
  StoreMember
} from '../../../shared/accounts/types';
import type { EventType } from '../../../shared/tournament/types';
import { titleCase } from '../events/format';
import { call, json, type Me } from './api';

const storePath = (id: string) => `/api/stores/${encodeURIComponent(id)}`;

/** What the locator knows of a league, and whether a store on the site already holds it. */
export const fetchLeague = (idOrPage: string) =>
  call<{ leagueId: string; league: LeagueFound | null; taken: boolean }>(
    `/api/leagues/${encodeURIComponent(idOrPage.trim())}`
  );

/** The account becomes a Community organizer. */
export const joinCommunity = () => call<{ user: Me }>('/api/community', { method: 'POST' });

/** Sends an Application for a store, with the uploaded proof when `proof` says so. */
export const sendStoreApplication = (store: StoreApplication, explanation: string, proof: boolean) =>
  call<{ application: MyApplication }>('/api/applications', json('POST', { store, explanation, proof }));

/** What anyone may read about a store; its people also get its phone and email, and what they are in it. */
export const fetchStore = (id: string) =>
  call<{ store: PublicStore; role: StoreRole | null; contact?: { phone: string; email: string } }>(storePath(id));

export interface DetailsChange {
  details: StoreDetails;
  timeZone: string;
  place: { lat: number; lon: number; timeZone: string } | null;
}

export const saveStoreDetails = (id: string, change: DetailsChange) =>
  call<{ store: Store }>(storePath(id), json('PATCH', change));

export const saveLeagueNights = (id: string, nights: LeagueNight[], exceptions: NightException[]) =>
  call<{ nights: LeagueNight[]; exceptions: NightException[] }>(
    `${storePath(id)}/nights`,
    json('PUT', { nights, exceptions })
  );

export interface People {
  members: StoreMember[];
  invites: StoreInvite[];
}

export const fetchPeople = (id: string) => call<People>(`${storePath(id)}/members`);

/** A single-use link letting one person in as `role`; its token is only ever shown now. */
export const createInvite = (id: string, role: GivenRole) =>
  call<{ token: string }>(`${storePath(id)}/members`, json('POST', { invite: role }));

/** Makes someone a Manager or Staff; 'owner', sent by the Owner, hands them the store. */
export const setMemberRole = (id: string, user: string, role: StoreRole) =>
  call<People>(`${storePath(id)}/members`, json('PATCH', { user, role }));

export const removeMember = (id: string, user: string) =>
  call<null>(`${storePath(id)}/members?${new URLSearchParams({ user }).toString()}`, { method: 'DELETE' });

export const withdrawInvite = (id: string, invite: string) =>
  call<null>(`${storePath(id)}/members?${new URLSearchParams({ invite }).toString()}`, { method: 'DELETE' });

/** The signed-in account joins the store an invite link was made for. */
export const joinStore = (token: string) => call<{ storeId: string }>('/api/stores/join', json('POST', { token }));

/** What pokemon.com lists for the store's league from today on. */
export const fetchListings = (id: string) => call<{ listings: Listing[] }>(`${storePath(id)}/listings`);

/** The link a new store member opens: it signs them in if needed, then joins them. */
export const inviteLink = (origin: string, token: string) =>
  `${origin}/stores/join?${new URLSearchParams({ invite: token }).toString()}`;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** HH:MM as a reader in the US reads it, e.g. 19:30 as 7:30 PM. */
export function clock(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** A store-local YYYY-MM-DD as "Wed, Oct 7", read as the calendar date it names wherever the reader is. */
export function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

/** A time zone as people name it, e.g. "Central Time"; the zone's own ID when the browser has no name for it. */
export function zoneName(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(0);
    return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** Every time zone the browser knows, the store's own kept in the list when the browser lacks it. */
export function timeZones(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return current && !known.includes(current) ? [current, ...known] : known;
}

/** The browser's own time zone, the default for a store nothing says the zone of. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An ID for a new league night, unique among a store's few. */
export const newNightId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);

/** A new league night: the next weekday the store has none on, at 6:00 PM. */
export function blankNight(nights: readonly LeagueNight[]): LeagueNight {
  const taken = new Set(nights.map(night => night.weekday));
  const weekday = [3, 4, 5, 2, 1, 6, 0].find(day => !taken.has(day)) ?? 0;
  return { id: newNightId(), weekday, time: '18:00', name: '', fee: '' };
}

/** Nights in the order of the week, then the clock. */
export const byWeek = (nights: readonly LeagueNight[]) =>
  [...nights].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));

/** What an exception does to its night: "Off", or "Moved to 4:00 PM". */
export const exceptionChange = (exception: NightException) =>
  exception.time === null ? 'Off' : `Moved to ${clock(exception.time)}`;

export const LISTING_KINDS: Record<Listing['kind'], string> = {
  cup: 'League Cup',
  challenge: 'League Challenge',
  prerelease: 'Prerelease',
  local: 'Local'
};

/** What picking a listing fills in the new event's setup. */
export interface ListingFill {
  name: string;
  /** As a datetime-local input takes it; '' when the listing has no time. */
  startsAt: string;
  sanctionId: string;
  /** Cups and Challenges are run sanctioned here; Prereleases and locals carry their ID but run as they are. */
  sanctioned: boolean;
  eventType: EventType;
}

export function listingFill(listing: Listing): ListingFill {
  const sanctioned = listing.kind === 'cup' || listing.kind === 'challenge';
  return {
    name: listing.name,
    startsAt: listing.time ? `${listing.date}T${listing.time}` : '',
    sanctionId: listing.sanctionId,
    sanctioned,
    eventType: listing.kind === 'challenge' ? 'challenge' : 'cup'
  };
}

/** The store details a league lookup can say; the rest stay as the applicant typed them. */
export function detailsFromLeague(
  found: LeagueFound
): Pick<StoreDetails, 'name' | 'address' | 'city' | 'region' | 'country'> {
  return {
    name: titleCase(found.shop),
    address: titleCase(found.address),
    city: titleCase(found.city),
    region: found.region.length <= 3 ? found.region.toUpperCase() : titleCase(found.region),
    country: found.cc.toUpperCase()
  };
}

/** A store's own events by date: TOM's MM/DD/YYYY with the start time when there is one. */
export function storeEventWhen(startDate: string, startsAt: string): string {
  const [month, day, year] = startDate.split('/');
  const date = year && month && day ? shortDay(`${year}-${month}-${day}`) : startDate;
  const time = startsAt.slice(11, 16);
  return time ? `${date}, ${clock(time)}` : date;
}

/** An address on one line: street, city, region and postal code as there are. */
export function addressOf(store: Pick<StoreDetails, 'address' | 'city' | 'region' | 'postal'>): string {
  const place = [store.city, [store.region, store.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [store.address, place].filter(Boolean).join(', ');
}

/** A store-entered link shown as people type it, without its scheme. */
export const bareLink = (url: string) => url.replace(/^https:\/\//, '').replace(/\/$/, '');

const EMPTY_DETAILS: StoreDetails = {
  name: '',
  address: '',
  city: '',
  region: '',
  postal: '',
  country: 'US',
  website: '',
  discord: '',
  phone: '',
  email: '',
  details: ''
};

/** Store details with nothing typed yet. */
export const emptyDetails = (): StoreDetails => ({ ...EMPTY_DETAILS });

/** Whether `value` is an https address, read as the server reads it. */
function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The fields of `details` the server would refuse, each with why, as the form shows them. */
export function detailsProblems(details: StoreDetails): Partial<Record<keyof StoreDetails, string>> {
  const problems: Partial<Record<keyof StoreDetails, string>> = {};
  const link = (value: string) => value.trim() !== '' && !isHttps(value.trim());
  if (!details.name.trim()) {
    problems.name = 'Enter the store’s name';
  }
  if (!details.address.trim()) {
    problems.address = 'Enter the store’s address';
  }
  if (!/^[A-Za-z]{2}$/.test(details.country.trim())) {
    problems.country = 'Two letters, e.g. US';
  }
  if (link(details.website)) {
    problems.website = 'Starts with https://';
  }
  if (link(details.discord)) {
    problems.discord = 'Starts with https://';
  }
  if (details.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) {
    problems.email = 'Not an email address';
  }
  return problems;
}

/** Details as the server keeps them: trimmed, the country in capitals. */
export function cleanDetails(details: StoreDetails): StoreDetails {
  const trimmed = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]));
  return { ...(trimmed as unknown as StoreDetails), country: details.country.trim().toUpperCase() };
}

/** The name the server lists an invite link under: the start of its token's SHA-256, as hex. */
export async function inviteId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
