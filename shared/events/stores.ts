/**
 * Stores that run their events on Ciphermaniac, as the event locator reads
 * them (functions/lib/stores/publish.ts writes the file): where each is, and
 * its own league nights, which stand in for what Pokedata lists for the same
 * league. Types and the key only.
 * @module shared/events/stores
 */

import type { LeagueNight, NightException } from '../accounts/stores';

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
