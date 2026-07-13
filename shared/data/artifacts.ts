/**
 * Serving-artifact data contract (schema v1).
 *
 * The denormalized layer built from {@link module:shared/data/contracts}
 * normalized records. These are the shapes the Phase 2 builders will emit:
 * card usage reports, the per-card archetype usage index, Day 2 conversion, and
 * the archetype index. They carry PERCENTAGES (0-100, `Pct` suffix), copy-count
 * DISTRIBUTIONS, explicit sort order, and 1-based ranks — everything the
 * normalized layer deliberately leaves out.
 *
 * Contract decisions this file freezes (see .scratch/db-migration design docs):
 * - Percentages use a `Pct` suffix and are 0-100 (fixes the fraction-vs-percent
 *   divergence D2); every percentage is {@link calculatePercentage} of a count
 *   over a total, rounded to 2 decimals, so byte output never depends on float
 *   accumulation order.
 * - Card set/number on a report item are DERIVED from the canonical UID (fixes
 *   D4) via {@link parseCardUid} and validated against it — never carried from a
 *   pre-synonym printing.
 * - Items sort by an explicit total order — usagePct desc, foundCount desc, name
 *   asc, uid asc (fixes the missing tie-breaker D9) — so input deck order cannot
 *   change the bytes. Ranks are assigned 1-based after sorting.
 * - The archetype index carries all three presentation arrays (thumbnails,
 *   signatureCards, icons) per D8; Phase 2 fills them, so the reference builder
 *   emits empty arrays for now.
 * - Byte-compatibility with the CURRENT legacy artifacts is NOT a goal here;
 *   these are the corrected schemas the Phase 2 producer cutover adopts.
 *
 * The builders here (`buildCardReport`, `buildArchetypeIndex`,
 * `buildConversionIndex`, `buildCardUsageIndex`) are the REFERENCE
 * implementations Phase 2 migrates the online, Python, and Function producers
 * onto. They compute artifacts purely from normalized {@link Deck} records and
 * are deterministic: permuting the input decks yields byte-identical output.
 *
 * IMPORTANT: like {@link module:shared/data/contracts}, this module is
 * environment-neutral (browser + Node + Workers). It must not import
 * `node:crypto` or any environment-specific dependency.
 * @module shared/data/artifacts
 */

import { calculatePercentage } from '../reportUtils';
import {
  archetypeKey,
  archetypeSlug,
  makeArchetypeIdentity,
  parseCardUid,
  type ArchetypeIdentity,
  type CardCategory,
  type Deck,
  type DeckCard,
  type EnergyType,
  type Participant,
  type TrainerType,
  type ValidationResult
} from './contracts';

/** Schema version stamped on every serving artifact. */
export const ARTIFACT_SCHEMA_VERSION = 1;

/**
 * Percentages are compared against {@link calculatePercentage} during
 * validation. Both the stored value and the recomputation are 2-decimal, so any
 * genuine mismatch differs by at least 0.01; this epsilon absorbs only the
 * representational noise of two equal 2dp numbers.
 */
const PCT_EPSILON = 0.005;

// ============================================================================
// Artifact types
// ============================================================================

/** One copy-count bucket in a card's distribution. `percentPct` is 0-100. */
export interface DistEntry {
  /** Number of copies of the card in a deck (>=1). */
  copies: number;
  /** Number of decks that ran exactly this many copies (>=1). */
  players: number;
  /** `players` as a percentage of the card's foundCount, 0-100. */
  percentPct: number;
}

/**
 * One row of a {@link CardReport}: a canonical card and how the reported decks
 * used it. `set`/`number` are derived from `uid` and null for a bare-name card
 * (basic energy). Category/subtype fields are the card's intrinsic
 * classification, present only when they apply.
 */
export interface CardReportItem {
  /** 1-based position in the sorted report. */
  rank: number;
  /** Canonical display name. */
  name: string;
  /** Canonical UID (`Name::SET::NUMBER` or a bare name). */
  uid: string;
  /** Set segment of `uid`, or null for a bare-name card. */
  set: string | null;
  /** Number segment of `uid`, or null for a bare-name card. */
  number: string | null;
  /** Decks that ran the card (counted once per deck). */
  foundCount: number;
  /** Total decks in the report (mirrors {@link CardReport.deckTotal}). */
  deckTotal: number;
  /** `foundCount` as a percentage of `deckTotal`, 0-100. */
  usagePct: number;
  /** Copy-count distribution, ascending by copies. */
  dist: DistEntry[];
  category?: CardCategory;
  trainerType?: TrainerType;
  energyType?: EnergyType;
  aceSpec?: boolean;
  /** Single uppercase regulation-mark letter (e.g. "H"). */
  regulationMark?: string;
}

