/**
 * The formats the Tier List Maker can rank, and where each one's archetypes
 * come from.
 *
 * Two sources, one interface. Standard is our own rolling online-meta report on
 * R2, rebuilt daily. Everything else is a committed snapshot of the Limitless
 * metagame table, scraped by `.github/scripts/scrape-format-archetypes.py`,
 * which reads each archetype's decklists there for the cards it was built
 * around — so a scraped format carries sprite slugs and card art both, and
 * Previews works everywhere.
 *
 * The snapshot is bundled rather than fetched for the same reason the archetype
 * icon map is: the repo's runtime data dir is CI-populated, so a same-origin
 * fetch would not resolve in dev, and 19KB is cheaper than an R2 round trip we
 * would then have to cache-bust.
 * @module src/lib/data/formats
 */

import { fetchArchetypes } from './archetypes';
import { ONLINE } from './paths';
import snapshot from '../../data/format-archetypes.json';
import type { ArchetypeIndexEntry } from '../../types';

/** Whether a format is still being played, which decides how it is grouped. */
export type FormatGroup = 'current' | 'past';

export interface TierFormat {
  /** Stable id. Rides in the URL and in shared tier lists, so never rename one. */
  id: string;
  label: string;
  group: FormatGroup;
  /**
   * Whether the format's archetypes carry card thumbnails. The page hides its
   * Icons/Previews toggle without them — a Previews mode with nothing to
   * preview is a broken control, not an empty one.
   */
  previews: boolean;
}

interface SnapshotArchetype {
  name: string;
  icons: string[];
  share: number;
  /** `SET/NNN` refs, at most two. Absent on a snapshot taken before arts. */
  cards?: string[];
}

interface SnapshotFormat {
  id: string;
  label: string;
  group: string;
  archetypes: SnapshotArchetype[];
}

/**
 * Standard's id. It is the default and the only format not in the snapshot,
 * so both halves of the module special-case it.
 */
export const STANDARD_FORMAT_ID = 'standard';

const STANDARD: TierFormat = {
  id: STANDARD_FORMAT_ID,
  label: 'Standard',
  group: 'current',
  previews: true
};

const SCRAPED: SnapshotFormat[] = ((snapshot as { formats?: SnapshotFormat[] }).formats ?? []).filter(
  format => format.archetypes.length > 0
);

const SCRAPED_BY_ID = new Map(SCRAPED.map(format => [format.id, format]));

/**
 * Whether every archetype in a format has art, which is what the Previews
 * toggle promises. All-or-nothing on purpose: a board where a handful of tiles
 * fall back to their name reads as broken art, not as a format we know less
 * about, and the honest fix is to leave the toggle off until the scrape covers
 * the whole table.
 */
function hasArts(format: SnapshotFormat): boolean {
  return format.archetypes.every(archetype => (archetype.cards?.length ?? 0) > 0);
}

/**
 * Every format the picker offers, in display order: Standard leads, then the
 * snapshot's own order, which its producer keeps in catalog order.
 */
export const TIER_FORMATS: TierFormat[] = [
  STANDARD,
  ...SCRAPED.map(format => ({
    id: format.id,
    label: format.label,
    group: format.group === 'past' ? ('past' as const) : ('current' as const),
    previews: hasArts(format)
  }))
];

/**
 * Every sprite slug the committed snapshots use.
 *
 * `scripts/mirror-archetype-sprites.ts` reads the same file, so these are the
 * slugs served from our own R2 — which is what makes them safe to offer in the
 * custom-archetype picker, where a cross-origin sprite would leave a hole in
 * the exported JPG.
 */
export const FORMAT_SPRITE_SLUGS: string[] = [
  ...new Set(SCRAPED.flatMap(format => format.archetypes.flatMap(archetype => archetype.icons)))
];

/** Resolves an id to a format, falling back to Standard for anything unknown. */
export function tierFormat(id: string | undefined): TierFormat {
  return TIER_FORMATS.find(format => format.id === id) ?? STANDARD;
}

/**
 * A format's archetypes, in descending play order.
 *
 * Async for both sources so the caller does not have to know which one it got.
 * The snapshot's entries fill in the index shape's required fields rather than
 * inventing data: its cards are the ones the format's own decklists were built
 * around, but no report stands behind them, so the deck count stays null.
 */
export async function fetchFormatArchetypes(id: string): Promise<ArchetypeIndexEntry[]> {
  const format = tierFormat(id);
  if (format.id === STANDARD_FORMAT_ID) {
    return fetchArchetypes(ONLINE);
  }
  return (SCRAPED_BY_ID.get(format.id)?.archetypes ?? []).map(archetype => ({
    name: archetype.name,
    label: archetype.name,
    deckCount: null,
    percent: archetype.share,
    thumbnails: archetype.cards ?? [],
    icons: archetype.icons
  }));
}
