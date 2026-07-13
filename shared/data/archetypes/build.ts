/**
 * Archetype report building: the ONE implementation of deck grouping by
 * archetype identity and archetype-index entry construction
 * (DB-MASTER-PLAN Phase 2, slice 5).
 *
 * Consolidates three producer copies:
 * - `.github/scripts/run-online-meta.mjs` `buildArchetypeReports` (online; the
 *   thumbnail/signature authority; case-preserving group keys, fraction percent).
 * - `functions/lib/onlineMeta/reportGenerator.ts` `buildArchetypeReports`
 *   (Functions snapshots; lowercased group keys — the D3 split-identity quirk —
 *   and a STALE thumbnail copy that retires with this move).
 * - `.github/scripts/download-tournament.py` `build_archetype_reports`
 *   (tournaments; adds icons, rounds percent to 6 decimals, sorts index by
 *   deckCount desc then label).
 *
 * Producer-specific quirks stay reproducible via {@link ArchetypeBuildOptions}
 * so legacy callers keep emitting EXACTLY their current shapes; the D2 (percent
 * scale) and D3 (casing) fixes activate at the Phase 4/6 cutover via new
 * options values, not by changing the legacy ones.
 *
 * IMPORTANT: isomorphic — no environment-specific dependencies, no I/O.
 * @module shared/data/archetypes/build
 */

import { normalizeArchetypeName, sanitizeForFilename } from '../../cardUtils';
import { canonicalizeArchetypeLabel } from './identity';
import { type DeckEntry, generateReportFromDecks, type LegacyCardReport } from '../reports/cardReport';
import type { SynonymDatabase } from '../cardIdentity';
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
}

/** How group keys and slug bases are derived — the D3 producer split. */
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
  /** Group-key/slug casing profile (D3 quirk). */
  nameCasing: ArchetypeNameCasing;
  /**
   * Minimum group size as a fraction of total decks; groups below
   * `max(1, ceil(deckTotal * fraction))` are dropped. Online uses 0.005,
   * reportGenerator `minPercent / 100`, Python 0 (no filter).
   */
  minDecksFraction: number;
  /**
   * Index `percent` representation. 'fraction' = raw deckCount/deckTotal
   * (online + reportGenerator); 'fraction6' = rounded to 6 decimals (Python).
   * The D2 0-100 `sharePct` representation arrives at the Phase 4/6 cutover.
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
}

/** A grouped archetype's report file (producers add their own filenames). */
export interface ArchetypeFile {
  base: string;
  displayName: string;
  deckCount: number;
  data: LegacyCardReport;
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
 * producer casing profile (D3 quirk).
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
  const {
    nameCasing,
    minDecksFraction,
    percentMode,
    sortMode,
    displayNames = 'raw',
    emptyBaseFallback = 'Unknown',
    thumbnailConfig = null,
    cardTypesDb = null,
    masterReport = null,
    includeSignatureCards,
    iconConfig = null
  } = options;

  const cardMetaLookup = cardTypesDb ? buildCardMetaLookup(cardTypesDb) : null;
  const metaUsage = masterReport ? buildMetaUsage(masterReport) : null;

  const deckList = Array.isArray(decks) ? decks : [];
  const deckTotal = deckList.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * minDecksFraction));

  // Group by identity key; first-seen deck fixes the display label and base.
  const groups = new Map<string, { base: string; displayName: string; decks: ArchetypeDeckInput[] }>();
  for (const deck of deckList) {
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

  const files: ArchetypeFile[] = [];
  const decksByBase = new Map<string, ArchetypeDeckInput[]>();
  for (const { base, displayName, decks: archetypeDecks } of groups.values()) {
    if (archetypeDecks.length < minDecks) {
      continue;
    }
    files.push({
      base,
      displayName,
      deckCount: archetypeDecks.length,
      data: generateReportFromDecks(archetypeDecks, archetypeDecks.length, synonymDb)
    });
    decksByBase.set(base, archetypeDecks);
  }

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

  const index: ArchetypeIndexEntry[] = files.map(file => {
    const thumbnails = resolveArchetypeThumbnails(file.base, file.displayName, file.data, {
      config: thumbnailConfig,
      cardMetaLookup,
      metaUsage
    });

    const fraction = deckTotal ? file.deckCount / deckTotal : 0;
    const entry: ArchetypeIndexEntry = {
      name: file.base,
      label: file.displayName || file.base.replace(/_/g, ' '),
      deckCount: file.deckCount,
      percent: percentMode === 'fraction6' ? Math.round(fraction * 1e6) / 1e6 : fraction,
      thumbnails
    };
    if (includeSignatureCards) {
      entry.signatureCards = masterReport
        ? generateSignatureCards(file.displayName, file.data, masterReport, thumbnails)
        : [];
    }
    if (iconConfig) {
      entry.icons = resolveArchetypeIcons(file.base, file.displayName, thumbnails, file.data, iconConfig);
    }
    return entry;
  });

  return { minDecks, deckTotal, files, index, decksByBase };
}
