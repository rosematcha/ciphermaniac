/**
 * Recently chosen places, remembered on this device for the empty search box.
 * @module lib/events/recents
 */

import type { PlaceSuggestion } from './search';

const KEY = 'cm:events:recent';
const LIMIT = 5;
const KINDS = new Set(['city', 'venue', 'geocoded']);

function isSuggestion(value: unknown): value is PlaceSuggestion {
  const v = value as Partial<PlaceSuggestion> | null;
  return Boolean(
    v &&
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.centerLabel === 'string' &&
    typeof v.detail === 'string' &&
    typeof v.cc === 'string' &&
    KINDS.has(v.kind ?? '') &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon)
  );
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRecents(store: Storage | undefined = storage()): PlaceSuggestion[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSuggestion).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

/** Put a place at the front of the recent list and return the new list. */
export function rememberRecent(place: PlaceSuggestion, store: Storage | undefined = storage()): PlaceSuggestion[] {
  const next = [place, ...loadRecents(store).filter(recent => recent.id !== place.id)].slice(0, LIMIT);
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the list simply is not remembered */
  }
  return next;
}
