/**
 * Where to centre the locator before the visitor has said anything: the
 * edge's IP estimate (`/api/locate`), and the device's own position once they
 * ask for it.
 * @module lib/events/locate
 */

import type { ApproximateLocation } from '../../../shared/events/types';
import { countryName } from './format';

/** "Austin, TX" in the US, "Milan, Italy" elsewhere, "Somewhere" with nothing to go on. */
export function approximateLabel(location: ApproximateLocation): string {
  const place = location.city ?? location.region;
  if (!place) {
    return location.cc ? countryName(location.cc) : `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`;
  }
  if (location.cc === 'US') {
    return location.regionCode ? `${place}, ${location.regionCode}` : place;
  }
  return location.cc ? `${place}, ${countryName(location.cc)}` : place;
}

/**
 * The edge's estimate, or null when it has none or the endpoint is missing
 * (as it is under `vite` without the local Functions server).
 */
export async function fetchApproximateLocation(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<ApproximateLocation | null> {
  try {
    const response = await fetchImpl('/api/locate', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { location?: ApproximateLocation | null };
    return body.location ?? null;
  } catch {
    return null;
  }
}

export type DeviceLocationReason = 'unsupported' | 'denied' | 'unavailable';

/** Why the device's position could not be read. */
export class DeviceLocationError extends Error {
  readonly reason: DeviceLocationReason;

  constructor(reason: DeviceLocationReason) {
    super(`Device location ${reason}`);
    this.name = 'DeviceLocationError';
    this.reason = reason;
  }
}

/** The device's position, rejecting with a {@link DeviceLocationError}. */
export function deviceLocation(
  geolocation: Geolocation | undefined = globalThis.navigator?.geolocation
): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new DeviceLocationError('unsupported'));
      return;
    }
    geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      error => reject(new DeviceLocationError(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}
