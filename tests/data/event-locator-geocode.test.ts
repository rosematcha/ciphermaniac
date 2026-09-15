/**
 * The Photon geocoder client and the locator's data module.
 */

/* eslint-disable camelcase -- Photon's property names are snake_case */

import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import { geocode, geocodeUrl, parseGeocode, reverseGeocode } from '../../src/lib/events/geocode.ts';
import { fetchLocatorEvents, fetchLocatorIndex } from '../../src/lib/data/eventLocator.ts';
import type { LocatorIndex } from '../../shared/events/types.ts';

afterEach(() => {
  mock.restoreAll();
});

function feature(properties: Record<string, unknown>, coordinates: unknown = [-97.7431, 30.2672]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties };
}

const AUSTIN_CITY = feature({
  name: 'Austin',
  state: 'Texas',
  country: 'United States',
  countrycode: 'US',
  type: 'city',
  osm_key: 'place',
  osm_value: 'city'
});

test('queries carry the language and a rounded position bias', () => {
  const url = new URL(geocodeUrl('round rock', { lat: 30.26721, lon: -97.74312 }));
  assert.equal(url.origin + url.pathname, 'https://photon.komoot.io/api/');
  assert.equal(url.searchParams.get('q'), 'round rock');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('lat'), '30.27');
  assert.equal(url.searchParams.get('lon'), '-97.74');
});

test('towns, postcodes, and addresses get labels a person would write', () => {
  const [city, postcode, address, milan] = parseGeocode({
    features: [
      AUSTIN_CITY,
      feature({
        name: '78704',
        city: 'Austin',
        state: 'Texas',
        country: 'United States',
        countrycode: 'US',
        type: 'other',
        osm_value: 'postcode'
      }),
      feature({
        housenumber: '1415',
        street: 'West William Cannon Drive',
        city: 'Austin',
        state: 'Texas',
        country: 'United States',
        countrycode: 'US',
        type: 'house'
      }),
      feature({ name: 'Milan', state: 'Lombardy', country: 'Italy', countrycode: 'IT', type: 'city' }, [9.19, 45.46])
    ]
  });
  assert.deepEqual(city, {
    label: 'Austin',
    detail: 'Texas, United States',
    centerLabel: 'Austin, TX',
    geoType: 'city',
    lat: 30.2672,
    lon: -97.7431,
    cc: 'US'
  });
  assert.deepEqual(
    [postcode?.label, postcode?.detail, postcode?.centerLabel, postcode?.geoType],
    ['78704', 'Austin, Texas, United States', 'Austin 78704, TX', 'postcode']
  );
  assert.deepEqual(
    [address?.label, address?.centerLabel, address?.geoType],
    ['1415 West William Cannon Drive', '1415 West William Cannon Drive, Austin', 'house']
  );
  assert.deepEqual([milan?.centerLabel, milan?.detail], ['Milan, Italy', 'Lombardy, Italy']);
});

test('malformed answers are skipped rather than thrown', () => {
  assert.deepEqual(parseGeocode(null), []);
  assert.deepEqual(parseGeocode({ features: 'nope' }), []);
  assert.deepEqual(
    parseGeocode({
      features: [
        feature({ name: 'No coordinates', countrycode: 'US', type: 'city' }, null),
        feature({ name: 'No country', type: 'city' }),
        feature({ countrycode: 'US', type: 'city' }),
        {}
      ]
    }),
    []
  );
});

test('answers are cached per query, and failures are errors', async () => {
  let calls = 0;
  const fetchStub = async () => {
    calls++;
    return new Response(JSON.stringify({ features: [AUSTIN_CITY] }), { status: 200 });
  };
  const first = await geocode('cache check austin', { fetch: fetchStub });
  const second = await geocode('cache check austin', { fetch: fetchStub });
  assert.equal(calls, 1);
  assert.equal(first, second);
  await assert.rejects(
    geocode('always failing', { fetch: async () => new Response('busy', { status: 503 }) }),
    /Geocoder answered 503/
  );
});

