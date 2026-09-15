/**
 * GET /api/locate — the visitor's approximate location, from Cloudflare's IP
 * geolocation of this request.
 *
 * Lets /events open on the visitor's area without asking for permission. It
 * is city-level at best and wrong behind a VPN or some mobile carriers, so the
 * page presents it as approximate and one search replaces it. Nothing is
 * stored, and the answer is never cached: it describes one visitor.
 */

import { jsonResponse } from '../lib/api/responses.js';
import type { ApproximateLocation } from '../../shared/events/types';

/** The subset of Cloudflare's `request.cf` this reads. Every field is optional. */
export interface CfLocation {
  latitude?: unknown;
  longitude?: unknown;
  city?: unknown;
  region?: unknown;
  regionCode?: unknown;
  country?: unknown;
}

interface Context {
  request: Request & { cf?: CfLocation };
}

/** Cloudflare's codes for "unknown" and "Tor exit node". */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function coordinate(value: unknown, limit: number): number | null {
  const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function countryCode(value: unknown): string | null {
  const code = optionalText(value);
  return code && /^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.has(code) ? code : null;
}

/**
 * Read a location out of `request.cf`, or null when it has no usable one.
 * Coordinates are rounded to two places (about a kilometre): the edge's own
 * estimate is coarser than that, and nothing downstream needs more.
 */
export function approximateLocation(cf: CfLocation | undefined): ApproximateLocation | null {
  const lat = coordinate(cf?.latitude, 90);
  const lon = coordinate(cf?.longitude, 180);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) {
    return null;
  }
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    city: optionalText(cf?.city),
    region: optionalText(cf?.region),
    regionCode: optionalText(cf?.regionCode),
    cc: countryCode(cf?.country)
  };
}

export async function onRequestGet(context: Context): Promise<Response> {
  return jsonResponse(
    { location: approximateLocation(context.request.cf) },
    // Same-origin only, and private to the one visitor it describes.
    { cacheControl: 'private, no-store', cors: false }
  );
}
