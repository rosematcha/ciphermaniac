/**
 * Grid sharding for the event locator.
 *
 * The property that matters: every point inside a search circle falls in a
 * cell `cellsForCircle` returned. A miss there silently drops real events off
 * the map, so it is checked by walking points around circles at the equator,
 * mid-latitudes, near a pole, and across the antimeridian.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CELL_DEGREES, cellKeyFor, cellsForCircle, wrapLongitude } from '../../shared/events/cells.ts';

const EARTH_RADIUS_KM = 6371.0088;

/** The point `km` from (lat, lon) along an initial bearing, on a sphere. */
function destination(lat: number, lon: number, km: number, bearing: number): [number, number] {
  const toRad = Math.PI / 180;
  const angular = km / EARTH_RADIUS_KM;
  const theta = bearing * toRad;
  const phi1 = lat * toRad;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
  const lambda2 =
    lon * toRad +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
      Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2)
    );
  return [phi2 / toRad, lambda2 / toRad];
}

test('cell keys name the south-west corner of a five-degree cell', () => {
  assert.equal(CELL_DEGREES, 5);
  assert.equal(cellKeyFor(30.2672, -97.7431), '30_-100');
  assert.equal(cellKeyFor(-23.55, -46.63), '-25_-50');
  assert.equal(cellKeyFor(51.5074, -0.1278), '50_-5');
  assert.equal(cellKeyFor(0, 0), '0_0');
  assert.equal(cellKeyFor(-0.0001, -0.0001), '-5_-5');
});

test('cell keys fold longitude and clamp latitude, and never say -0', () => {
  assert.equal(cellKeyFor(10, 180), '10_-180');
  assert.equal(cellKeyFor(10, -180), '10_-180');
  assert.equal(cellKeyFor(10, 365), '10_5');
  assert.equal(cellKeyFor(90, 0), '85_0');
  assert.equal(cellKeyFor(-90, 0), '-90_0');
  assert.equal(cellKeyFor(-0, -0), '0_0');
  assert.equal(wrapLongitude(190), -170);
  assert.equal(wrapLongitude(-190), 170);
});

test('a small circle well inside one cell needs only that cell', () => {
  assert.deepEqual(cellsForCircle(32.5, -97.5, 10), ['30_-100']);
});

test('circle cells are sorted and unique', () => {
  const cells = cellsForCircle(30.2672, -97.7431, 402);
  assert.deepEqual(cells, [...new Set(cells)].sort());
});

const CIRCLES: Array<{ name: string; lat: number; lon: number; km: number }> = [
  { name: 'Austin, 250 mi', lat: 30.2672, lon: -97.7431, km: 402.3 },
  { name: 'London, 100 km', lat: 51.5074, lon: -0.1278, km: 100 },
  { name: 'Quito on the equator, 50 km', lat: -0.1807, lon: -78.4678, km: 50 },
  { name: 'Reykjavik, 250 mi', lat: 64.1466, lon: -21.9426, km: 402.3 },
  { name: 'Fiji across the antimeridian, 300 km', lat: -17.7134, lon: 179.5, km: 300 },
  { name: 'Over the North Pole, 300 km', lat: 88, lon: 10, km: 300 },
  { name: 'Just short of the North Pole, 250 km', lat: 87, lon: -40, km: 250 },
  { name: 'Over the South Pole, 300 km', lat: -88.5, lon: 120, km: 300 },
  { name: 'Cell corner exactly, 5 km', lat: 30, lon: -100, km: 5 }
];

for (const circle of CIRCLES) {
  test(`every point inside the circle lands in a returned cell: ${circle.name}`, () => {
    const cells = new Set(cellsForCircle(circle.lat, circle.lon, circle.km));
    const misses: string[] = [];
    for (let bearing = 0; bearing < 360; bearing += 5) {
      for (const share of [0, 0.25, 0.5, 0.75, 0.99]) {
        const [lat, lon] = destination(circle.lat, circle.lon, circle.km * share, bearing);
        const key = cellKeyFor(lat, lon);
        if (!cells.has(key)) {
          misses.push(`${lat.toFixed(3)},${lon.toFixed(3)} -> ${key}`);
        }
      }
    }
    assert.deepEqual(misses, []);
  });
}
