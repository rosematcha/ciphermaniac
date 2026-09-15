/**
 * Distances and units for the event locator.
 * @module lib/events/geo
 */

export type DistanceUnit = 'mi' | 'km';

export interface LatLon {
  lat: number;
  lon: number;
}

export const KM_PER_MILE = 1.609344;
const EARTH_RADIUS_KM = 6371.0088;

/** Countries whose road signs are in miles. Everywhere else reads kilometres. */
const MILE_COUNTRIES = new Set(['US', 'GB', 'GG', 'IM', 'JE', 'LR', 'MM']);

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The unit a visitor in this country expects. Unknown countries get kilometres. */
export function unitForCountry(cc: string | null | undefined): DistanceUnit {
  return cc && MILE_COUNTRIES.has(cc.toUpperCase()) ? 'mi' : 'km';
}

export function toKm(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * KM_PER_MILE : value;
}

export function fromKm(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? km / KM_PER_MILE : km;
}

/** "12 mi", "<1 km". */
export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = fromKm(km, unit);
  return value < 1 ? `<1 ${unit}` : `${Math.round(value)} ${unit}`;
}