/** A card usage report over a set of decks. */
export interface CardReport {
  schemaVersion: number;
  /** Total decks the report summarizes. */
  deckTotal: number;
  /** Cards sorted by the explicit total order; ranks are 1-based and contiguous. */
  items: CardReportItem[];
}

/** One archetype's usage of a card, in a {@link CardUsageIndex}. */
export interface CardUsageEntry {
  /** Archetype slug this usage row belongs to. */
  slug: string;
  /** Decks of this archetype that ran the card. */
  foundCount: number;
  /** `foundCount` as a percentage of the archetype's deck total, 0-100. */
  usagePct: number;
  /** Copy-count distribution within this archetype, ascending by copies. */
  dist: DistEntry[];
}

/**
 * Per-card index of which archetypes run a card. `usage` is keyed by canonical
 * UID; each value lists the archetypes that ran it (sorted by slug). Built from
 * per-archetype {@link CardReport}s, so counts are archetype-local.
 */
export interface CardUsageIndex {
  schemaVersion: number;
  usage: Record<string, CardUsageEntry[]>;
}

/** Day 1 / Day 2 counts for one card. */
export interface ConversionCounts {
  /** Decks that ran the card (Day 1). */
  day1: number;
  /** Day 2 decks that ran the card. */
  day2: number;
}

/**
 * Day 2 conversion index. `day1Total`/`day2Total` are the deck populations;
 * `cards` maps a canonical UID to its Day 1 / Day 2 deck counts. Only meaningful
 * for an event with a Day 2 — {@link validateConversionIndex} rejects an index
 * whose `day2Total` is zero (matching the legacy "no conversion without Day 2").
 */
export interface ConversionIndex {
  schemaVersion: number;
  day1Total: number;
  day2Total: number;
  cards: Record<string, ConversionCounts>;
}

/** One archetype row in an {@link ArchetypeIndex}. */
export interface ArchetypeIndexEntry {
  identity: ArchetypeIdentity;
  /** Decks classified into this archetype. */
  deckCount: number;
  /** `deckCount` as a percentage of the total decks, 0-100. */
  sharePct: number;
  /** Presentation arrays (D8); Phase 2 fills them, empty for now. */
  thumbnails: string[];
  signatureCards: string[];
  icons: string[];
}

/** The archetype index, sorted by deckCount desc then identity key asc. */
export interface ArchetypeIndex {
  schemaVersion: number;
  archetypes: ArchetypeIndexEntry[];
}

/** A per-archetype {@link CardReport}, keyed by slug — input to {@link buildCardUsageIndex}. */
export interface ArchetypeCardReport {
  slug: string;
  report: CardReport;
}

// ============================================================================
// Ordering (explicit total orders so input order cannot change bytes)
// ============================================================================

/**
 * The card report total order (D9): usagePct desc, foundCount desc, name asc,
 * uid asc. `uid` is unique within a report, so this is a strict total order —
 * the result is identical regardless of input deck order.
 */
function compareCardItems(left: CardReportItem, right: CardReportItem): number {
  if (right.usagePct !== left.usagePct) {
    return right.usagePct - left.usagePct;
  }
  if (right.foundCount !== left.foundCount) {
    return right.foundCount - left.foundCount;
  }
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }
  return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0;
}

