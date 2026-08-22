/**
 * Rotation snapshots: frozen pre-rotation reports served from
 * `/reports/Snapshots/{date}/`.
 *
 * The index is fetched at most once per session and pinned even on failure —
 * an absent index means "no snapshots published", which every caller already
 * handles, and retrying it on each card view would cost a request per render
 * for a file that changes twice a year.
 * @module src/lib/data/snapshots
 */

import { dataClient } from './client';
import { setNumberKey } from './paths';

const { fetchJsonOptional } = dataClient;

/**
 * Maps rotated cards and archetypes to the snapshot containing them. Built by
 * scripts/build-rotation-snapshots.ts. See functions/lib/onlineMeta/snapshotIndexBuilder.ts
 * for the schema and the "canonical wins" exclusion rule.
 */
export interface SnapshotIndex {
  generatedAt: string;
  rotations: { date: string; label?: string; snapshotPath: string }[];
  /** Canonical card UID (Name::SET::NUMBER) → rotation date */
  cards: Record<string, string>;
  /** SET::NUMBER (uppercase, leading zeros stripped) → rotation date */
  cardsBySetNumber: Record<string, string>;
  /** Archetype slug → rotation date */
  archetypes: Record<string, string>;
}

let snapshotIndexPromise: Promise<SnapshotIndex | null> | null = null;

/**
 * Lazy fetch + module-level cache for the rotation index. Used by CardPage and
 * ArchetypePage to decide whether a missing card/archetype has a snapshot to
 * fall back to. Returns null if the index hasn't been generated yet (e.g. in
 * dev before running the snapshot script) so the fallback gracefully no-ops.
 *
 * Only successful resolutions are cached: a transient network failure must not
 * permanently disable the fallback for the lifetime of the page.
 */
export function fetchRotationIndex(): Promise<SnapshotIndex | null> {
  if (!snapshotIndexPromise) {
    const attempt = fetchJsonOptional<SnapshotIndex>('/reports/Snapshots/index.json').catch(() => null);
    snapshotIndexPromise = attempt;
    attempt.then(value => {
      if (value === null) {
        // Treat "no snapshot index yet" as a soft miss but don't pin a null
        // forever — let later page navs retry in case the file appears.
        snapshotIndexPromise = null;
      }
    });
  }
  return snapshotIndexPromise;
}

/**
 * Look up the rotation date for a card by its URL set/number. The URL set is
 * case-insensitive and the number may carry leading zeros — normalize both
 * before checking against the index's `SET::NUMBER` key.
 */
export function snapshotDateForCard(index: SnapshotIndex | null, set: string, number: string): string | null {
  if (!index) {
    return null;
  }
  const setU = set.toUpperCase();
  const numTrim = setNumberKey(number);
  return index.cardsBySetNumber[`${setU}::${numTrim}`] ?? null;
}

export function snapshotDateForArchetype(index: SnapshotIndex | null, slug: string): string | null {
  if (!index) {
    return null;
  }
  return index.archetypes[slug] ?? null;
}
