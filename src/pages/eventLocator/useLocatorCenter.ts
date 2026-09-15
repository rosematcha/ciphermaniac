import { batch, createSignal, onMount } from 'solid-js';
import type { ApproximateLocation } from '../../../shared/events/types';
import { reverseGeocode } from '../../lib/events/geocode';
import {
  approximateLabel,
  deviceLocation,
  DeviceLocationError,
  fetchApproximateLocation
} from '../../lib/events/locate';
import type { LocatorCenter } from '../../lib/events/viewState';

const LOCATE_ERRORS: Record<DeviceLocationError['reason'], string> = {
  denied: 'Location is blocked for this site.',
  unsupported: 'This browser can’t share a location.',
  unavailable: 'Couldn’t get a location. Try searching instead.'
};
const DEFAULT_CENTER: LocatorCenter = {
  lat: 40.691872,
  lon: -89.592178,
  label: '201 SW Jefferson Ave, Peoria, IL 61602',
  cc: 'US',
  source: 'default'
};

function approximateCenter(location: ApproximateLocation | null): LocatorCenter | null {
  return location
    ? {
        lat: location.lat,
        lon: location.lon,
        label: approximateLabel(location),
        cc: location.cc ?? null,
        source: 'approximate'
      }
    : null;
}

/**
 * Where the locator is centred, and how it got there: a shared link or the
 * last visit, the device, the edge's IP estimate, or the default place. The
 * newest request wins, so a device lookup that resolves after the visitor
 * picked somewhere else is dropped.
 * @param initial The centre from a link or storage, or null to go and find one
 * @param onMove Runs with every new centre, in the same batch as the move
 */
export function useLocatorCenter(initial: LocatorCenter | null, onMove: (next: LocatorCenter) => void) {
  const [center, setCenter] = createSignal<LocatorCenter | null>(initial);
  const [locating, setLocating] = createSignal(false);
  const [locateError, setLocateError] = createSignal<string | null>(null);
  const [lookedUp, setLookedUp] = createSignal(Boolean(initial));
  let request = 0;

  /**
   * Move the search. A centre the visitor chose cancels any device lookup in
   * flight; one the page picked for itself (`supersede` false) does not.
   */
  function choose(next: LocatorCenter, supersede = true) {
    if (supersede) {
      request++;
    }
    batch(() => {
      setCenter(next);
      setLocateError(null);
      onMove(next);
    });
  }

  /**
   * Centre on the device. Resolves false when it will not say where it is;
   * `quiet` leaves the reason unshown, for the first visit's own fallbacks.
   */
  async function locateDevice(quiet = false): Promise<boolean> {
    setLocating(true);
    setLocateError(null);
    const ticket = ++request;
    try {
      const point = await deviceLocation();
      const place = await reverseGeocode(point).catch(() => null);
      if (ticket === request) {
        choose({ ...point, label: place?.label ?? 'Your location', cc: place?.cc ?? null, source: 'device' });
      }
      return true;
    } catch (error) {
      if (ticket === request && !quiet) {
        setLocateError(error instanceof DeviceLocationError ? LOCATE_ERRORS[error.reason] : LOCATE_ERRORS.unavailable);
      }
      return false;
    } finally {
      setLocating(false);
      if (!quiet) {
        setLookedUp(true);
      }
    }
  }

  /** Take a centre the page picked itself, unless one is already showing. */
  function settle(next: LocatorCenter | null) {
    if (next && !center()) {
      choose(next, false);
    }
  }

  /**
   * First visit: the edge's IP estimate fills in while the device is asked,
   * so the list never waits on a permission prompt. Only with neither does
   * the page fall back to its default place.
   */
  async function locateFirst() {
    const guess = fetchApproximateLocation().then(approximateCenter);
    void guess.then(settle);
    if (!(await locateDevice(true))) {
      settle((await guess) ?? DEFAULT_CENTER);
    }
    setLookedUp(true);
  }

  onMount(() => {
    if (!initial) {
      void locateFirst();
    }
  });

  return { center, choose, locateDevice, locating, locateError, lookedUp };
}
