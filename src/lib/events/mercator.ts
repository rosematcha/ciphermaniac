/**
 * Web Mercator math for the locator's map.
 *
 * The map is a few absolutely positioned tile images and markers, not a map
 * library: Leaflet alone would put the route over its bundle budget. Every
 * piece of geometry it needs lives here as pure functions — projection, which
 * tiles cover the viewport, fitting a circle into view, zooming around a
 * point — so the component is left with events and DOM.
 *
 * Zoom is continuous. Tiles are drawn at the nearest even zoom at or below
 * it and scaled up by the remainder, which is what makes pinch zoom smooth.
 * Only every other level is fetched, and only ever scaled up: the map is for
 * finding roughly where a store is, so a softer tile costs nothing, while
 * each skipped level is a set of tiles a phone on cell data never downloads
 * and a swap it never shows.
 * @module lib/events/mercator
 */

import type { LatLon } from './geo';

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;
/** Only every this-many-th whole zoom has its tiles fetched; the rest scale up. */
const TILE_LEVEL_STEP = 2;
const MAX_LATITUDE = 85.05112878;
const EARTH_RADIUS_KM = 6371.0088;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapView {
  center: LatLon;
  zoom: number;
}

export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
}

/**
 * The item drawn closest to a screen point, when one is within `reach` pixels.
 * @returns null when nothing is close enough
 */
export function nearestWithin<T>(items: readonly T[], at: (item: T) => Point, target: Point, reach: number): T | null {
  let best: T | null = null;
  let bestDistance = reach;
  for (const item of items) {
    const point = at(item);
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** World pixel coordinates of a point at a zoom. */
export function project(point: LatLon, zoom: number): Point {
  const scale = worldSize(zoom);
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

/** The point at world pixel coordinates. Longitude comes back folded into [-180, 180). */
export function unproject(point: Point, zoom: number): LatLon {
  const scale = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lon: wrapLon((point.x / scale) * 360 - 180)
  };
}

/**
 * Where a point lands on screen. Picks whichever copy of the world is nearest
 * the centre, so a marker just across the antimeridian is drawn beside the
 * centre rather than a planet's width away.
 */
export function toScreen(point: LatLon, view: MapView, size: Size): Point {
  const world = worldSize(view.zoom);
  const p = project(point, view.zoom);
  const c = project(view.center, view.zoom);
  let dx = p.x - c.x;
  dx -= Math.round(dx / world) * world;
  return { x: size.width / 2 + dx, y: size.height / 2 + (p.y - c.y) };
}

/** The point under a screen position. */
export function fromScreen(point: Point, view: MapView, size: Size): LatLon {
  const c = project(view.center, view.zoom);
  return unproject({ x: c.x + point.x - size.width / 2, y: c.y + point.y - size.height / 2 }, view.zoom);
}

/** The view after dragging the map by (dx, dy) screen pixels. */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  const c = project(view.center, view.zoom);
  return { center: unproject({ x: c.x - dx, y: c.y - dy }, view.zoom), zoom: view.zoom };
}

/** The view at a new zoom that keeps the point under `anchor` where it is. */
export function zoomAround(view: MapView, size: Size, anchor: Point, zoom: number): MapView {
  const next = clampZoom(zoom);
  const fixed = fromScreen(anchor, view, size);
  const p = project(fixed, next);
  const center = unproject({ x: p.x - (anchor.x - size.width / 2), y: p.y - (anchor.y - size.height / 2) }, next);
  return { center, zoom: next };
}

/** Kilometres covered by one screen pixel at a latitude and zoom. */
export function kmPerPixel(lat: number, zoom: number): number {
  return (2 * Math.PI * EARTH_RADIUS_KM * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom);
}

/**
 * The view that shows a circle whole inside the viewport, clear of `insets`
 * (the parts of the map covered by controls). The circle is centred in the
 * uncovered area, not the whole viewport.
 */
export function fitCircle(center: LatLon, radiusKm: number, size: Size, insets: Insets): MapView {
  const width = Math.max(40, size.width - insets.left - insets.right);
  const height = Math.max(40, size.height - insets.top - insets.bottom);
  const diameterKm = radiusKm * 2;
  const zoom = clampZoom(Math.log2(Math.min(width, height) / (diameterKm / kmPerPixel(center.lat, 0))));
  const offset = { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
  const p = project(center, zoom);
  return { center: unproject({ x: p.x - offset.x, y: p.y - offset.y }, zoom), zoom };
}

/** The next whole zoom in a direction: a fractional zoom steps to its neighbour, a whole one moves a full level. */
export function stepZoom(zoom: number, step: 1 | -1): number {
  return clampZoom(step > 0 ? Math.floor(zoom) + 1 : Math.ceil(zoom) - 1);
}

/** The zoom whose tiles are drawn for a (fractional) zoom: the nearest fetched level at or below it. */
export function tileLevel(zoom: number): number {
  return clampZoom(Math.floor(clampZoom(zoom) / TILE_LEVEL_STEP) * TILE_LEVEL_STEP);
}

/**
 * Tiles covering the viewport, positioned in screen pixels.
 * @param view - Current centre and (fractional) zoom
 * @param size - Viewport size in CSS pixels
 * @param z - Tile level to draw; defaults to the level for the view's zoom
 * @returns One placement per tile, columns wrapped around the antimeridian
 */
export function visibleTiles(view: MapView, size: Size, z = tileLevel(view.zoom)): TilePlacement[] {
  const scale = 2 ** (view.zoom - z);
  const count = 2 ** z;
  const c = project(view.center, z);
  const originX = c.x - size.width / 2 / scale;
  const originY = c.y - size.height / 2 / scale;
  const tiles: TilePlacement[] = [];
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + size.height / scale) / TILE_SIZE));
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + size.width / scale) / TILE_SIZE);
  for (let y = firstY; y <= lastY; y++) {
    for (let col = firstX; col <= lastX; col++) {
      const x = ((col % count) + count) % count;
      tiles.push({
        key: `${z}/${col}/${y}`,
        z,
        x,
        y,
        left: (col * TILE_SIZE - originX) * scale,
        top: (y * TILE_SIZE - originY) * scale,
        size: TILE_SIZE * scale
      });
    }
  }
  return tiles;
}
