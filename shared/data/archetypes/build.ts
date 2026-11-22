/**
 * Archetype grouping and index construction shared by every producer.
 * Producer-specific output shapes are selected through
 * {@link ArchetypeBuildOptions}. This module is environment-neutral.
 */

import { normalizeArchetypeName, sanitizeForFilename } from '../../cardUtils';
import { isGenericArchetypeName } from '../../analysis/archetypeClassifier';
import { canonicalizeArchetypeLabel } from './identity';
import { type DeckEntry, generateReportFromDecks, type LegacyCardReport, listedDeckCount } from '../reports/cardReport';
import type { SynonymDatabase } from '../cardIdentity';
import { countUsageTiers } from '../reports/cardUsage';
import {
  buildCardMetaLookup,
  buildMetaUsage,
  generateSignatureCards,
  type IconConfig,
  type PresentationReport,
  resolveArchetypeIcons,
  resolveArchetypeThumbnails,
  type SignatureCard,
  type ThumbnailConfig
} from './presentation';

// ============================================================================
// Types
// ============================================================================

/** A deck accepted by the archetype builder: a card list plus its label. */
export interface ArchetypeDeckInput extends DeckEntry {
  archetype?: string | null;
  /** Finish tags; feed the per-tier counts in `cardUsage.json`. */
  successTags?: readonly string[] | null;
}

/** How group keys and slug bases are derived. */
export type ArchetypeNameCasing =
  /**
   * Online .mjs / Python behavior: case-preserving normalized name as the
   * group key, slug base sanitized with the simple space→underscore +
   * invalid-char strip (no `..` removal, no trim).
   */
  | 'preserve'
  /**
   * Functions reportGenerator behavior: lowercased normalized name as the
   * group key, slug base sanitized with the shared sanitizer.
   */
  | 'lower';

/** Options reproducing each producer's exact output shape. */
export interface ArchetypeBuildOptions {
  /** Group-key/slug casing profile. */
  nameCasing: ArchetypeNameCasing;
  /**
   * Minimum group size as a fraction of total decks; groups below
   * `max(1, ceil(deckTotal * fraction))` are dropped. Online uses 0.005,
   * reportGenerator `minPercent / 100`, Python 0 (no filter).
   */
  minDecksFraction: number;
  /** A fixed floor in decks; when set it replaces `minDecksFraction`. */
  minDecks?: number;
  /** Keep only this many archetypes, largest first (ties in first-seen order). */
  maxArchetypes?: number;
  /**
   * Index `percent` representation. 'fraction' = raw deckCount/deckTotal
   * (online + reportGenerator); 'fraction6' = rounded to 6 decimals (Python).
   */
  percentMode: 'fraction' | 'fraction6';
  /**
   * Index ordering. 'deckCount' = deckCount desc, ties in first-seen order
   * (online + reportGenerator); 'deckCountThenLabel' = deckCount desc then
   * label asc (Python).
   */
  sortMode: 'deckCount' | 'deckCountThenLabel';
  /** Display labels: 'raw' keeps the deck's label verbatim (online +
   * reportGenerator); 'trimmed' strips surrounding whitespace (Python). */
  displayNames?: 'raw' | 'trimmed';
  /** Fallback slug base when sanitization empties the name. Online +
   * reportGenerator use 'Unknown'; Python has no fallback (pass null). */
  emptyBaseFallback?: string | null;
  /** Hand-maintained thumbnail override map. */
  thumbnailConfig?: ThumbnailConfig | null;
  /** Card-types DB for Stage 2 thumbnail inference (online + Python). */
  cardTypesDb?: unknown;
  /** Master (meta-wide) report enabling Stage 3 distinctiveness and signature
   * cards. */
  masterReport?: PresentationReport | null;
  /** Emit `signatureCards` on index entries (online + Python; reportGenerator
   * historically did not). With no masterReport the field is `[]`. */
  includeSignatureCards: boolean;
  /** Hand-maintained icon override map; providing it emits `icons` on index
   * entries (Python-only field today). */
  iconConfig?: IconConfig | null;
  /** Optional canonical-UID resolver (rolling canonicals bound to an event
   * date), forwarded to the per-archetype card reports. */
  resolveUid?: (uid: string) => string;
  /**
   * Leave "Other" / "Unknown" style groups out of the files and index. Their
   * decks still count in `deckTotal`, so every real archetype's share is
   * unchanged; the bucket just stops masquerading as a deck with a page.
   */
  excludeGenericGroups?: boolean;
}

/** A grouped archetype's report file (producers add their own filenames). */
export interface ArchetypeFile {
  base: string;
  displayName: string;
  deckCount: number;
  data: LegacyCardReport;
  /** Usage key -> deck counts per finish tier, for `cardUsage.json`; only when the decks carry finish tags. */
  tiers?: Map<string, number[]>;
}

/** One archetype index entry; optional fields appear per producer options. */
export interface ArchetypeIndexEntry {
  name: string;
  label: string;
  deckCount: number;
  percent: number;
  thumbnails: string[];
  signatureCards?: SignatureCard[];
  icons?: string[];
}

