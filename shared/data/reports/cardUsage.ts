/**
 * Canonical LEGACY-shape card-usage index builder — the single home for the
 * inverted "which archetypes play this card" index that production publishes as
 * `cardUsage.json`.
 *
 * Schema (legacy, what `src/lib/data.ts` reads today):
 *   `{ usage: { "<canonicalUID>": [{ slug, found, pct, dist: [...] }, ...] } }`
 *
 * Consolidated in DB-MASTER-PLAN Phase 2, slice 4. The live producer
 * (`.github/scripts/run-online-meta.ts`) imports this builder directly.
 * Python's `download-tournament.py::build_card_usage_index` is the other
 * historical producer; it retires with the report migration and is not
 * pinned here.
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
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/reports/cardUsage
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
}

/** The legacy `cardUsage.json` payload: canonical UID -> archetype usage rows. */
export interface LegacyCardUsageIndex {
  usage: Record<string, CardUsageEntry[]>;
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
      const uid = item.uid || item.name;
      if (!uid) {
        continue;
      }
      (usage[uid] ??= []).push({
        slug: file.base,
        found: item.found || 0,
        pct: item.pct || 0,
        dist: (item.dist ?? []).map(d => ({ copies: d.copies, players: d.players, percent: d.percent }))
      });
    }
  }
  return { usage };
}
