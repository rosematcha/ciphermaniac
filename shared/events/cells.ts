/**
 * Fixed latitude/longitude grid for sharding event listings.
 *
 * Five-degree cells keep the densest one (the US Northeast) to a few hundred
 * events, and a 250-mile search circle touches at most a handful of them at
 * the latitudes people live at. The grid is fixed rather than adaptive so a
 * cell key means the same thing in every generation.
 * @module shared/events/cells
 */

export const CELL_DEGREES = 5;

const KM_PER_DEGREE_LATITUDE = 111.32;
/** Just below the pole, so the northernmost band still has a cell above it. */
const MAX_LATITUDE = 89.999999;

/** Longitude folded into [-180, 180). */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-90, lat));
}

function cellEdge(value: number): number {
  // `+ 0` turns -0 into 0 so the key never reads "-0".
  return Math.floor(value / CELL_DEGREES) * CELL_DEGREES + 0;
}

/** Key of the cell holding a point: its south-west corner, e.g. `30_-100`. */
export function cellKeyFor(lat: number, lon: number): string {
  return `${cellEdge(clampLatitude(lat))}_${cellEdge(wrapLongitude(lon))}`;
}

/**
 * Degrees of longitude to either side of the centre that the circle can reach.
 *
 * Measured at the circle's edge nearest a pole, where a degree of longitude is
 * shortest. A circle that reaches within a degree of a pole, or over it, wraps
 * all the way around: the far side of the pole is 180 degrees away.
 */
function longitudeSpan(lat: number, latSpan: number, radiusKm: number): number {
  const poleward = Math.abs(lat) + latSpan;
  if (poleward >= 89) {
    return 180;
  }
  return Math.min(180, radiusKm / (KM_PER_DEGREE_LATITUDE * Math.cos((poleward * Math.PI) / 180)));
}

/**
 * Every cell a circle can touch.
 *
 * Deliberately generous: the circle's bounding box, widened at the latitude
 * where a degree of longitude is shortest. Fetching one cell too many costs a
 * small download; missing one drops real events off the map.
 * @param lat - Circle centre latitude
 * @param lon - Circle centre longitude
 * @param radiusKm - Circle radius in kilometres
 * @returns Sorted, de-duplicated cell keys
 */
export function cellsForCircle(lat: number, lon: number, radiusKm: number): string[] {
  const latSpan = radiusKm / KM_PER_DEGREE_LATITUDE;
  const south = clampLatitude(lat - latSpan);
  const north = clampLatitude(lat + latSpan);
  const lonSpan = longitudeSpan(lat, latSpan, radiusKm);
  const keys = new Set<string>();
  for (let cellLat = cellEdge(south); cellLat <= north; cellLat += CELL_DEGREES) {
    for (let cellLon = cellEdge(lon - lonSpan); cellLon <= lon + lonSpan; cellLon += CELL_DEGREES) {
      keys.add(cellKeyFor(cellLat, cellLon));
    }
  }
  return [...keys].sort();
}