/** The archetype index total order: deckCount desc, then identity key asc. */
function compareArchetypeEntries(left: ArchetypeIndexEntry, right: ArchetypeIndexEntry): number {
  if (right.deckCount !== left.deckCount) {
    return right.deckCount - left.deckCount;
  }
  const a = left.identity.key;
  const b = right.identity.key;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Plain (code-point) string comparator; avoids locale-dependent localeCompare. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ============================================================================
// Reference builders
// ============================================================================

/** A canonical card's intrinsic, deck-independent metadata for report items. */
interface CardMeta {
  name: string;
  category: CardCategory;
  trainerType?: TrainerType;
  energyType?: EnergyType;
  aceSpec?: boolean;
  regulationMark?: string;
}

/**
 * Extract a card's intrinsic classification. Subtype fields are dropped unless
 * they apply to the category; `aceSpec` is emitted only when true and
 * `regulationMark` only when present, so canonical serialization stays compact.
 */
function extractMeta(card: DeckCard): CardMeta {
  return {
    name: card.canonical.name,
    category: card.category,
    trainerType: card.category === 'trainer' ? card.trainerType ?? undefined : undefined,
    energyType: card.category === 'energy' ? card.energyType ?? undefined : undefined,
    aceSpec: card.aceSpec === true ? true : undefined,
    regulationMark: card.regulationMark ?? undefined
  };
}

/** Build a distribution from a copy-count histogram, ascending by copies. */
function buildDist(histogram: Map<number, number>, foundCount: number): DistEntry[] {
  return Array.from(histogram.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([copies, players]) => ({ copies, players, percentPct: calculatePercentage(players, foundCount) }));
}

/**
 * Build a card usage report from normalized decks — the reference
 * implementation Phase 2 migrates the producers onto. Each canonical card is
 * counted once per deck; `usagePct` is {@link calculatePercentage} of foundCount
 * over deckTotal; the copy-count distribution comes from a per-card histogram;
 * items are sorted by the explicit tie-breakers and then ranked 1-based;
 * set/number are derived from the canonical UID.
 * @param decks - Normalized decks (all counted; deckTotal is their length)
 * @returns The card report
 */
export function buildCardReport(decks: Deck[]): CardReport {
  const deckTotal = decks.length;
  const foundCounts = new Map<string, number>();
  const histograms = new Map<string, Map<number, number>>();
  const metaByUid = new Map<string, CardMeta>();

  for (const deck of decks) {
    // Collapse a deck to (canonical uid -> copies), so a canonical card counts
    // once per deck even if it somehow appears twice.
    const perDeck = new Map<string, number>();
    for (const card of deck.cards) {
      const { uid } = card.canonical;
      perDeck.set(uid, (perDeck.get(uid) ?? 0) + card.count);
      if (!metaByUid.has(uid)) {
        metaByUid.set(uid, extractMeta(card));
      }
    }
    for (const [uid, copies] of perDeck) {
      foundCounts.set(uid, (foundCounts.get(uid) ?? 0) + 1);
      let histogram = histograms.get(uid);
      if (!histogram) {
        histogram = new Map<number, number>();
        histograms.set(uid, histogram);
      }
      histogram.set(copies, (histogram.get(copies) ?? 0) + 1);
    }
  }

  const items: CardReportItem[] = Array.from(foundCounts.entries()).map(([uid, foundCount]) => {
    const parsed = parseCardUid(uid);
    const meta = metaByUid.get(uid) as CardMeta;
    return {
      rank: 0,
      name: meta.name,
      uid,
      set: parsed ? parsed.set : null,
      number: parsed ? parsed.number : null,
      foundCount,
      deckTotal,
      usagePct: calculatePercentage(foundCount, deckTotal),
      dist: buildDist(histograms.get(uid) as Map<number, number>, foundCount),
      category: meta.category,
      trainerType: meta.trainerType,
      energyType: meta.energyType,
      aceSpec: meta.aceSpec,
      regulationMark: meta.regulationMark
    };
  });

  items.sort(compareCardItems);
  items.forEach((item, index) => {
    item.rank = index + 1;
  });

  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, deckTotal, items };
}

/**
 * Group decks by archetype and build one {@link CardReport} per archetype,
 * sorted by slug. This is the input {@link buildCardUsageIndex} consumes;
 * counts are therefore archetype-local.
 * @param decks - Normalized decks
 * @returns Per-archetype card reports, sorted by slug
 */
export function buildArchetypeCardReports(decks: Deck[]): ArchetypeCardReport[] {
  const byKey = new Map<string, Deck[]>();
  for (const deck of decks) {
    const key = deck.archetype.key;
    const group = byKey.get(key);
    if (group) {
      group.push(deck);
    } else {
      byKey.set(key, [deck]);
    }
  }
  const reports = Array.from(byKey.entries()).map(([key, group]) => ({
    slug: archetypeSlug(key),
    report: buildCardReport(group)
  }));
  reports.sort((left, right) => compareStrings(left.slug, right.slug));
  return reports;
}

