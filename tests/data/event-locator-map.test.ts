/**
 * Distances, units, and the map's Web Mercator math.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { distanceKm, formatDistance, fromKm, toKm, unitForCountry } from '../../src/lib/events/geo.ts';
import {
  fitCircle,
  fromScreen,
  kmPerPixel,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestWithin,
  panBy,
  project,
  stepZoom,
  tileLevel,
  toScreen,
  unproject,
  visibleTiles,
  zoomAround
} from '../../src/lib/events/mercator.ts';

const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const HOUSTON = { lat: 29.7604, lon: -95.3698 };
const SIZE = { width: 500, height: 700 };

function near(actual: number, expected: number, tolerance: number, what = 'value') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} not within ${tolerance} of ${expected}`);
}

test('great-circle distances match known city pairs', () => {
  near(distanceKm(AUSTIN, HOUSTON), 235, 3, 'Austin to Houston');
  near(distanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 }), 344, 3, 'London to Paris');
  assert.equal(distanceKm(AUSTIN, AUSTIN), 0);
});

test('units follow the country, and convert both ways', () => {
  assert.equal(unitForCountry('US'), 'mi');
  assert.equal(unitForCountry('gb'), 'mi');
  assert.equal(unitForCountry('IT'), 'km');
  assert.equal(unitForCountry(null), 'km');
  near(toKm(50, 'mi'), 80.4672, 1e-9);
  near(fromKm(toKm(37, 'mi'), 'mi'), 37, 1e-9);
  assert.equal(toKm(10, 'km'), 10);
  assert.equal(formatDistance(0.4, 'km'), '<1 km');
  assert.equal(formatDistance(20, 'mi'), '12 mi');
});

test('projection and its inverse round-trip', () => {
  assert.deepEqual(project({ lat: 0, lon: 0 }, 0), { x: 128, y: 128 });
  for (const point of [AUSTIN, { lat: -33.8688, lon: 151.2093 }, { lat: 64.1466, lon: -21.9426 }]) {
    for (const zoom of [0, 5, 11.5, 18]) {
      const back = unproject(project(point, zoom), zoom);
      near(back.lat, point.lat, 1e-9, 'lat');
      near(back.lon, point.lon, 1e-9, 'lon');
    }
  }
});

test('the poles project to the edge of the world instead of infinity', () => {
  const north = project({ lat: 90, lon: 0 }, 3);
  assert.ok(Number.isFinite(north.y));
  near(north.y, 0, 1e-6);
});

test('screen and map coordinates convert both ways', () => {
  const view = { center: AUSTIN, zoom: 9.3 };
  assert.deepEqual(toScreen(AUSTIN, view, SIZE), { x: 250, y: 350 });
  const houston = toScreen(HOUSTON, view, SIZE);
  const back = fromScreen(houston, view, SIZE);
  near(back.lat, HOUSTON.lat, 1e-9);
  near(back.lon, HOUSTON.lon, 1e-9);
});

test('a marker across the antimeridian is drawn beside the centre', () => {
  const view = { center: { lat: -17.7, lon: 179.9 }, zoom: 8 };
  const across = toScreen({ lat: -17.7, lon: -179.9 }, view, SIZE);
  assert.ok(across.x > 250 && across.x < 350, `x ${across.x}`);
});

test('dragging right moves the view west, and back again', () => {
  const view = { center: AUSTIN, zoom: 8 };
  const moved = panBy(view, 100, 0);
  assert.ok(moved.center.lon < AUSTIN.lon);
  const back = panBy(moved, -100, 0);
  near(back.center.lon, AUSTIN.lon, 1e-9);
  near(back.center.lat, AUSTIN.lat, 1e-9);
});

test('zooming keeps the point under the cursor fixed, within zoom limits', () => {
  const view = { center: AUSTIN, zoom: 8 };
  const anchor = { x: 120, y: 540 };
  const before = fromScreen(anchor, view, SIZE);
  const zoomed = zoomAround(view, SIZE, anchor, 10.25);
  const after = fromScreen(anchor, zoomed, SIZE);
  assert.equal(zoomed.zoom, 10.25);
  near(after.lat, before.lat, 1e-9);
  near(after.lon, before.lon, 1e-9);
  assert.equal(zoomAround(view, SIZE, anchor, 40).zoom, MAX_ZOOM);
  assert.equal(zoomAround(view, SIZE, anchor, -3).zoom, MIN_ZOOM);
});

test('a pixel covers about 156 km at zoom 0 on the equator', () => {
  near(kmPerPixel(0, 0), 156.5, 0.2);
  near(kmPerPixel(60, 1), 156.5 / 4, 0.1);
});

test('a fitted circle fills the uncovered part of the map and is centred in it', () => {
  const insets = { top: 60, right: 10, bottom: 120, left: 10 };
  const radiusKm = 80;
  const view = fitCircle(AUSTIN, radiusKm, SIZE, insets);
  const radiusPx = radiusKm / kmPerPixel(AUSTIN.lat, view.zoom);
  const available = Math.min(SIZE.width - 20, SIZE.height - 180);
  assert.ok(radiusPx * 2 <= available + 1e-6, 'fits');
  near(radiusPx * 2, available, 1, 'fills');
  const centre = toScreen(AUSTIN, view, SIZE);
  near(centre.x, (10 + (SIZE.width - 10)) / 2, 1e-6, 'x');
  near(centre.y, (60 + (SIZE.height - 120)) / 2, 1e-6, 'y');
});

test('tiles cover the whole viewport at a fractional zoom', () => {
  const view = { center: AUSTIN, zoom: 9.4 };
  const tiles = visibleTiles(view, SIZE);
  assert.ok(tiles.every(t => t.z === 8));
  near(tiles[0]?.size ?? 0, 256 * 2 ** 1.4, 1e-9, 'scaled size');
  const covered = (x: number, y: number) =>
    tiles.some(t => x >= t.left && x < t.left + t.size && y >= t.top && y < t.top + t.size);
  for (const [x, y] of [
    [0, 0],
    [499.9, 0],
    [0, 699.9],
    [499.9, 699.9],
    [250, 350]
  ] as const) {
    assert.ok(covered(x, y), `(${x}, ${y}) uncovered`);
  }
});

test('only every other level is fetched, and tiles only ever scale up', () => {
  assert.equal(tileLevel(8), 8);
  assert.equal(tileLevel(9.4), 8);
  assert.equal(tileLevel(9.99), 8);
  assert.equal(tileLevel(10), 10);
  assert.equal(tileLevel(2.5), 2, 'never below the shallowest level');
  assert.equal(tileLevel(30), 18, 'clamped to the deepest level');
  const tiles = visibleTiles({ center: AUSTIN, zoom: 9.9 }, SIZE);
  assert.ok(tiles.every(t => t.z === 8));
  near(tiles[0]?.size ?? 0, 256 * 2 ** 1.9, 1e-9, 'scaled up, never down');
});

test('a zoom step lands on the adjacent whole level', () => {
  assert.equal(stepZoom(8.6, 1), 9);
  assert.equal(stepZoom(8.6, -1), 8);
  assert.equal(stepZoom(9, 1), 10);
  assert.equal(stepZoom(9, -1), 8);
  assert.equal(stepZoom(18, 1), 18);
  assert.equal(stepZoom(2, -1), 2);
});

test('a departing level can be laid out at the current view', () => {
  const view = { center: AUSTIN, zoom: 12.2 };
  const under = visibleTiles(view, SIZE, 10);
  assert.ok(under.length > 0);
  assert.ok(under.every(t => t.z === 10));
  near(under[0]?.size ?? 0, 256 * 2 ** 2.2, 1e-9, 'old tiles scaled to the new zoom');
  const centreUnder = under.find(t => t.left <= 250 && t.left + t.size > 250 && t.top <= 350 && t.top + t.size > 350);
  const centreNow = visibleTiles(view, SIZE).find(
    t => t.left <= 250 && t.left + t.size > 250 && t.top <= 350 && t.top + t.size > 350
  );
  assert.ok(centreUnder && centreNow, 'both levels cover the centre');
  assert.equal(Math.floor(centreNow.x / 4), centreUnder.x, 'the same ground is under the centre');
  assert.equal(Math.floor(centreNow.y / 4), centreUnder.y);
});

test('tile columns wrap around the world and rows stay on it', () => {
  const tiles = visibleTiles({ center: { lat: 80, lon: 179.99 }, zoom: 2 }, { width: 1200, height: 900 });
  assert.ok(tiles.every(t => t.x >= 0 && t.x < 4));
  assert.ok(tiles.every(t => t.y >= 0 && t.y < 4));
  assert.equal(new Set(tiles.map(t => t.key)).size, tiles.length, 'keys are unique');
});

test('a tap reaches the nearest dot within range, and nothing beyond it', () => {
  const dots = [
    { id: 'a', x: 10, y: 10 },
    { id: 'b', x: 40, y: 10 },
    { id: 'c', x: 200, y: 200 }
  ];
  const at = (dot: { x: number; y: number }) => dot;
  assert.equal(nearestWithin(dots, at, { x: 22, y: 12 }, 22)?.id, 'a');
  assert.equal(nearestWithin(dots, at, { x: 30, y: 10 }, 22)?.id, 'b', 'the closer of two in reach');
  assert.equal(nearestWithin(dots, at, { x: 120, y: 120 }, 22), null);
  assert.equal(nearestWithin([], at, { x: 0, y: 0 }, 22), null);
});
