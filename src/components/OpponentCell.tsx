import type { ArchetypeIndexEntry } from '../types';
import { getArchetypeIconMap, normalizeArchetypeKey, resolveArchetypeIcons } from '../lib/data';
import { ArchetypeIcons } from './ArchetypeIcon';

/**
 * Shared opponent-archetype helpers + cell renderer, used by both the matchup
 * table and the card-impact diff table. Lives in its own module so neither panel
 * has to import the other (which would create a cycle).
 */

/**
 * Index archetype entries by normalized label AND name, so a display label from
 * a matchup file ("Dragapult Dusknoir") resolves to its index entry (slug
 * "Dragapult_Dusknoir", icons, etc.). Label wins on collision.
 */
export function buildArchetypeIndexByKey(entries: ArchetypeIndexEntry[]): Map<string, ArchetypeIndexEntry> {
  const map = new Map<string, ArchetypeIndexEntry>();
  for (const entry of entries) {
    const nameKey = normalizeArchetypeKey(entry.name);
    if (!map.has(nameKey)) {
      map.set(nameKey, entry);
    }
  }
  // Second pass so labels overwrite name-only matches.
  for (const entry of entries) {
    map.set(normalizeArchetypeKey(entry.label), entry);
  }
  return map;
}

export interface OpponentMeta {
  /** Route slug (index `name`), or null if the opponent isn't in the index. */
  slug: string | null;
  iconSlugs: string[];
  /** Opponent's share of the field (raw — may be a 0..1 fraction). Null if absent. */
  percent: number | null;
}

export function resolveOpponentMeta(
  label: string,
  indexByKey: Map<string, ArchetypeIndexEntry>,
  iconMap: Map<string, string[]> = getArchetypeIconMap()
): OpponentMeta {
  const entry = indexByKey.get(normalizeArchetypeKey(label));
  const iconSlugs = resolveArchetypeIcons({ label, name: entry?.name, icons: entry?.icons }, iconMap);
  return { slug: entry?.name ?? null, iconSlugs, percent: entry?.percent ?? null };
}

export function OpponentCell(props: { label: string; iconSlugs: string[] }) {
  return (
    <span class='mu-opp'>
      <ArchetypeIcons slugs={props.iconSlugs} size={20} reserveSlot />
      <span class='cardname'>{props.label}</span>
    </span>
  );
}
