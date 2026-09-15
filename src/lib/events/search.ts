/**
 * Place search for the locator: ranking suggestions from the listing's own
 * cities and stores, merged with a geocoder's answers.
 *
 * Local matches come first because they are instant, work offline, and can
 * say something useful ("12 events", "Next Sat, Sep 19"). The geocoder covers
 * everything else — postcodes, addresses, towns with no events yet — and is
 * filtered hard, because its raw answers for a short query are mostly streets
 * and landmarks that happen to share a word.
 * @module lib/events/search
 */

import type { LocatorCity, LocatorPlaces, LocatorVenue } from '../../../shared/events/types';
import { distanceKm, type LatLon } from './geo';
import { countryName, titleCase, usStateCode } from './format';
import type { GeocodedPlace } from './geocode';

export type SuggestionKind = 'city' | 'venue' | 'geocoded';

export interface PlaceSuggestion {
  id: string;
  kind: SuggestionKind;
  /** Primary line. */
  label: string;
  /** Secondary line: region and country, or the store's town. */
  detail: string;
  /** What the page calls the place once chosen: "Austin, TX", "Milan, Italy". */
  centerLabel: string;
  lat: number;
  lon: number;
  cc: string;
  /** Cities: upcoming events listed there. */
  count?: number;
  /** Stores: date of the next listed event. */
  next?: string;
  /** Stores: the listing's store name, for jumping to its events. */
  shop?: string;
  /** Geocoded: the geocoder's place type. */
  geoType?: string;
}

export interface SuggestionSection {
  title: 'Places' | 'Venues';
  items: PlaceSuggestion[];
}

interface Indexed<T> {
  item: T;
  key: string;
}

export interface PlaceSearchIndex {
  cities: Indexed<LocatorCity>[];
  venues: Indexed<LocatorVenue>[];
}

const MAX_CITIES = 3;
const MAX_VENUES = 4;
const MAX_PLACES = 6;
const SAME_PLACE_KM = 25;
/** Geocoder types worth offering for a plain-word query. */
const PLACE_TYPES = new Set(['city', 'district', 'locality', 'county', 'postcode']);
/** Added once the query contains a digit, i.e. looks like an address. */
const ADDRESS_TYPES = new Set(['street', 'house']);

/** Lower case, accents and punctuation variants folded, spaces collapsed. */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * 4 exact, 3 prefix, 2 word prefix, 1 substring, summed over the query's
 * words. Zero if any word matches nowhere.
 */