/** Result of {@link buildArchetypeReports}. */
export interface ArchetypeBuildResult {
  minDecks: number;
  deckTotal: number;
  files: ArchetypeFile[];
  index: ArchetypeIndexEntry[];
  /** Raw decks per included archetype base (per-archetype decks.json). */
  decksByBase: Map<string, ArchetypeDeckInput[]>;
}

// ============================================================================
// Grouping key / slug base derivation
// ============================================================================

/**
 * Case-preserving archetype-label normalization: underscores to spaces,
 * whitespace collapsed, trimmed; empty becomes 'unknown'. Source:
 * run-online-meta.mjs `normalizeArchetypeName` (Python `normalize_archetype_name`
 * is identical minus the fallback, which its `ensure_archetype` pre-empts).
 * The shared lowercasing normalizer lives in shared/cardUtils.
 * @param name - Raw label
 * @returns Case-preserving normalized label
 */
export function normalizeArchetypeLabelPreservingCase(name: string | null | undefined): string {
  return canonicalizeArchetypeLabel(name) || 'unknown';
}

/**
 * Simple filename sanitizer used by the online .mjs and Python producers:
 * spaces to underscores, invalid path characters stripped. Unlike the shared
 * `sanitizeForFilename` it does NOT remove `..` sequences or trim — preserved
 * so 'preserve'-profile slugs stay byte-identical.
 */
