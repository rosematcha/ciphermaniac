/**
 * Geocoding through Photon (https://photon.komoot.io), an OpenStreetMap
 * geocoder with a free public API and CORS open.
 *
 * Photon asks public users to be fair, so the caller debounces, this module
 * caches, and superseded requests are aborted. It is the only module that
 * knows the provider: swapping to a self-hosted Photon or a paid geocoder
 * means changing this file.
 * @module lib/events/geocode
 */

import type { LatLon } from './geo';
import { countryName, usStateCode } from './format';

export const PHOTON_ORIGIN = 'https://photon.komoot.io';

export interface GeocodedPlace {
  label: string;
  detail: string;
  centerLabel: string;
  lat: number;
  lon: number;
  cc: string;
  /** Photon's type (`city`, `street`, …), or `postcode`. */
  geoType: string;
}

export interface ReversePlace {
  label: string;
  cc: string | null;
}

interface PhotonProperties {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  type?: string;
  osm_value?: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: PhotonProperties;
}

export interface GeocodeOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  bias?: LatLon;
}

const CACHE_LIMIT = 60;
const cache = new Map<string, GeocodedPlace[]>();

export function geocodeUrl(query: string, bias?: LatLon): string {
  const params = new URLSearchParams({ q: query, limit: '10', lang: 'en' });
  if (bias) {
    // Bias only nudges ranking; ~1 km is plenty and keeps a device fix coarse.
    params.set('lat', bias.lat.toFixed(2));
    params.set('lon', bias.lon.toFixed(2));
  }
  return `${PHOTON_ORIGIN}/api/?${params}`;
}

export function reverseUrl(point: LatLon): string {
  // A town name needs no more than ~100 m, and this goes to a third party.
  const params = new URLSearchParams({ lat: point.lat.toFixed(3), lon: point.lon.toFixed(3), lang: 'en' });
  return `${PHOTON_ORIGIN}/reverse?${params}`;
}

function coordinatesOf(feature: PhotonFeature): LatLon | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }
  const [lon, lat] = coords.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: lat as number, lon: lon as number } : null;
}

function townOf(p: PhotonProperties): string | undefined {
  return p.city ?? p.town ?? p.village ?? p.district ?? p.county;
}

/** "TX" in the US, the country name elsewhere: what follows a town in a short label. */
function shortRegion(p: PhotonProperties, cc: string): string {
  if (cc === 'US') {
    return (p.state && usStateCode(p.state)) ?? 'US';
  }
  return p.country ?? countryName(cc);
}

function describePostcode(p: PhotonProperties, cc: string, country: string): Described {
  const town = townOf(p);
  const label = p.name ?? p.postcode ?? '';
  return {
    label,
    detail: [town, p.state, country].filter(Boolean).join(', '),
    centerLabel: `${[town, label].filter(Boolean).join(' ')}, ${shortRegion(p, cc)}`,
    geoType: 'postcode'
  };
}

const TOWN_TYPES = new Set(['city', 'district', 'locality', 'county']);

function describeTown(p: PhotonProperties, cc: string, country: string): Described {
  const label = p.name ?? '';
  return {
    label,
    detail: [p.state !== label ? p.state : undefined, country].filter(Boolean).join(', '),
    centerLabel: `${label}, ${shortRegion(p, cc)}`,
    geoType: p.type ?? 'city'
  };
}

function describeAddress(p: PhotonProperties, cc: string, country: string): Described {
  const town = townOf(p);
  const label = (p.street && p.housenumber ? `${p.housenumber} ${p.street}` : undefined) ?? p.name ?? p.street ?? '';
  return {
    label,
    detail: [town, p.state, country].filter(Boolean).join(', '),
    centerLabel: town ? `${label}, ${town}` : `${label}, ${shortRegion(p, cc)}`,
    geoType: p.type ?? 'other'
  };
}

type Described = Pick<GeocodedPlace, 'label' | 'detail' | 'centerLabel' | 'geoType'>;

function describe(p: PhotonProperties, cc: string): Described {
  const country = cc === 'US' ? 'United States' : (p.country ?? countryName(cc));
  if (p.osm_value === 'postcode') {
    return describePostcode(p, cc, country);
  }
  return TOWN_TYPES.has(p.type ?? '') ? describeTown(p, cc, country) : describeAddress(p, cc, country);
}

/** Photon's FeatureCollection → places. Anything malformed is skipped, not thrown. */
export function parseGeocode(json: unknown): GeocodedPlace[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    return [];
  }
  const places: GeocodedPlace[] = [];
  for (const feature of features as PhotonFeature[]) {
    const point = coordinatesOf(feature);
    const p = feature.properties ?? {};
    const cc = (p.countrycode ?? '').toUpperCase();
    if (!point || !/^[A-Z]{2}$/.test(cc)) {
      continue;
    }
    const described = describe(p, cc);
    if (described.label) {
      places.push({ ...described, ...point, cc });
    }
  }
  return places;
}

/** Places matching a query, cached per query and bias. */
export async function geocode(query: string, options: GeocodeOptions = {}): Promise<GeocodedPlace[]> {
  const url = geocodeUrl(query.trim(), options.bias);
  const hit = cache.get(url);
  if (hit) {
    return hit;
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Geocoder answered ${response.status}`);
  }
  const places = parseGeocode(await response.json());
  cache.set(url, places);
  if (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string);
  }
  return places;
}

/** The first reverse-geocoded feature as a short name, or null. */
export function parseReverse(json: unknown): ReversePlace | null {
  const features = (json as { features?: unknown })?.features;
  const p = Array.isArray(features) ? (features[0] as PhotonFeature | undefined)?.properties : undefined;
  const cc = p?.countrycode?.toUpperCase();
  const town = p && (townOf(p) ?? p.name);
  if (!p || !town || !cc) {
    return null;
  }
  return { label: `${town}, ${shortRegion(p, cc)}`, cc };
}

/** A short name for a point ("Round Rock, TX"), or null when the geocoder has none. */
export async function reverseGeocode(point: LatLon, options: GeocodeOptions = {}): Promise<ReversePlace | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(reverseUrl(point), { signal: options.signal });
  return response.ok ? parseReverse(await response.json()) : null;
}
