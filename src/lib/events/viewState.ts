/**
 * The locator's search centre and settings: defaults, validation of anything
 * read back from storage or a shared link, and what a link carries.
 *
 * Storage and URLs are both untrusted input here. A value that does not
 * validate falls back to the default rather than reaching the page.
 * @module lib/events/viewState
 */

import { DEFAULT_EVENT_KINDS, EVENT_KINDS, type EventKind } from '../../../shared/events/types';
import { type DistanceUnit, fromKm, toKm } from './geo';

/** How the centre was chosen. Decides what may be written into a link. */
export type CenterSource = 'search' | 'map' | 'device' | 'approximate' | 'link';

export interface LocatorCenter {
  lat: number;
  lon: number;
  label: string;
  cc: string | null;
  source: CenterSource;
}

export type WindowDays = 7 | 30 | null;

export interface LocatorSettings {
  /** In `unit`. */
  radius: number;
  unit: DistanceUnit;
  /** True once the visitor picks a unit; until then it follows the country. */
  unitPinned: boolean;
  kinds: EventKind[];
  windowDays: WindowDays;
}

/** Query parameters a shared link carries. A type alias, so it is assignable to the router's params map. */
export type LocatorParams = {
  near?: string;
  lat?: string;
  lon?: string;
  cc?: string;
  r?: string;
  u?: string;
};

export const RADIUS_MIN = 5;
export const RADIUS_MAX = 250;
/** Human-friendly radii with progressively larger gaps at longer distances. */
export const RADIUS_CHOICES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250] as const;
export const RADIUS_SLIDER_MAX = RADIUS_CHOICES.length - 1;
export const WINDOW_CHOICES: readonly WindowDays[] = [7, 30, null];
export const DEFAULT_SETTINGS: LocatorSettings = {
  radius: 50,
  unit: 'mi',
  unitPinned: false,
  kinds: [...DEFAULT_EVENT_KINDS],
  windowDays: 30
};

const SOURCES: readonly CenterSource[] = ['search', 'map', 'device', 'approximate', 'link'];
const LABEL_LIMIT = 120;

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isCountry(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

/** Snapped to the nearest logarithmically spaced slider value. */
export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.radius;
  }
  const bounded = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, value));
  return RADIUS_CHOICES.reduce((closest, choice) =>
    Math.abs(choice - bounded) < Math.abs(closest - bounded) ? choice : closest
  );
}

/** The same reach in another unit, snapped to the slider. */
export function convertRadius(value: number, from: DistanceUnit, to: DistanceUnit): number {
  return from === to ? value : clampRadius(fromKm(toKm(value, from), to));
}

export function parseCenter(raw: unknown): LocatorCenter | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const c = raw as Record<string, unknown>;
  const label = typeof c.label === 'string' ? c.label.trim().slice(0, LABEL_LIMIT) : '';
  if (!isCoordinate(c.lat, 90) || !isCoordinate(c.lon, 180) || !label) {
    return null;
  }
  const source = SOURCES.find(s => s === c.source) ?? 'search';
  return { lat: c.lat, lon: c.lon, label, cc: isCountry(c.cc) ? c.cc : null, source };
}

export function parseSettings(raw: unknown): LocatorSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const listed = Array.isArray(s.kinds) ? EVENT_KINDS.filter(kind => (s.kinds as unknown[]).includes(kind)) : [];
  return {
    radius: typeof s.radius === 'number' ? clampRadius(s.radius) : DEFAULT_SETTINGS.radius,
    unit: s.unit === 'km' || s.unit === 'mi' ? s.unit : DEFAULT_SETTINGS.unit,
    unitPinned: s.unitPinned === true,
    kinds: listed.length ? listed : [...DEFAULT_EVENT_KINDS],
    // `includes`, not `find(...) ?? default`: null ("All") is a real choice, and `??` would replace it.
    windowDays: WINDOW_CHOICES.includes(s.windowDays as WindowDays)
      ? (s.windowDays as WindowDays)
      : DEFAULT_SETTINGS.windowDays
  };
}

/** A centre from a shared link, or null when the link has none. */
export function centerFromParams(params: LocatorParams): LocatorCenter | null {
  if (!params.lat || !params.lon) {
    return null;
  }
  const lat = Number(params.lat);
  const lon = Number(params.lon);
  return parseCenter({
    lat,
    lon,
    label: params.near?.trim() || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    cc: params.cc?.toUpperCase(),
    source: 'link'
  });
}

/** A link's radius and unit laid over the stored settings. */
export function settingsFromParams(params: LocatorParams, base: LocatorSettings): LocatorSettings {
  const unit = params.u === 'km' || params.u === 'mi' ? params.u : null;
  const radius = params.r ? Number(params.r) : Number.NaN;
  return {
    ...base,
    unit: unit ?? base.unit,
    unitPinned: unit ? true : base.unitPinned,
    radius: Number.isFinite(radius) ? clampRadius(radius) : base.radius
  };
}

const EMPTY_PARAMS: LocatorParams = {
  near: undefined,
  lat: undefined,
  lon: undefined,
  cc: undefined,
  r: undefined,
  u: undefined
};

/**
 * What the URL should say. Only a place the visitor chose goes into a link:
 * a device fix or the IP estimate is where they are, and a copied URL must
 * not carry that to whoever it is pasted to.
 */
export function paramsFor(center: LocatorCenter | null, settings: LocatorSettings): LocatorParams {
  if (!center || center.source === 'device' || center.source === 'approximate') {
    return EMPTY_PARAMS;
  }
  return {
    near: center.label,
    lat: center.lat.toFixed(3),
    lon: center.lon.toFixed(3),
    cc: center.cc ?? undefined,
    r: String(settings.radius),
    u: settings.unit
  };
}

const CENTER_KEY = 'cm:events:center';
const SETTINGS_KEY = 'cm:events:settings';

function readJson(storage: Storage | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the page works, it just will not remember */
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadStored(storage: Storage | undefined = safeLocalStorage()): {
  center: LocatorCenter | null;
  settings: LocatorSettings;
} {
  return {
    center: parseCenter(readJson(storage, CENTER_KEY)),
    settings: parseSettings(readJson(storage, SETTINGS_KEY))
  };
}

/**
 * Remember the centre and settings on this device. The IP estimate is not
 * remembered, so a visitor who travels gets a fresh one; a device fix is kept
 * at about a hundred metres.
 */
export function saveStored(
  center: LocatorCenter | null,
  settings: LocatorSettings,
  storage: Storage | undefined = safeLocalStorage()
): void {
  if (center && center.source !== 'approximate') {
    writeJson(storage, CENTER_KEY, {
      ...center,
      lat: Number(center.lat.toFixed(3)),
      lon: Number(center.lon.toFixed(3))
    });
  }
  writeJson(storage, SETTINGS_KEY, settings);
}