/**
 * Build the per-card archetype usage index from per-archetype card reports. Each
 * report item becomes one archetype-local usage row under its canonical UID; the
 * rows for a UID are sorted by slug. The `usage` map is keyed by UID; canonical
 * serialization sorts those keys, so output is deterministic.
 * @param archetypeReports - Per-archetype card reports (see {@link buildArchetypeCardReports})
 * @returns The card usage index
 */
export function buildCardUsageIndex(archetypeReports: ArchetypeCardReport[]): CardUsageIndex {
  const usage: Record<string, CardUsageEntry[]> = {};
  const ordered = [...archetypeReports].sort((left, right) => compareStrings(left.slug, right.slug));
  for (const { slug, report } of ordered) {
    for (const item of report.items) {
      const rows = usage[item.uid] ?? (usage[item.uid] = []);
      rows.push({ slug, foundCount: item.foundCount, usagePct: item.usagePct, dist: item.dist });
    }
  }
  for (const uid of Object.keys(usage)) {
    usage[uid].sort((left, right) => compareStrings(left.slug, right.slug));
  }
  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, usage };
}

/**
 * Build the Day 2 conversion index. Day 2 membership comes from a participant's
 * `flags.madePhase2`; a canonical card is counted once per deck. The resulting
 * index is only valid when at least one deck made Day 2 (see
 * {@link validateConversionIndex}).
 * @param decks - Normalized decks
 * @param participants - Participants (source of the Day 2 flag)
 * @returns The conversion index
 */
export function buildConversionIndex(decks: Deck[], participants: Participant[]): ConversionIndex {
  const madePhase2 = new Map<string, boolean>();
  for (const participant of participants) {
    madePhase2.set(participant.participantId, participant.flags.madePhase2 === true);
  }

  let day1Total = 0;
  let day2Total = 0;
  const cards: Record<string, ConversionCounts> = {};

  for (const deck of decks) {
    const isDay2 = madePhase2.get(deck.participantId) === true;
    day1Total += 1;
    if (isDay2) {
      day2Total += 1;
    }
    const seen = new Set<string>();
    for (const card of deck.cards) {
      const { uid } = card.canonical;
      if (seen.has(uid)) {
        continue;
      }
      seen.add(uid);
      const entry = cards[uid] ?? (cards[uid] = { day1: 0, day2: 0 });
      entry.day1 += 1;
      if (isDay2) {
        entry.day2 += 1;
      }
    }
  }

  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, day1Total, day2Total, cards };
}

/**
 * Build the archetype index. Decks are grouped by archetype key; the display
 * label is chosen deterministically as the lexicographically smallest label in
 * the group so input order cannot change bytes (Phase 2 presentation may later
 * override it with a curated label). `sharePct` is {@link calculatePercentage}
 * of deckCount over the total; entries sort by deckCount desc then key asc. The
 * three presentation arrays are present but empty (D8; Phase 2 fills them).
 * @param decks - Normalized decks
 * @returns The archetype index
 */
export function buildArchetypeIndex(decks: Deck[]): ArchetypeIndex {
  const deckTotal = decks.length;
  const groups = new Map<string, { displayName: string; deckCount: number }>();
  for (const deck of decks) {
    const key = deck.archetype.key;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { displayName: deck.archetype.displayName, deckCount: 1 });
    } else {
      group.deckCount += 1;
      if (deck.archetype.displayName < group.displayName) {
        group.displayName = deck.archetype.displayName;
      }
    }
  }

  const archetypes: ArchetypeIndexEntry[] = Array.from(groups.values()).map(group => ({
    identity: makeArchetypeIdentity(group.displayName),
    deckCount: group.deckCount,
    sharePct: calculatePercentage(group.deckCount, deckTotal),
    thumbnails: [],
    signatureCards: [],
    icons: []
  }));
  archetypes.sort(compareArchetypeEntries);

  return { schemaVersion: ARTIFACT_SCHEMA_VERSION, archetypes };
}

// ============================================================================
// Runtime validation
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** True when a stored percentage agrees with its recomputation (within 2dp noise). */
function pctAgrees(stored: unknown, expected: number): boolean {
  return typeof stored === 'number' && Number.isFinite(stored) && Math.abs(stored - expected) <= PCT_EPSILON;
}