test('reverse geocoding names the town, or nothing', async () => {
  const answer =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status });
  const round = { lat: 30.5, lon: -97.68 };
  assert.deepEqual(
    await reverseGeocode(round, {
      fetch: answer({ features: [feature({ name: 'Main St', city: 'Round Rock', state: 'Texas', countrycode: 'US' })] })
    }),
    { label: 'Round Rock, TX', cc: 'US' }
  );
  assert.equal(await reverseGeocode(round, { fetch: answer({ features: [] }) }), null);
  assert.equal(await reverseGeocode(round, { fetch: answer({}, 500) }), null);
});

function index(cells: Record<string, number>): LocatorIndex {
  return {
    version: 1,
    generation: '20260915T100000Z',
    generatedAt: '2026-09-15T10:00:00.000Z',
    source: 'https://pokedata.ovh/events/',
    cellDegrees: 5,
    cells,
    countries: ['US'],
    kinds: { cup: 0, challenge: 1, prerelease: 0 },
    total: 1
  };
}

test('event cells are fetched only when the index lists them, and a vanished cell is an error', async () => {
  const requested: string[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(new URL(url).pathname);
    if (url.includes('/cells/10_10.json')) {
      return new Response(JSON.stringify({ version: 1, key: '10_10', generatedAt: '', events: [{ id: 'kept' }] }));
    }
    return new Response('missing', { status: 404 });
  });
  const events = await fetchLocatorEvents(index({ '10_10': 1 }), ['10_10', '10_20']);
  assert.deepEqual(
    events.map(e => e.id),
    ['kept']
  );
  await assert.rejects(fetchLocatorEvents(index({ '10_10': 1, '10_15': 1 }), ['10_15']));
  assert.ok(requested.includes('/events/v1/20260915T100000Z/cells/10_10.json'));
  assert.ok(!requested.some(path => path.includes('10_20')), 'unlisted cells are never requested');
});

test('an index in an unknown format is refused', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ version: 2 })));
  await assert.rejects(fetchLocatorIndex(), /Unexpected event index format/);
});

test('the approximate location reads as a place a person would name', async () => {
  const { approximateLabel, fetchApproximateLocation } = await import('../../src/lib/events/locate.ts');
  const base = { lat: 30.27, lon: -97.74, city: 'Austin', region: 'Texas', regionCode: 'TX', cc: 'US' };
  assert.equal(approximateLabel(base), 'Austin, TX');
  assert.equal(approximateLabel({ ...base, cc: 'IT', city: 'Milan', regionCode: null }), 'Milan, Italy');
  assert.equal(approximateLabel({ ...base, city: null, region: null }), 'United States');
  assert.equal(approximateLabel({ ...base, city: null, region: null, cc: null }), '30.27, -97.74');

  const ok = async () => new Response(JSON.stringify({ location: base }));
  assert.deepEqual(await fetchApproximateLocation(ok), base);
  assert.equal(await fetchApproximateLocation(async () => new Response('nope', { status: 404 })), null);
  assert.equal(
    await fetchApproximateLocation(async () => {
      throw new Error('offline');
    }),
    null
  );
});

test('device location failures come back as a reason the page can explain', async () => {
  const { deviceLocation } = await import('../../src/lib/events/locate.ts');
  await assert.rejects(
    deviceLocation(undefined),
    (error: unknown) => (error as { reason?: string }).reason === 'unsupported'
  );
  const failing = (code: number) =>
    ({
      getCurrentPosition: (_ok: unknown, fail: (e: { code: number; PERMISSION_DENIED: number }) => void) =>
        fail({ code, PERMISSION_DENIED: 1 })
    }) as unknown as Geolocation;
  await assert.rejects(
    deviceLocation(failing(1)),
    (error: unknown) => (error as { reason?: string }).reason === 'denied'
  );
  await assert.rejects(
    deviceLocation(failing(3)),
    (error: unknown) => (error as { reason?: string }).reason === 'unavailable'
  );
  const working = {
    getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
      ok({ coords: { latitude: 1.5, longitude: 2.5 } })
  } as unknown as Geolocation;
  assert.deepEqual(await deviceLocation(working), { lat: 1.5, lon: 2.5 });
});
