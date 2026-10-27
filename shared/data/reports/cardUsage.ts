/**
 * Card-usage index builder — the single home for the
 * inverted "which archetypes play this card" index that production publishes as
 * `cardUsage.json`.
 *
 * Schema (legacy, what `src/lib/data.ts` reads today):
 *   `{ usage: { "<canonicalUID>": [{ slug, found, pct, dist: [...] }, ...] } }`
 *
 * The index is built from per-archetype card reports whose items are already
 * synonym-canonicalized (their `uid` is the canonical key directly), so this
 * builder performs no synonym resolution or printing merge — it inverts.
 *
 * Ordering: the `usage` map keys and each usage array follow the input archetype
 * order (the online producer sorts archetype files by deck count descending, so
 * the highest-share archetype's rows come first). This preserves the live
 * producer's ordering exactly — introducing a found-desc/slug sort here would
 * diverge from the pinned `.mjs` output, so it is intentionally NOT done.
 *
 * This module is environment-neutral.
 */

/** One copy-count bucket of a usage row's distribution (legacy `percent` 0-100). */
export interface UsageDistEntry {
  copies: number;
  players: number;
  percent: number;
}

/**
 * A single per-archetype card report item consumed by
 * {@link buildCardUsageIndex}. Only these fields are read; production report
 * items (see {@link module:shared/data/reports/cardReport}.ReportItem) carry
 * more and are structurally assignable.
 */
export interface UsageReportItem {
  /** Canonical UID (`Name::SET::NUMBER`); falls back to {@link name} when absent. */
  uid?: string;
  /** Card name — the usage key when {@link uid} is missing (bare-name cards). */
  name?: string;
  /** Decks of this archetype that ran the card. */
  found?: number;
  /** {@link found} as a percentage of the archetype's deck total, 0-100. */
  pct?: number;
  /** Copy-count distribution within this archetype. */
  dist?: readonly UsageDistEntry[] | null;
}

/**
 * The finish tiers the card page ranks lists by, besides "all" (which is
 * `found`). `cardUsage.json` names them in `tiers` when its rows carry counts.
 */
export const USAGE_TIERS = ['top50', 'top25', 'winner'] as const;

/** One archetype's usage of a card in a {@link LegacyCardUsageIndex}. */
export interface CardUsageEntry {
  /** Archetype slug (the archetype folder base name). */
  slug: string;
  /** Decks of this archetype that ran the card. */
  found: number;
  /** {@link found} as a percentage of the archetype's deck total, 0-100. */
  pct: number;
  /** Copy-count distribution within this archetype. */
  dist: UsageDistEntry[];
  /** Of {@link found}, decks in each {@link USAGE_TIERS} tier; trailing zeros dropped, absent when all zero. */
  t?: number[];
}

/** The legacy `cardUsage.json` payload: canonical UID -> archetype usage rows. */
export interface LegacyCardUsageIndex {
  usage: Record<string, CardUsageEntry[]>;
  /** Present when rows carry tier counts (`t`), in this order. */
  tiers?: string[];
}

/**
 * One archetype's card report, as fed to {@link buildCardUsageIndex}: the
 * archetype slug plus its report (only `items` is read).
 */
export interface ArchetypeUsageSource {
  /** Archetype slug (the folder base name). */
  base: string;
  /** The archetype's card report; only `items` is consumed. */
  data?: { items?: readonly UsageReportItem[] | null } | null;
  /** Usage key -> deck counts per {@link USAGE_TIERS} tier (see {@link countUsageTiers}). */
  tiers?: ReadonlyMap<string, number[]>;
}

const usageKey = (item: UsageReportItem): string | undefined => item.uid || item.name;

/**
 * Per usage key, how many of an archetype's decks in each {@link USAGE_TIERS}
 * tier ran the card. `report` must key cards the way the archetype's own
 * report does, so the tier counts line up with its `found`.
 * @param decks - The archetype's decks
 * @param report - Builds report items for a subset of those decks
 */
export function countUsageTiers<T extends { successTags?: readonly string[] | null }>(
  decks: readonly T[],
  report: (subset: T[]) => readonly UsageReportItem[]
): Map<string, number[]> {
  const counts = new Map<string, number[]>();
  USAGE_TIERS.forEach((tier, index) => {
    const subset = decks.filter(deck => deck.successTags?.some(tag => String(tag).toLowerCase() === tier));
    for (const item of report(subset)) {
      const key = usageKey(item);
      if (key && item.found) {
        const row = counts.get(key) ?? [0, 0, 0];
        row[index] = item.found;
        counts.set(key, row);
      }
    }
  });
  return counts;
}

/** Drop trailing zeros, so most rows carry one or two numbers and many none. */
function trimCounts(counts: readonly number[] = []): number[] | undefined {
  let end = counts.length;
  while (end > 0 && !counts[end - 1]) {
    end--;
  }
  return end ? counts.slice(0, end) : undefined;
}

function usageEntry(file: ArchetypeUsageSource, item: UsageReportItem, uid: string): CardUsageEntry {
  const entry: CardUsageEntry = {
    slug: file.base,
    found: item.found || 0,
    pct: item.pct || 0,
    dist: (item.dist ?? []).map(d => ({ copies: d.copies, players: d.players, percent: d.percent }))
  };
  const t = trimCounts(file.tiers?.get(uid));
  if (t) {
    entry.t = t;
  }
  return entry;
}

/**
 * Build the legacy `cardUsage.json` inverted index from per-archetype card
 * reports. Each report item becomes one usage row (`{ slug, found, pct, dist }`)
 * under its canonical UID. Report items are already synonym-canonicalized, so
 * their `uid` is the canonical key directly; no resolution or merge happens
 * here. Missing `found`/`pct` default to 0 and a missing `dist` to `[]`, exactly
 * matching the online producer's defensive reads. Rows and keys keep the input
 * archetype order (see the module note on ordering).
 * @param archetypeFiles - Per-archetype card reports, in the producer's order
 * @returns The legacy card usage index `{ usage }`
 */
export function buildCardUsageIndex(archetypeFiles: readonly ArchetypeUsageSource[]): LegacyCardUsageIndex {
  const usage: Record<string, CardUsageEntry[]> = {};
  for (const file of archetypeFiles) {
    for (const item of file.data?.items ?? []) {
      const uid = usageKey(item);
      if (!uid) {
        continue;
      }
      (usage[uid] ??= []).push(usageEntry(file, item, uid));
    }
  }
  return archetypeFiles.some(file => file.tiers) ? { usage, tiers: [...USAGE_TIERS] } : { usage };
}
