/**
 * Archetype index, per-archetype reports, and icon resolution.
 *
 * Archetype identity is a triple: a lowercased comparison key, a cased
 * display name, and a slug derived from the key. {@link normalizeArchetypeKey}
 * is the comparison key — every lookup that could otherwise split one archetype
 * across casing or punctuation goes through it.
 * @module src/lib/data/archetypes
 */

import { dataClient } from './client';
import { canonicalizeReportCached, normalizeIndexPercentScale } from './compat';
import { ONLINE, tournamentPath } from './paths';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import { createSignal } from 'solid-js';
import type { ArchetypeIndexEntry, ArchetypeReport } from '../../types';

const { fetchJson } = dataClient;

export async function fetchArchetypes(tournament: string = ONLINE): Promise<ArchetypeIndexEntry[]> {
  const list = await fetchJson<ArchetypeIndexEntry[]>(`${tournamentPath(tournament)}/archetypes/index.json`);
  return normalizeIndexPercentScale(list);
}

/**
 * Normalizes an archetype name/label to the key form used by the icon override
 * map. Mirrors `normalize_deck_label` in download-tournament.py so the same key
 * matches both archetype `label`/`name` and trends `series.name` (the base slug,
 * e.g. "Dragapult Dusknoir" → "dragapult_dusknoir").
 */
export function normalizeArchetypeKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

const [archetypeIconMap, setArchetypeIconMap] = createSignal(new Map<string, string[]>());

/** Load mutable metadata from the same R2 origin as tournament reports. */
export async function loadArchetypeIconMap(
  fetchIcons: () => Promise<unknown> = () => fetchJson<unknown>('/assets/archetype-icons.json')
): Promise<void> {
  const value = await fetchIcons();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid archetype icon map');
  }
  const map = new Map<string, string[]>();
  for (const [label, slugs] of Object.entries(value)) {
    if (
      !Array.isArray(slugs) ||
      !slugs.every((slug: unknown) => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug))
    ) {
      throw new Error(`Invalid archetype icons for ${label}`);
    }
    map.set(normalizeArchetypeKey(label), slugs as string[]);
  }
  setArchetypeIconMap(map);
}

/** The archetype → Pokémon icon-slug map, keyed by normalized archetype name. */
export function getArchetypeIconMap(): Map<string, string[]> {
  return archetypeIconMap();
}

/**
 * Resolves an archetype's icon slugs: prefer the entry's embedded `icons` (from
 * the tournament index), else fall back to the override map by normalized
 * label/name so icons appear retroactively on tournaments that predate the field.
 */
export function resolveArchetypeIcons(
  identifiers: { name?: string | null; label?: string | null; icons?: string[] },
  map?: Map<string, string[]> | null
): string[] {
  if (identifiers.icons && identifiers.icons.length > 0) {
    return identifiers.icons;
  }
  if (!map) {
    return [];
  }
  return map.get(normalizeArchetypeKey(identifiers.label)) ?? map.get(normalizeArchetypeKey(identifiers.name)) ?? [];
}

export async function fetchArchetype(tournament: string, archetypeBase: string): Promise<ArchetypeReport> {
  const [raw, db] = await Promise.all([
    fetchJson<ArchetypeReport>(
      `${tournamentPath(tournament)}/archetypes/${encodeURIComponent(archetypeBase)}/cards.json`
    ),
    getSynonymDatabase()
  ]);
  return canonicalizeReportCached(raw, db);
}

// Backwards-compatible alias (always online meta)
export const fetchOnlineArchetypes = (): Promise<ArchetypeIndexEntry[]> => fetchArchetypes(ONLINE);

/** One archetype's usage of a card, from the precomputed `cardUsage.json` index. */
