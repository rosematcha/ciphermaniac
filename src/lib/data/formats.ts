/** Format metadata loaded on demand from R2 for the Tier List Maker. */

import { fetchArchetypes } from './archetypes';
import { ONLINE } from './paths';
import { createSignal } from 'solid-js';
import { dataClient } from './client';
import type { ArchetypeIndexEntry } from '../../types';
import frozenRetroSnapshot from '../../data/frozen-retro-formats.json';

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
 * Retired formats have settled metagames. Keep their last complete scrape in
 * the application so the picker still works when the live metadata request is
 * unavailable; a successful R2 refresh replaces this catalogue wholesale.
 */
const FROZEN_RETRO_FORMATS = frozenRetroSnapshot.formats as SnapshotFormat[];

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

const [scraped, setScraped] = createSignal<SnapshotFormat[]>(FROZEN_RETRO_FORMATS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validStrings(value: unknown, pattern: RegExp): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    value.every(item => typeof item === 'string' && pattern.test(item))
  );
}

function isArchetype(value: unknown): value is SnapshotArchetype {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || value.name === 'Other') {
    return false;
  }
  return (
    typeof value.share === 'number' &&
    value.share > 0 &&
    value.share <= 100 &&
    validStrings(value.icons, /^[a-z0-9-]+$/) &&
    (value.cards === undefined || validStrings(value.cards, /^[A-Z0-9]{2,8}\/(?:\d{3}[A-Z]*|[A-Z]{1,4}\d+)$/))
  );
}

function isFormat(value: unknown): value is SnapshotFormat {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-z0-9-]+$/.test(value.id)) {
    return false;
  }
  if (value.id === STANDARD_FORMAT_ID || typeof value.label !== 'string' || !value.label.trim()) {
    return false;
  }
  if (value.group !== 'past' && value.group !== 'current') {
    return false;
  }
  const entries = value.archetypes;
  return (
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every(isArchetype) &&
    new Set(entries.map(entry => entry.name)).size === entries.length
  );
}

export async function loadTierFormats(
  fetchSnapshot: () => Promise<unknown> = () => dataClient.fetchJson('/assets/format-archetypes.json')
): Promise<void> {
  const value = await fetchSnapshot();
  if (!isRecord(value) || !Array.isArray(value.formats) || !value.formats.every(isFormat)) {
    throw new Error('Invalid format archetype snapshot');
  }
  if (new Set(value.formats.map(format => format.id)).size !== value.formats.length) {
    throw new Error('Duplicate format IDs');
  }
  setScraped(value.formats);
}

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
export const tierFormats = (): TierFormat[] => [
  STANDARD,
  ...scraped().map(format => ({
    id: format.id,
    label: format.label,
    group: format.group === 'past' ? ('past' as const) : ('current' as const),
    previews: hasArts(format)
  }))
];

/** Resolves an id to a format, falling back to Standard for anything unknown. */
export function tierFormat(id: string | undefined): TierFormat {
  return tierFormats().find(format => format.id === id) ?? STANDARD;
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
  return (scraped().find(entry => entry.id === format.id)?.archetypes ?? []).map(archetype => ({
    name: archetype.name,
    label: archetype.name,
    deckCount: null,
    percent: archetype.share,
    thumbnails: archetype.cards ?? [],
    icons: archetype.icons
  }));
}
