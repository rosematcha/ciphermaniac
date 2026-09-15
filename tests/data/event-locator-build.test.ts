/* eslint-disable camelcase -- Pokedata's API field names are snake_case; the fixtures mirror them exactly */

/**
 * Building the locator artifacts from normalized listings.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLocatorArtifacts, MIN_SHARE_OF_PREVIOUS, shrinkProblem } from '../../shared/events/build.ts';
import { rawEvent, rawEventWithId } from '../__utils__/pokedata.ts';

const NOW = new Date('2026-09-15T12:00:00Z');
const SOURCE = 'https://pokedata.ovh/events/';

function build(raw: unknown[]) {
  return buildLocatorArtifacts(raw, { now: NOW, source: SOURCE });
}

test('events are sharded into cells and counted in the index', () => {
  const { index, cells } = build([
    rawEventWithId(1),
    rawEventWithId(2, { type: 'League Challenge', date: '2026-09-16' }),
    rawEventWithId(3, { latitude: '51.5074', longitude: '-0.1278', country_code: 'GB', city: 'London', state: '' })
  ]);
  assert.deepEqual(index.cells, { '30_-100': 2, '50_-5': 1 });
  assert.deepEqual([...cells.keys()], ['30_-100', '50_-5']);
  assert.equal(index.total, 3);
  assert.deepEqual(index.kinds, { cup: 2, challenge: 1, prerelease: 0 });
  assert.deepEqual(index.countries, ['GB', 'US']);
  assert.equal(index.version, 1);
  assert.equal(index.generation, '20260915T120000Z');
  assert.equal(index.cellDegrees, 5);
  assert.equal(index.generatedAt, NOW.toISOString());
  assert.equal(index.source, SOURCE);
});

test('each cell lists its events by date, then time, then ID', () => {
  const { cells } = build([
    rawEventWithId(3, { date: '2026-09-20', time: '11:00:00' }),
    rawEventWithId(1, { date: '2026-09-20', time: '11:00:00' }),
    rawEventWithId(2, { date: '2026-09-20', time: '09:30:00' }),
    rawEventWithId(4, { date: '2026-09-17', time: '19:00:00' })
  ]);
  const ids = cells.get('30_-100')?.events.map(event => event.id);
  assert.deepEqual(ids, ['26-09-000004', '26-09-000002', '26-09-000001', '26-09-000003']);
});

test('listings older than yesterday (UTC) are dropped; yesterday is kept for western time zones', () => {
  const { index, stats } = build([
    rawEventWithId(1, { date: '2026-09-13' }),
    rawEventWithId(2, { date: '2026-09-14' }),
    rawEventWithId(3, { date: '2026-09-15' })
  ]);
  assert.equal(index.total, 2);
  assert.equal(stats.past, 1);
});

test('a listing that appears on two pages is kept once, the later copy winning', () => {
  const { index, cells, stats } = build([rawEvent({ name: 'First copy' }), rawEvent({ name: 'Moved copy' })]);
  assert.equal(index.total, 1);
  assert.equal(stats.duplicates, 1);
  assert.equal(cells.get('30_-100')?.events[0]?.name, 'Moved copy');
});

test('build stats account for every record received', () => {
  const { stats } = build([
    rawEventWithId(1),
    rawEventWithId(2, { type: 'nonpremier TCG' }),
    rawEventWithId(3, { latitude: '0', longitude: '0' }),
    null,
    'garbage'
  ]);
  assert.equal(stats.received, 5);
  assert.equal(stats.kept, 1);
  assert.deepEqual(stats.skipped, { kind: 3, coordinates: 1 });
});

test('cities are grouped case- and accent-insensitively with a centroid and a count', () => {
  const { places } = build([
    rawEventWithId(1, { city: 'São Paulo', state: 'SP', country_code: 'BR', latitude: '-23.5', longitude: '-46.6' }),
    rawEventWithId(2, { city: 'SAO PAULO', state: 'sp', country_code: 'BR', latitude: '-23.7', longitude: '-46.8' }),
    rawEventWithId(3)
  ]);
  const saoPaulo = places.cities.find(city => city.cc === 'BR');
  assert.deepEqual(saoPaulo, { name: 'São Paulo', region: 'SP', cc: 'BR', lat: -23.6, lon: -46.7, count: 2 });
  assert.equal(places.cities[0]?.cc, 'BR', 'busiest city first');
});

test('a city straddling the antimeridian keeps its centre there', () => {
  const { places } = build([
    rawEventWithId(1, { city: 'Taveuni', state: '', country_code: 'FJ', latitude: '-16.8', longitude: '179.9' }),
    rawEventWithId(2, { city: 'Taveuni', state: '', country_code: 'FJ', latitude: '-16.8', longitude: '-179.9' })
  ]);
  assert.equal(Math.abs(places.cities[0]?.lon ?? 0), 180);
});

test('stores are keyed by name and position, so a chain branch in another town stays separate', () => {
  const { places } = build([
    rawEventWithId(1, { date: '2026-10-01' }),
    rawEventWithId(2, { date: '2026-09-20' }),
    rawEventWithId(3, { latitude: '29.7604', longitude: '-95.3698', city: 'Houston' })
  ]);
  assert.equal(places.venues.length, 2);
  const austin = places.venues.find(venue => venue.city === 'Austin');
  assert.equal(austin?.count, 2);
  assert.equal(austin?.next, '2026-09-20', 'next is the earliest upcoming date');
});

test('records without a city or store name stay out of the place list but stay on the map', () => {
  const { index, places } = build([rawEventWithId(1, { city: '', shop: '' })]);
  assert.equal(index.total, 1);
  assert.deepEqual(places.cities, []);
  assert.deepEqual(places.venues, []);
});

test('the shrink guard refuses an empty generation and a collapse, not ordinary churn', () => {
  assert.equal(shrinkProblem(null, 5000), null);
  assert.equal(shrinkProblem(10000, 9500), null);
  assert.equal(shrinkProblem(10000, 10000 * MIN_SHARE_OF_PREVIOUS), null);
  assert.match(shrinkProblem(10000, 5000) ?? '', /5000 events, under 60% of the 10000/);
  assert.match(shrinkProblem(null, 0) ?? '', /no events/);
  assert.match(shrinkProblem(10000, 0) ?? '', /no events/);
});
