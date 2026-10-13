/**
 * Stores that run their events on Ciphermaniac, as the event locator reads
 * them (published by events.ciphermaniac.com): where each is, and
 * its own league nights, which stand in for what Pokedata lists for the same
 * league. Types and the key only.
 * @module shared/events/stores
 */

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

export const STORES_INDEX_KEY = 'events/stores/v1/index.json';

export interface LocatorStore {
  id: string;
  leagueId: string;
  name: string;
  address: string;
  city: string;
  region: string;
  cc: string;
  lat: number | null;
  lon: number | null;
  timeZone: string;
  nights: LeagueNight[];
  exceptions: NightException[];
}

export interface StoresIndex {
  version: 1;
  updatedAt: string;
  stores: LocatorStore[];
}
