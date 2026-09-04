/**
 * Data path construction for the browser.
 *
 * One home for the rules that turn a UI-level identifier (a tournament key, a
 * card's set/number) into an R2 path or an index key. Both halves of a lookup
 * have to agree on these, and when the construction was inlined at each call
 * site they could quietly stop agreeing.
 *
 * These produce LEGACY paths. Rewriting them onto immutable release roots is
 * the client's job (see ./client and ../releaseClient), so nothing here needs
 * to know whether a release manifest is embedded.
 * @module src/lib/data/paths
 */

import { cardNumberIndexKey } from '../../../shared/data/cardIdentity.js';
import { ONLINE_META_NAME } from '../constants';

/** The rolling online meta report's tournament key. */
export const ONLINE = ONLINE_META_NAME;

/**
 * Sentinel "tournament" key used to point the standard data fetchers at a
 * pre-rotation snapshot. Format: `snapshot:YYYY-MM-DD`. Pages that want to
 * render rotated content pass this through `fetchMaster`/`fetchArchetype`/etc.
 * exactly as they would a normal tournament key, and {@link tournamentPath}
 * rewrites the R2 path to `/reports/Snapshots/{date}/...`.
 */
const SNAPSHOT_SOURCE_PREFIX = 'snapshot:';

export function isSnapshotSource(source: string): boolean {
  return source.startsWith(SNAPSHOT_SOURCE_PREFIX);
}

export function snapshotSourceKey(rotationDate: string): string {
  return `${SNAPSHOT_SOURCE_PREFIX}${rotationDate}`;
}

/** Root path for a tournament's reports, snapshot sentinels included. */
export function tournamentPath(name: string): string {
  if (isSnapshotSource(name)) {
    const date = name.slice(SNAPSHOT_SOURCE_PREFIX.length);
    return `/reports/Snapshots/${encodeURIComponent(date)}`;
  }
  return `/reports/${encodeURIComponent(name)}`;
}

/**
 * Normalize a card number for the SPA's `SET::NUMBER` synonym/snapshot index
 * keys. Delegates to the shared helper so the keys the SPA builds can never
 * drift from the ones the index producers write; lowercase-suffixed URLs
 * resolve the same way the edge 301 does.
 */
export function setNumberKey(value: string | number): string {
  return cardNumberIndexKey(value);
}