function sanitizeForFilenameSimple(text: string): string {
  return (text || '').replace(/ /g, '_').replace(/[<>:"/\\|?*]/g, '');
}

/**
 * Derive an archetype's group key and slug base from a display label under a
 * producer casing profile.
 * @param displayName - The (already defaulted) display label
 * @param nameCasing - Producer casing profile
 * @param emptyBaseFallback - Fallback base when sanitization empties the name
 * @returns Group key and slug base
 */
export function deriveArchetypeGrouping(
  displayName: string,
  nameCasing: ArchetypeNameCasing,
  emptyBaseFallback: string | null = 'Unknown'
): { key: string; base: string } {
  if (nameCasing === 'lower') {
    const key = normalizeArchetypeName(displayName);
    const base = sanitizeForFilename(key.replace(/ /g, '_')) || emptyBaseFallback || '';
    return { key, base };
  }
  const key = normalizeArchetypeLabelPreservingCase(displayName);
  const base = sanitizeForFilenameSimple(key.replace(/ /g, '_')) || emptyBaseFallback || '';
  return { key, base };
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Per-archetype finish-tier counts, keyed like the archetype's report. Rebuilds
 * from stored rows may drop finish tags; a build without any claims no counts.
 */
function tierCounter(
  decks: readonly ArchetypeDeckInput[],
  synonymDb: SynonymDatabase | null,
  resolveUid: ((uid: string) => string) | undefined
): (archetypeDecks: ArchetypeDeckInput[]) => Map<string, number[]> | undefined {
  if (!decks.some(deck => Array.isArray(deck?.successTags))) {
    return () => undefined;
  }
  return archetypeDecks =>
    countUsageTiers(
      archetypeDecks,
      subset => generateReportFromDecks(subset, subset.length, synonymDb, { resolveUid }).items
    );
}

/**
 * The groups that get a page: at the floor, not a generic bucket, and within the cap.
 * Two names can sanitize to one file base ("Arceus Giratina", "Arceus: Giratina");
 * only the larger keeps it, since both would write the same files.
 * @param groups - Groups in first-seen order
 * @param minDecks - Smallest group kept
 * @param max - Most groups kept, largest first; ties keep first-seen order
 * @param excludeGeneric - Drop "Other" / "Unknown" style groups
 * @returns The kept groups, still in first-seen order
 */
function pagedGroups<G extends { base: string; displayName: string; decks: unknown[] }>(
  groups: G[],
  minDecks: number,
  max: number,
  excludeGeneric: boolean
): G[] {
  const eligible = groups.filter(
    group => group.decks.length >= minDecks && !(excludeGeneric && isGenericArchetypeName(group.displayName))
  );
  const bases = new Set<string>();
  const kept = new Set<G>();
  for (const group of [...eligible].sort((a, b) => b.decks.length - a.decks.length)) {
    if (kept.size < max && !bases.has(group.base)) {
      bases.add(group.base);
      kept.add(group);
    }
  }
  return eligible.filter(group => kept.has(group));
}

type DeckGroup = { base: string; displayName: string; decks: ArchetypeDeckInput[] };

/**
 * Group decks by identity key; the first-seen deck fixes the display label and base.
 * @param decks - Decks with archetype labels
 * @param options - Producer shape options
 * @returns Groups in first-seen order
 */
function groupDecks(decks: ArchetypeDeckInput[], options: ArchetypeBuildOptions): DeckGroup[] {
  const { nameCasing, displayNames = 'raw', emptyBaseFallback = 'Unknown' } = options;
  const groups = new Map<string, DeckGroup>();
  for (const deck of decks) {
    const rawLabel = deck?.archetype || 'Unknown';
    const displayName = displayNames === 'trimmed' ? String(rawLabel).trim() || 'Unknown' : rawLabel;
    const { key, base } = deriveArchetypeGrouping(displayName, nameCasing, emptyBaseFallback);
    const group = groups.get(key);
    if (group) {
      group.decks.push(deck);
    } else {
      groups.set(key, { base, displayName, decks: [deck] });
    }
  }
  return [...groups.values()];
}

/**
 * Order files for the index in place.
 * @param files - Built archetype files
 * @param sortMode - Producer ordering
 */
function sortFiles(files: ArchetypeFile[], sortMode: ArchetypeBuildOptions['sortMode']): void {
  if (sortMode === 'deckCountThenLabel') {
    // Python: index sorted by deckCount desc, then label asc.
    files.sort(
      (a, b) =>
        b.deckCount - a.deckCount || (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0)
    );
  } else {
    // Online + reportGenerator: deckCount desc; ties keep first-seen order
    // (Array.prototype.sort is stable).
    files.sort((a, b) => b.deckCount - a.deckCount);
  }
}

/**
 * One index entry with its thumbnails, signature cards and icons as the options ask.
 * @param file - The archetype's built file
 * @param deckTotal - Decks in the window
 * @param options - Producer shape options
 * @param lookups - Card meta and meta usage, built once per run
 * @returns The index entry
 */
function indexEntry(
  file: ArchetypeFile,
  deckTotal: number,
  options: ArchetypeBuildOptions,
  lookups: {
    cardMetaLookup: ReturnType<typeof buildCardMetaLookup> | null;
    metaUsage: ReturnType<typeof buildMetaUsage> | null;
  }
): ArchetypeIndexEntry {
  const { thumbnailConfig = null, masterReport = null, iconConfig = null } = options;
  const thumbnails = resolveArchetypeThumbnails(file.base, file.displayName, file.data, {
    config: thumbnailConfig,
    ...lookups
  });
  const fraction = deckTotal ? file.deckCount / deckTotal : 0;
  const entry: ArchetypeIndexEntry = {
    name: file.base,
    label: file.displayName || file.base.replace(/_/g, ' '),
    deckCount: file.deckCount,
    percent: options.percentMode === 'fraction6' ? Math.round(fraction * 1e6) / 1e6 : fraction,
    thumbnails
  };
  if (options.includeSignatureCards) {
    entry.signatureCards = masterReport
      ? generateSignatureCards(file.displayName, file.data, masterReport, thumbnails)
      : [];
  }
  if (iconConfig) {
    entry.icons = resolveArchetypeIcons(file.base, file.displayName, thumbnails, file.data, iconConfig);
  }
  return entry;
}

/**
 * Group decks by archetype identity, build per-archetype card reports, and
 * construct the archetype index with thumbnails / signature cards / icons.
 * @param decks - Decks with archetype labels
 * @param synonymDb - Synonym DB for card canonicalization within reports
 * @param options - Producer shape options
 * @returns Grouped files, index entries, and per-base deck lists
 */
export function buildArchetypeReports(
  decks: ArchetypeDeckInput[],
  synonymDb: SynonymDatabase | null,
  options: ArchetypeBuildOptions
): ArchetypeBuildResult {
  const { cardTypesDb = null, masterReport = null, resolveUid } = options;
  const lookups = {
    cardMetaLookup: cardTypesDb ? buildCardMetaLookup(cardTypesDb) : null,
    metaUsage: masterReport ? buildMetaUsage(masterReport) : null
  };

  const deckList = Array.isArray(decks) ? decks : [];
  const deckTotal = deckList.length;
  const minDecks = options.minDecks ?? Math.max(1, Math.ceil(deckTotal * options.minDecksFraction));
  const paged = pagedGroups(
    groupDecks(deckList, options),
    minDecks,
    options.maxArchetypes ?? Infinity,
    options.excludeGenericGroups ?? false
  );

  const tiersOf = tierCounter(deckList, synonymDb, resolveUid);
  const files: ArchetypeFile[] = [];
  const decksByBase = new Map<string, ArchetypeDeckInput[]>();
  for (const { base, displayName, decks: archetypeDecks } of paged) {
    files.push({
      base,
      displayName,
      // `deckCount` is the archetype's meta share and counts every deck the
      // archetype was played in, decklist or not. The report's denominator is
      // the narrower listed-deck count — a deck with no list can't contain a
      // card, so counting it would cap every card below 100%.
      deckCount: archetypeDecks.length,
      data: generateReportFromDecks(archetypeDecks, listedDeckCount(archetypeDecks), synonymDb, { resolveUid }),
      tiers: tiersOf(archetypeDecks)
    });
    decksByBase.set(base, archetypeDecks);
  }

  sortFiles(files, options.sortMode);
  const index = files.map(file => indexEntry(file, deckTotal, options, lookups));
  return { minDecks, deckTotal, files, index, decksByBase };
}