/**
 * Validate a copy-count distribution against a card's foundCount: buckets are
 * ascending and unique by copies, player counts sum to foundCount, and each
 * `percentPct` agrees with `players / foundCount`.
 */
function validateDist(dist: unknown, foundCount: number, path: string, errors: string[]): void {
  if (!Array.isArray(dist)) {
    errors.push(`${path}: expected array`);
    return;
  }
  let playerSum = 0;
  let prevCopies: number | null = null;
  dist.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath}: expected object`);
      return;
    }
    const { copies, players, percentPct } = entry;
    if (!isInteger(copies) || copies < 1) {
      errors.push(`${entryPath}.copies: expected integer >= 1`);
    } else {
      if (prevCopies !== null && copies <= prevCopies) {
        errors.push(`${entryPath}.copies: distribution not ascending/unique by copies`);
      }
      prevCopies = copies;
    }
    if (!isInteger(players) || players < 1) {
      errors.push(`${entryPath}.players: expected integer >= 1`);
    } else {
      playerSum += players;
      if (!pctAgrees(percentPct, calculatePercentage(players, foundCount))) {
        errors.push(
          `${entryPath}.percentPct: ${String(percentPct)} inconsistent with players/foundCount ` +
            `(${calculatePercentage(players, foundCount)})`
        );
      }
    }
  });
  if (playerSum !== foundCount) {
    errors.push(`${path}: distribution player counts sum to ${playerSum}, expected foundCount ${foundCount}`);
  }
}

/** Shared canonical-identity check: uid parses and its name/set/number agree. */
function validateUidMeta(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  const { uid, name, set, number } = record;
  if (typeof uid !== 'string' || uid.length === 0) {
    errors.push(`${path}.uid: expected non-empty string`);
    return;
  }
  const parsed = parseCardUid(uid);
  if (!parsed) {
    errors.push(`${path}.uid: unparseable UID "${uid}"`);
    return;
  }
  if (name !== parsed.name) {
    errors.push(`${path}.name: "${String(name)}" does not match UID name "${parsed.name}"`);
  }
  if ((set ?? null) !== parsed.set) {
    errors.push(`${path}.set: "${String(set)}" does not match UID set "${String(parsed.set)}"`);
  }
  if ((number ?? null) !== parsed.number) {
    errors.push(`${path}.number: "${String(number)}" does not match UID number "${String(parsed.number)}"`);
  }
}

function validateCardReportItem(
  item: unknown,
  index: number,
  deckTotal: number,
  errors: string[]
): CardReportItem | null {
  const path = `items[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: expected object`);
    return null;
  }
  validateUidMeta(item, path, errors);
  const { foundCount, usagePct } = item;
  if (!isInteger(foundCount) || foundCount < 1) {
    errors.push(`${path}.foundCount: expected integer >= 1`);
  } else if (foundCount > deckTotal) {
    errors.push(`${path}.foundCount: ${foundCount} exceeds deckTotal ${deckTotal}`);
  }
  if (item.deckTotal !== deckTotal) {
    errors.push(`${path}.deckTotal: ${String(item.deckTotal)} does not match report deckTotal ${deckTotal}`);
  }
  if (isInteger(foundCount) && !pctAgrees(usagePct, calculatePercentage(foundCount, deckTotal))) {
    errors.push(
      `${path}.usagePct: ${String(usagePct)} inconsistent with foundCount/deckTotal ` +
        `(${calculatePercentage(foundCount as number, deckTotal)})`
    );
  }
  if (isInteger(foundCount)) {
    validateDist(item.dist, foundCount, `${path}.dist`, errors);
  }
  if (!isInteger(item.rank)) {
    errors.push(`${path}.rank: expected integer`);
  }
  return isRecord(item) ? (item as unknown as CardReportItem) : null;
}

/**
 * Validate an unknown value as a {@link CardReport}: schema version, deckTotal,
 * and every item invariant — foundCount <= deckTotal, usagePct consistency,
 * distribution players sum to foundCount, set/number agree with UID — plus the
 * report-wide invariants: ranks are 1-based and contiguous, and items obey the
 * explicit total order. All errors are collected.
 * @param value - The value to validate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateCardReport(value: unknown): ValidationResult<CardReport> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`root.schemaVersion: expected ${ARTIFACT_SCHEMA_VERSION}`);
  }
  const { deckTotal } = value;
  if (!isInteger(deckTotal) || deckTotal < 0) {
    errors.push('root.deckTotal: expected integer >= 0');
  }
  if (!Array.isArray(value.items)) {
    errors.push('root.items: expected array');
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as CardReport };
  }

  const total = isInteger(deckTotal) ? deckTotal : 0;
  const items: (CardReportItem | null)[] = value.items.map((item, index) =>
    validateCardReportItem(item, index, total, errors)
  );

  items.forEach((item, index) => {
    if (item && item.rank !== index + 1) {
      errors.push(`items[${index}].rank: expected ${index + 1}, got ${String(item.rank)}`);
    }
  });
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev && cur && compareCardItems(prev, cur) > 0) {
      errors.push(`items: not in canonical sort order (index ${i})`);
      break;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as CardReport };
}

/**
 * Validate an unknown value as a {@link CardUsageIndex}: each key parses as a
 * canonical UID; each usage row has an archetype slug, a valid foundCount and
 * usagePct, and a distribution whose players sum to foundCount; rows for a UID
 * are sorted by slug. usagePct cannot be re-derived here (the archetype deck
 * total is not stored), so only its range is checked.
 * @param value - The value to validate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateCardUsageIndex(value: unknown): ValidationResult<CardUsageIndex> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`root.schemaVersion: expected ${ARTIFACT_SCHEMA_VERSION}`);
  }
  if (!isRecord(value.usage)) {
    errors.push('root.usage: expected object');
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as CardUsageIndex };
  }

  for (const uid of Object.keys(value.usage)) {
    const path = `usage["${uid}"]`;
    if (!parseCardUid(uid)) {
      errors.push(`${path}: unparseable UID key "${uid}"`);
    }
    const rows = value.usage[uid];
    if (!Array.isArray(rows) || rows.length === 0) {
      errors.push(`${path}: expected non-empty array`);
      continue;
    }
    let prevSlug: string | null = null;
    rows.forEach((row, index) => {
      const rowPath = `${path}[${index}]`;
      if (!isRecord(row)) {
        errors.push(`${rowPath}: expected object`);
        return;
      }
      const { slug, foundCount, usagePct } = row;
      if (typeof slug !== 'string' || slug.length === 0) {
        errors.push(`${rowPath}.slug: expected non-empty string`);
      } else {
        if (prevSlug !== null && slug <= prevSlug) {
          errors.push(`${rowPath}.slug: usage rows not ascending/unique by slug`);
        }
        prevSlug = slug;
      }
      if (!isInteger(foundCount) || foundCount < 1) {
        errors.push(`${rowPath}.foundCount: expected integer >= 1`);
      }
      if (typeof usagePct !== 'number' || !Number.isFinite(usagePct) || usagePct < 0 || usagePct > 100) {
        errors.push(`${rowPath}.usagePct: expected a finite number in [0, 100]`);
      }
      if (isInteger(foundCount)) {
        validateDist(row.dist, foundCount, `${rowPath}.dist`, errors);
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as CardUsageIndex };
}

/**
 * Validate an unknown value as a {@link ConversionIndex}: totals are
 * non-negative integers, `day2Total` is positive (an index with no Day 2 is not
 * a valid conversion index) and does not exceed `day1Total`, and every card's
 * counts satisfy `day2 <= day1`, `day1 <= day1Total`, and `day2 <= day2Total`.
 * @param value - The value to validate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateConversionIndex(value: unknown): ValidationResult<ConversionIndex> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`root.schemaVersion: expected ${ARTIFACT_SCHEMA_VERSION}`);
  }
  const { day1Total, day2Total } = value;
  if (!isInteger(day1Total) || day1Total < 0) {
    errors.push('root.day1Total: expected integer >= 0');
  }
  if (!isInteger(day2Total) || day2Total < 1) {
    errors.push('root.day2Total: expected integer >= 1 (a conversion index requires a Day 2)');
  }
  if (isInteger(day1Total) && isInteger(day2Total) && day2Total > day1Total) {
    errors.push(`root.day2Total: ${day2Total} exceeds day1Total ${day1Total}`);
  }
  if (!isRecord(value.cards)) {
    errors.push('root.cards: expected object');
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as ConversionIndex };
  }

  for (const uid of Object.keys(value.cards)) {
    const path = `cards["${uid}"]`;
    if (!parseCardUid(uid)) {
      errors.push(`${path}: unparseable UID key "${uid}"`);
    }
    const counts = value.cards[uid];
    if (!isRecord(counts)) {
      errors.push(`${path}: expected object`);
      continue;
    }
    const { day1, day2 } = counts;
    if (!isInteger(day1) || day1 < 1) {
      errors.push(`${path}.day1: expected integer >= 1`);
    }
    if (!isInteger(day2) || day2 < 0) {
      errors.push(`${path}.day2: expected integer >= 0`);
    }
    if (isInteger(day1) && isInteger(day2) && day2 > day1) {
      errors.push(`${path}.day2: ${day2} exceeds day1 ${day1}`);
    }
    if (isInteger(day1) && isInteger(day1Total) && day1 > day1Total) {
      errors.push(`${path}.day1: ${day1} exceeds day1Total ${day1Total}`);
    }
    if (isInteger(day2) && isInteger(day2Total) && day2 > day2Total) {
      errors.push(`${path}.day2: ${day2} exceeds day2Total ${day2Total}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as ConversionIndex };
}