export function matchScore(key: string, query: string): number {
  let total = 0;
  const words = key.split(/[\s\-'./]+/);
  for (const term of query.split(' ').filter(Boolean)) {
    const score =
      key === term
        ? 4
        : key.startsWith(term)
          ? 3
          : words.some(w => w.startsWith(term))
            ? 2
            : key.includes(term)
              ? 1
              : 0;
    if (!score) {
      return 0;
    }
    total += score;
  }
  return total;
}

export function buildSearchIndex(places: LocatorPlaces): PlaceSearchIndex {
  return {
    cities: places.cities.map(item => ({ item, key: fold(item.name) })),
    venues: places.venues.map(item => ({ item, key: fold(item.shop) }))
  };
}

/** "Austin, TX" in the US; "Milan, Italy" everywhere else. */
export function shortPlace(name: string, region: string, cc: string): string {
  const place = titleCase(name);
  if (cc === 'US') {
    return `${place}, ${usStateCode(region) ?? 'US'}`;
  }
  return `${place}, ${countryName(cc)}`;
}

function regionAndCountry(region: string, cc: string): string {
  const country = countryName(cc);
  const readable = titleCase(region);
  return readable && fold(readable) !== fold(country) ? `${readable}, ${country}` : country;
}

export function citySuggestion(city: LocatorCity): PlaceSuggestion {
  return {
    id: `city:${city.cc}:${fold(city.region)}:${fold(city.name)}`,
    kind: 'city',
    label: titleCase(city.name),
    detail: regionAndCountry(city.region, city.cc),
    centerLabel: shortPlace(city.name, city.region, city.cc),
    lat: city.lat,
    lon: city.lon,
    cc: city.cc,
    count: city.count
  };
}

export function venueSuggestion(venue: LocatorVenue): PlaceSuggestion {
  const shop = titleCase(venue.shop);
  return {
    id: `venue:${venue.cc}:${venue.lat.toFixed(3)}:${venue.lon.toFixed(3)}:${fold(venue.shop)}`,
    kind: 'venue',
    label: shop,
    detail: shortPlace(venue.city, venue.region, venue.cc),
    centerLabel: `${shop}, ${titleCase(venue.city)}`,
    lat: venue.lat,
    lon: venue.lon,
    cc: venue.cc,
    next: venue.next,
    shop: venue.shop
  };
}

export function geocodedSuggestion(place: GeocodedPlace): PlaceSuggestion {
  return {
    id: `geo:${place.lat.toFixed(4)}:${place.lon.toFixed(4)}:${fold(place.label)}`,
    kind: 'geocoded',
    label: place.label,
    detail: place.detail,
    centerLabel: place.centerLabel,
    lat: place.lat,
    lon: place.lon,
    cc: place.cc,
    geoType: place.geoType
  };
}

/** The listing's own cities and stores matching a query. */
export function localMatches(
  index: PlaceSearchIndex,
  query: string,
  near: LatLon
): { cities: PlaceSuggestion[]; venues: PlaceSuggestion[] } {
  const q = fold(query);
  const cities = index.cities
    .map(entry => ({ entry, score: matchScore(entry.key, q) }))
    .filter(r => r.score >= 2)
    .sort((a, b) => b.score - a.score || b.entry.item.count - a.entry.item.count)
    .slice(0, MAX_CITIES)
    .map(r => citySuggestion(r.entry.item));
  // A one- or two-letter query matching mid-word is noise.
  const minimum = q.length >= 3 ? 1 : 2;
  const venues = index.venues
    .map(entry => ({ entry, score: matchScore(entry.key, q) }))
    .filter(r => r.score >= minimum)
    .sort((a, b) => b.score - a.score || distanceKm(near, a.entry.item) - distanceKm(near, b.entry.item))
    .slice(0, MAX_VENUES)
    .map(r => venueSuggestion(r.entry.item));
  return { cities, venues };
}

export interface MergeInput {
  query: string;
  cities: PlaceSuggestion[];
  venues: PlaceSuggestion[];
  geocoded: PlaceSuggestion[];
  /** Countries the listing has events in. */
  countries: ReadonlySet<string>;
  /** Country of the current search centre, which a bare postcode most likely means. */
  currentCountry: string | null;
}

function isPostcodeLike(query: string): boolean {
  return /^[\d\s-]{3,}$|^[a-z]{1,2}\d/i.test(query.trim());
}

/** Geocoder answers worth showing, in a trustworthy order. */
function usefulGeocoded(input: MergeInput, q: string): PlaceSuggestion[] {
  const allowed = /\d/.test(q) ? new Set([...PLACE_TYPES, ...ADDRESS_TYPES]) : PLACE_TYPES;
  const postcode = isPostcodeLike(q);
  const rank = (s: PlaceSuggestion) =>
    (input.countries.has(s.cc) ? 0 : 2) + (postcode && s.cc !== input.currentCountry ? 1 : 0);
  return input.geocoded
    .filter(s => allowed.has(s.geoType ?? ''))
    .filter(s => !input.cities.some(c => fold(c.label) === fold(s.label) && distanceKm(c, s) < SAME_PLACE_KM))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(r => r.s);
}

/** A geocoded hit that is not a town or postcode has to beat a store by more than a tie. */
function placeScore(s: PlaceSuggestion, q: string): number {
  const penalty = s.kind === 'geocoded' && s.geoType !== 'city' && s.geoType !== 'postcode' ? 1.5 : 0;
  return matchScore(fold(s.label), q) - penalty;
}

function rankPlaces(input: MergeInput, q: string): PlaceSuggestion[] {
  const seen = new Set<string>();
  const ranked = [...input.cities, ...usefulGeocoded(input, q)]
    .filter(s => {
      const key = `${fold(s.label)}|${fold(s.detail)}`;
      return !seen.has(key) && Boolean(seen.add(key));
    })
    .map((s, i) => ({ s, i, score: placeScore(s, q) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  // Once something solid matches in a country with events, drop the long
  // tail: the same postcode in other countries, fuzzy partial hits.
  const solid = ranked.some(r => r.score >= 3 && input.countries.has(r.s.cc));
  return ranked
    .filter(r => !solid || (r.score > 0 && input.countries.has(r.s.cc)))
    .map(r => r.s)
    .slice(0, MAX_PLACES);
}

/**
 * Merge local and geocoded suggestions into sections. Venues lead when a store
 * name matches better than any place does, so typing a shop's name finds the
 * shop, not a street named after the same word.
 */
export function mergeSuggestions(input: MergeInput): SuggestionSection[] {
  const q = fold(input.query);
  const places = rankPlaces(input, q);
  const best = (items: PlaceSuggestion[], score: (s: PlaceSuggestion) => number) => Math.max(0, ...items.map(score));
  const venuesFirst = best(input.venues, s => matchScore(fold(s.label), q)) > best(places, s => placeScore(s, q));
  const sections: SuggestionSection[] = [];
  if (places.length) {
    sections.push({ title: 'Places', items: places });
  }
  if (input.venues.length) {
    sections.push({ title: 'Venues', items: input.venues });
  }
  return venuesFirst ? sections.reverse() : sections;
}

/** The busiest listed cities near a point, for the empty search box. */
export function busiestNearby(
  index: PlaceSearchIndex,
  near: LatLon,
  excludeLabel: string,
  limit = 4
): PlaceSuggestion[] {
  return index.cities
    .filter(entry => distanceKm(near, entry.item) < 240)
    .sort((a, b) => b.item.count - a.item.count)
    .map(entry => citySuggestion(entry.item))
    .filter(s => s.centerLabel !== excludeLabel)
    .slice(0, limit);
}
