/**
 * GET /api/locate: the visitor's approximate location from Cloudflare's IP
 * geolocation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { approximateLocation, type CfLocation, onRequestGet } from '../../functions/api/locate.ts';

function request(cf?: CfLocation): Request & { cf?: CfLocation } {
  return Object.assign(new Request('https://ciphermaniac.test/api/locate'), { cf });
}

const AUSTIN: CfLocation = {
  latitude: '30.26715',
  longitude: '-97.74306',
  city: 'Austin',
  region: 'Texas',
  regionCode: 'TX',
  country: 'US'
};

test('the edge location comes back rounded to about a kilometre', () => {
  assert.deepEqual(approximateLocation(AUSTIN), {
    lat: 30.27,
    lon: -97.74,
    city: 'Austin',
    region: 'Texas',
    regionCode: 'TX',
    cc: 'US'
  });
});

test('missing or impossible coordinates mean no location', () => {
  assert.equal(approximateLocation(undefined), null);
  assert.equal(approximateLocation({}), null);
  assert.equal(approximateLocation({ latitude: '0', longitude: '0' }), null);
  assert.equal(approximateLocation({ latitude: '95', longitude: '10' }), null);
  assert.equal(approximateLocation({ latitude: 'north', longitude: '10' }), null);
  assert.equal(approximateLocation({ latitude: {}, longitude: [] }), null);
});

test('optional fields are null when absent, and unknown countries are dropped', () => {
  assert.deepEqual(approximateLocation({ latitude: 51.5, longitude: -0.12, city: '  ', country: 'XX' }), {
    lat: 51.5,
    lon: -0.12,
    city: null,
    region: null,
    regionCode: null,
    cc: null
  });
  assert.equal(approximateLocation({ ...AUSTIN, country: 'T1' })?.cc, null);
  assert.equal(approximateLocation({ ...AUSTIN, country: 'usa' })?.cc, null);
});

test('the response is private, uncached, and not shared cross-origin', async () => {
  const response = await onRequestGet({ request: request(AUSTIN) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual(((await response.json()) as { location: { city: string } }).location.city, 'Austin');
});

test('with no edge data the endpoint answers a null location, not an error', async () => {
  const response = await onRequestGet({ request: request() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { location: null });
});