/** Validate one archetype identity triple (key/slug derive from the display name). */
function validateIdentity(identity: unknown, path: string, errors: string[]): void {
  if (!isRecord(identity)) {
    errors.push(`${path}: expected object`);
    return;
  }
  const { key, displayName, slug } = identity;
  if (typeof key !== 'string' || typeof displayName !== 'string' || typeof slug !== 'string') {
    errors.push(`${path}: key, displayName, and slug must all be strings`);
    return;
  }
  const expectedKey = archetypeKey(displayName);
  if (key !== expectedKey) {
    errors.push(`${path}.key: "${key}" does not match derived key "${expectedKey}"`);
  }
  const expectedSlug = archetypeSlug(key);
  if (slug !== expectedSlug) {
    errors.push(`${path}.slug: "${slug}" does not match derived slug "${expectedSlug}"`);
  }
}

/**
 * Validate an unknown value as an {@link ArchetypeIndex}. Each deck belongs to
 * exactly one archetype, so the deck total is recovered as the sum of the
 * deckCounts and used to check each `sharePct`. Also checks identity derivation,
 * that all three presentation arrays are present (D8), and the deckCount-desc
 * then key-asc ordering.
 * @param value - The value to validate
 * @returns `{ ok: true, value }` or `{ ok: false, errors }`
 */
