/**
 * Read-time compatibility layer for the browser.
 *
 * MIGRATION DEBT, deliberately quarantined. Everything here exists to repair or
 * reinterpret artifacts written under an older contract:
 *
 * - {@link canonicalizeReport} collapses variant printings in a report that was
 *   built before the current synonym mapping existed (D5).
 * - {@link normalizeIndexPercentScale} detects an archetype index still written
 *   on the 0-1 fraction scale instead of 0-100 (D2).
 * - {@link canonicalizeCardTrendEntries} re-keys trend rows onto canonical UIDs.
 *
 * Keeping this in one named module rather than spread through the data layer is
 * the point. DB-MASTER-PLAN Phase 7/16 deletes it once every served artifact
 * comes from the release contract, and that deletion should be a `git rm`, not
 * an archaeology exercise. Nothing new belongs here: a new artifact shape is a
 * producer change, not a reader workaround.
 *
 * `canonicalizedAt`-marked payloads (rolling canonicals, D17) are already
 * build-time canonicalized and pass through UNTOUCHED — re-mapping them would
 * rewrite a period-correct historical print to today's global canonical.
 * @module src/lib/data/compat
 */

import { getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import { itemUid, parseCardUid } from '../../../shared/data/cardIdentity';
import { calculatePercentage } from '../../../shared/reportUtils.js';
import type { ArchetypeIndexEntry, CardDistributionEntry, CardItem } from '../../types';

/**
 * The identifying fields {@link canonicalizeCardTrendEntries} rewrites. Declared
 * structurally rather than imported so the trends payload type can stay with
 * the trends code.
 */
export interface CanonicalizableTrendEntry {
  key: string;
  name: string;
  set: string | null;
  number: string | null;
  appearances: number;
}

export type AnyCardItem = CardItem & {
  deckInstances?: Array<{ deckId: string; count: number; archetype?: string }>;
};

/**
 * Collapse variant printings into their canonical entry. Reports stay
 * immutable on R2; the data layer merges at read time so the page render
 * sees one row per canonical card, regardless of how the per-tournament
 * report was canonicalized when it was originally built.
 *
 * Merges `found`, `dist` buckets (by `copies`), and any `deckInstances`
 * (archetype reports). Recomputes `pct` from `(found / deckTotal) * 100` and
 * each `dist[].percent` from `(players / found) * 100`. Re-sorts by `found`
 * desc and reassigns `rank`.
 */
export function canonicalizeReport<T extends { deckTotal: number; items: AnyCardItem[] }>(
  report: T,
  db: SynonymDatabase | null
): T {
  if (!db || !report?.items?.length) {
    return report;
  }

  // "Rolling canonical" artifacts are already build-time canonicalized: their
  // items key by the event-date canonical print (a variant UID that still
  // resolves to the same global cluster identity through the synonym map).
  // Re-mapping here would rewrite that period-correct rolling print to today's
  // global canonical — destroying the historical print display — so pass through.
  if ((report as { canonicalizedAt?: string }).canonicalizedAt) {
    return report;
  }

  const grouped = new Map<string, AnyCardItem>();

  for (const item of report.items) {
    const uid = itemUid(item);
    const canonicalUid = getCanonicalCardFromData(db, uid);
    const canonicalParts = parseCardUid(canonicalUid);

    const existing = grouped.get(canonicalUid);
    if (!existing) {
      // First occurrence — clone and stamp with canonical identity. Only
      // rewrite name/set/number when a real synonym mapping applied
      // (canonicalUid !== uid); otherwise keep the item's own display fields so
      // the padded lookup UID doesn't leak into the rendered number.
      const next: AnyCardItem = { ...item, uid: canonicalUid };
      if (canonicalUid !== uid && canonicalParts) {
        next.name = canonicalParts.name;
        next.set = canonicalParts.set;
        next.number = canonicalParts.number;
      }
      if (item.dist) {
        next.dist = item.dist.map(d => ({ ...d }));
      }
      if (item.deckInstances) {
        next.deckInstances = [...item.deckInstances];
      }
      grouped.set(canonicalUid, next);
      continue;
    }

    // Merge variant into existing canonical entry.
    existing.found = (existing.found ?? 0) + (item.found ?? 0);

    const distMap = new Map<number, CardDistributionEntry>();
    for (const d of existing.dist ?? []) {
      if (d.copies === undefined) {
        continue;
      }
      distMap.set(d.copies, { ...d });
    }
    for (const d of item.dist ?? []) {
      if (d.copies === undefined) {
        continue;
      }
      const prev = distMap.get(d.copies);
      if (prev) {
        prev.players = (prev.players ?? 0) + (d.players ?? 0);
      } else {
        distMap.set(d.copies, { ...d });
      }
    }
    existing.dist = Array.from(distMap.values()).sort((a, b) => (a.copies ?? 0) - (b.copies ?? 0));

    if (item.deckInstances?.length) {
      existing.deckInstances = [...(existing.deckInstances ?? []), ...item.deckInstances];
    }
  }

  // Recompute derived stats now that variants are merged.
  for (const item of grouped.values()) {
    // A deck that ran two variant printings of one canonical card is counted in
    // each variant row's `found`, so naively summing double-counts it (pct can
    // exceed 100%). When per-deck identity is available (archetype reports carry
    // `deckInstances`), dedupe by deckId and recompute `found` from the distinct
    // decks. Otherwise (pre-aggregated master rows without deckIds) the overlap
    // can't be recovered, so clamp `found` to the deck total as a floor defense.
    if (item.deckInstances?.length) {
      const seen = new Set<string>();
      const deduped: Array<{ deckId: string; count: number; archetype?: string }> = [];
      for (const inst of item.deckInstances) {
        const id = inst?.deckId;
        if (id) {
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
        }
        deduped.push(inst);
      }
      if (deduped.length !== item.deckInstances.length) {
        item.deckInstances = deduped;
        item.found = deduped.length;
      }
    }
    if (item.found !== undefined && item.found > report.deckTotal) {
      // A producer double-counted a canonical card. Clamp so the UI stays
      // sane, but say so — silently rendering 100% would hide the regression.
      console.warn(
        `[canonicalizeReport] found (${item.found}) exceeds deckTotal (${report.deckTotal}) for ${item.uid ?? item.name}; clamping`
      );
      item.found = report.deckTotal;
    }
    item.pct = calculatePercentage(item.found ?? 0, report.deckTotal);
    if (item.dist) {
      for (const d of item.dist) {
        d.percent = calculatePercentage(d.players ?? 0, item.found ?? 0);
      }
    }
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => (b.found ?? 0) - (a.found ?? 0));
  sorted.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  return { ...report, items: sorted };
}

/**
 * Canonicalize the `cardTrends` portion of the trends payload. Updates each
 * entry's identifying fields (`key`, `set`, `number`, `name`) to canonical
 * and dedupes by canonical key (keeping the entry with higher `appearances`).
 *
 * Time-series shares are NOT re-aggregated; the trend file was built with
 * canonicalized aggregates at generation time, so the entry we keep already
 * represents the merged time series for that card.
 */
export function canonicalizeCardTrendEntries<T extends CanonicalizableTrendEntry>(
  entries: T[],
  db: SynonymDatabase
): T[] {
  const grouped = new Map<string, T>();
  for (const entry of entries) {
    const canonicalKey = getCanonicalCardFromData(db, entry.key);
    const canonicalParts = parseCardUid(canonicalKey);
    const next: T = { ...entry, key: canonicalKey };
    if (canonicalParts) {
      next.name = canonicalParts.name;
      next.set = canonicalParts.set;
      next.number = canonicalParts.number;
    }
    const prev = grouped.get(canonicalKey);
    if (!prev || (next.appearances ?? 0) > (prev.appearances ?? 0)) {
      grouped.set(canonicalKey, next);
    }
  }
  return Array.from(grouped.values());
}

/**
 * Archetype index files mix percent scales: indexes ingested before commit
 * 3939e71 store 0–100, newer ones store a 0–1 fraction. A per-value guess
 * (≤ 1 ⇒ fraction) misreads sub-1% archetypes in old files as ~90% shares
 * (e.g. Birmingham's 0.90% Sharpedo Toxtricity rendering as 89.7%), so decide
 * the scale once per file: any value above 1 means the file is already 0–100.
 */
export function normalizeIndexPercentScale(list: ArchetypeIndexEntry[]): ArchetypeIndexEntry[] {
  let max = 0;
  for (const entry of list) {
    if (typeof entry.percent === 'number' && entry.percent > max) {
      max = entry.percent;
    }
  }
  if (max === 0 || max > 1) {
    return list;
  }
  return list.map(entry => (typeof entry.percent === 'number' ? { ...entry, percent: entry.percent * 100 } : entry));
}

/**
 * Canonicalization is a full group/merge/re-sort over every item, and CardPage
 * fans `fetchArchetype` out over every archetype — so cache the result per raw
 * payload object (payloads are shared within the fetch TTL window) instead of
 * redoing the merge on every call.
 */
const canonicalizedReports = new WeakMap<object, unknown>();

export function canonicalizeReportCached<T extends { deckTotal: number; items: AnyCardItem[] }>(
  raw: T,
  db: SynonymDatabase | null
): T {
  if (!db || !raw?.items?.length) {
    return raw;
  }
  // Marked (rolling-canonical) payloads pass through untouched (see
  // canonicalizeReport) — skip the memo entirely so we return the exact object.
  if ((raw as { canonicalizedAt?: string }).canonicalizedAt) {
    return raw;
  }
  const hit = canonicalizedReports.get(raw);
  if (hit) {
    return hit as T;
  }
  const out = canonicalizeReport(raw, db);
  canonicalizedReports.set(raw, out);
  return out;
}
