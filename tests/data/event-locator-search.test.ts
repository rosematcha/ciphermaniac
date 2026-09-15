/**
 * Place search ranking.
 *
 * The scenarios are the ones the design drafts ran against real data and the
 * real geocoder: a shop name that is also a street, a city in a country with
 * no events, a bare postcode that exists in several countries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { LocatorPlaces } from '../../shared/events/types.ts';
import {
  buildSearchIndex,
  busiestNearby,
  citySuggestion,
  fold,
  localMatches,
  matchScore,
  type MergeInput,
  mergeSuggestions,
  type PlaceSuggestion,
  shortPlace
} from '../../src/lib/events/search.ts';

const AUSTIN = { lat: 30.2672, lon: -97.7431 };

const PLACES: LocatorPlaces = {
  version: 1,
  generatedAt: '2026-09-15T10:00:00.000Z',
  cities: [
    { name: 'Austin', region: 'Texas', cc: 'US', lat: 30.27, lon: -97.74, count: 15 },
    { name: 'Houston', region: 'Texas', cc: 'US', lat: 29.76, lon: -95.37, count: 54 },
    { name: 'St. Austell', region: 'England', cc: 'GB', lat: 50.34, lon: -4.79, count: 8 },
    { name: 'Round Rock', region: 'Texas', cc: 'US', lat: 30.51, lon: -97.68, count: 6 },
    { name: 'Milano', region: 'Lombardia', cc: 'IT', lat: 45.46, lon: 9.19, count: 40 }
  ],
  venues: [
    {
      shop: "DRAGON'S LAIR AUSTIN",
      city: 'Austin',
      region: 'Texas',
      cc: 'US',
      lat: 30.36,
      lon: -97.73,
      count: 3,
      next: '2026-09-27'
    },
    {
      shop: "DRAGON'S LAIR COMIC AND FANTASY",
      city: 'Houston',
      region: 'Texas',
      cc: 'US',
      lat: 29.9,
      lon: -95.5,
      count: 2,
      next: '2026-10-15'
    },
    {
      shop: 'TOKYO TOYBOX',
      city: 'Hendersonville',
      region: 'North Carolina',
      cc: 'US',
      lat: 35.3,
      lon: -82.4,
      count: 1,
      next: '2026-10-04'
    },
    {
      shop: 'CARD TRADERS OF AUSTIN',
      city: 'Austin',
      region: 'Texas',
      cc: 'US',
      lat: 30.4,
      lon: -97.75,
      count: 2,
      next: '2026-09-21'
    }
  ]
};

const INDEX = buildSearchIndex(PLACES);
const COUNTRIES = new Set(['US', 'GB', 'IT', 'CZ']);

function geocoded(label: string, geoType: string, cc: string, lat = 30, lon = -97, detail = ''): PlaceSuggestion {
  return { id: `geo:${label}:${cc}`, kind: 'geocoded', label, detail, centerLabel: label, lat, lon, cc, geoType };
}

function merge(query: string, geocodedResults: PlaceSuggestion[] = [], currentCountry = 'US') {
  const { cities, venues } = localMatches(INDEX, query, AUSTIN);
  const input: MergeInput = { query, cities, venues, geocoded: geocodedResults, countries: COUNTRIES, currentCountry };
  return mergeSuggestions(input).map(section => [section.title, section.items.map(item => item.label)]);
}

test('folding ignores case, accents, and apostrophe styles', () => {
  assert.equal(fold('  São   PAULO '), 'sao paulo');
  assert.equal(fold('Dragon’s'), "dragon's");
});

test('match scores: exact, prefix, word prefix, substring, and every word must land', () => {
  assert.equal(matchScore('austin', 'austin'), 4);
  assert.equal(matchScore('austin', 'aus'), 3);
  assert.equal(matchScore("dragon's lair austin", 'lair'), 2);
  assert.equal(matchScore('card traders', 'rade'), 1);
  assert.equal(matchScore("dragon's lair austin", 'dragon austin'), 5);
  assert.equal(matchScore("dragon's lair austin", 'dragon houston'), 0);
});

test('a city prefix finds the city first and matching stores after', () => {
  assert.deepEqual(merge('aus'), [
    ['Places', ['Austin', 'St. Austell']],
    ['Venues', ["Dragon's Lair Austin", 'Card Traders of Austin']]
  ]);
});

test('a store name beats a street or landmark with the same word', () => {
  const noise = [geocoded('Dragon', 'locality', 'US'), geocoded('Dragon Stadium', 'other', 'US')];
  assert.deepEqual(merge('dragon', noise), [
    ['Venues', ["Dragon's Lair Austin", "Dragon's Lair Comic and Fantasy"]],
    ['Places', ['Dragon']]
  ]);
});

test('a real city leads even in a country with no listed events', () => {
  const results = [geocoded('Tokyo', 'city', 'JP', 35.68, 139.69, 'Japan'), geocoded('Tokyo Electron', 'other', 'US')];
  assert.deepEqual(merge('tokyo', results), [
    ['Places', ['Tokyo']],
    ['Venues', ['Tokyo Toybox']]
  ]);
});

test('a bare postcode resolves to the current country and drops the same code abroad', () => {
  const results = [
    geocoded('78704', 'postcode', 'UA', 48.2, 24.7),
    geocoded('78704', 'postcode', 'US', 30.24, -97.77),
    geocoded('787 04', 'postcode', 'CZ', 49.97, 16.95),
    geocoded('787-0451', 'postcode', 'JP', 32.8, 132.9)
  ];
  const sections = mergeSuggestions({
    query: '78704',
    cities: [],
    venues: [],
    geocoded: results,
    countries: COUNTRIES,
    currentCountry: 'US'
  });
  assert.equal(sections.length, 1);
  assert.deepEqual(
    sections[0]?.items.map(item => item.cc),
    ['US']
  );
});

test('streets appear only once the query looks like an address', () => {
  const street = geocoded('1415 West William Cannon Drive', 'street', 'US');
  assert.deepEqual(merge('west william', [street]), []);
  assert.deepEqual(merge('1415 west william', [street]), [['Places', ['1415 West William Cannon Drive']]]);
});

test('a geocoded copy of a listed city is folded into the listed one', () => {
  // Store matching is by store name, so the Houston store does not answer "houston".
  assert.deepEqual(merge('houston', [geocoded('Houston', 'city', 'US', 29.76, -95.37)]), [['Places', ['Houston']]]);
});

test('place labels are short in the US and name the country elsewhere', () => {
  assert.equal(shortPlace('AUSTIN', 'Texas', 'US'), 'Austin, TX');
  assert.equal(shortPlace('Milano', 'Lombardia', 'IT'), 'Milano, Italy');
  const milano = citySuggestion(PLACES.cities[4]!);
  assert.equal(milano.detail, 'Lombardia, Italy');
  assert.equal(milano.count, 40);
  assert.equal(citySuggestion({ ...PLACES.cities[4]!, region: '' }).detail, 'Italy');
});

test('the empty box offers the busiest nearby cities, not the one already chosen', () => {
  assert.deepEqual(
    busiestNearby(INDEX, AUSTIN, 'Austin, TX').map(s => s.label),
    ['Houston', 'Round Rock']
  );
});