export function validateArchetypeIndex(value: unknown): ValidationResult<ArchetypeIndex> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['root: expected object'] };
  }
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`root.schemaVersion: expected ${ARTIFACT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.archetypes)) {
    errors.push('root.archetypes: expected array');
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as ArchetypeIndex };
  }

  const entries = value.archetypes;
  let deckTotal = 0;
  for (const entry of entries) {
    if (isRecord(entry) && isInteger(entry.deckCount)) {
      deckTotal += entry.deckCount;
    }
  }

  entries.forEach((entry, index) => {
    const path = `archetypes[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path}: expected object`);
      return;
    }
    validateIdentity(entry.identity, `${path}.identity`, errors);
    const { deckCount, sharePct } = entry;
    if (!isInteger(deckCount) || deckCount < 1) {
      errors.push(`${path}.deckCount: expected integer >= 1`);
    } else if (!pctAgrees(sharePct, calculatePercentage(deckCount, deckTotal))) {
      errors.push(
        `${path}.sharePct: ${String(sharePct)} inconsistent with deckCount/deckTotal ` +
          `(${calculatePercentage(deckCount, deckTotal)})`
      );
    }
    for (const field of ['thumbnails', 'signatureCards', 'icons'] as const) {
      if (!Array.isArray(entry[field])) {
        errors.push(`${path}.${field}: expected array`);
      }
    }
  });

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (isRecord(prev) && isRecord(cur) && compareArchetypeEntries(prev as unknown as ArchetypeIndexEntry, cur as unknown as ArchetypeIndexEntry) > 0) {
      errors.push(`archetypes: not in canonical sort order (index ${i})`);
      break;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: value as unknown as ArchetypeIndex };
}
