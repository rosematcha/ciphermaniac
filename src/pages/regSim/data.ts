/**
 * The city list behind /tools/registration: every city over a million people
 * outside China, with its convention centre, time zone, and currency.
 * Researched once and served as a static file, so the route's bundle carries
 * none of it. Rates are a snapshot, not live.
 */

export interface SimCity {
  id: string;
  city: string;
  region: string | null;
  country: string;
  timezone: string;
  currency: string;
  /** Units of `currency` per US dollar, at the snapshot date. */
  rate: number;
  venue: string;
  street: string | null;
  locality: string;
  website: string | null;
}

export interface SimCities {
  version: 1;
  ratesAt: string;
  cities: SimCity[];
}

export const CITIES_PATH = '/reg-sim-cities.json';

export async function fetchSimCities(): Promise<SimCities> {
  const response = await fetch(CITIES_PATH);
  if (!response.ok) {
    throw new Error(`City list failed to load (${response.status})`);
  }
  const payload = (await response.json()) as SimCities;
  if (payload.version !== 1 || payload.cities.length === 0) {
    throw new Error('Unexpected city list format');
  }
  return payload;
}
