/**
 * Release-aware data path resolution for the browser.
 *
 * Builds one resolver from the embedded release manifest (frozen for the
 * document lifetime) and maps legacy `reports/…` / `players/…` paths to their
 * immutable `/releases/v1/…` roots WHEN a release is embedded. When it is not —
 * the default committed state — {@link resolveDataPath} returns the path
 * unchanged, so production behavior is byte-identical to before this layer
 * existed. This is the single place `src/lib/data.ts` routes report paths
 * through (DB-MASTER-PLAN Phase 4 browser change).
 * @module src/lib/releaseClient
 */

import { EMBEDDED_RELEASE } from '../generated/release';
import { createReleaseResolver, type ReleaseResolver } from '../../shared/releaseManifest';
import type { ReleaseScope } from '../../shared/data/build/release';

const resolver = createReleaseResolver(EMBEDDED_RELEASE);

/** True when an immutable release drives resolution (vs. legacy pass-through). */
export const { isReleaseAware } = resolver;

const ONLINE_PREFIX = 'reports/Online - Last 14 Days/';
const TRENDS_PREFIX = 'reports/Trends - Last 30 Days/';
const SNAPSHOTS_PREFIX = 'reports/Snapshots/';
const PLAYERS_PREFIX = 'players/';

/** Classify a legacy report path to a scope + scope-relative path, or null. */
function classify(path: string): { scope: ReleaseScope; rel: string } | null {
  const p = path.replace(/^\/+/, '');
  if (p.startsWith(ONLINE_PREFIX)) {
    return { scope: 'online', rel: p.slice(ONLINE_PREFIX.length) };
  }
  if (p.startsWith(TRENDS_PREFIX)) {
    return { scope: 'trends', rel: p.slice(TRENDS_PREFIX.length) };
  }
  if (p.startsWith(SNAPSHOTS_PREFIX)) {
    return { scope: 'snapshots', rel: p.slice(SNAPSHOTS_PREFIX.length) };
  }
  if (p.startsWith(PLAYERS_PREFIX)) {
    return { scope: 'players', rel: p.slice(PLAYERS_PREFIX.length) };
  }
  if (p === 'reports/tournaments.json') {
    return { scope: 'catalogs', rel: 'tournaments.json' };
  }
  // Per-set history shards (reports/price-history/…) are deliberately absent:
  // like per-player bodies they pass through to their legacy location rather
  // than being captured into a release.
  if (p === 'reports/prices.json' || p === 'reports/prices-history.json' || p === 'reports/price-movers.json') {
    return { scope: 'prices', rel: p.slice('reports/'.length) };
  }
  if (p === 'reports/majors-trends.json') {
    return { scope: 'trends', rel: 'majors-trends.json' };
  }
  return null;
}

/**
 * Resolve a report path. Pass-through (byte-identical) when no release is
 * embedded; otherwise rewrite to immutable release roots ONLY the scope keys the
 * release actually published, passing every other path (unpublished bodies,
 * unlinked events) through to its legacy location.
 * @param path - The legacy report path (e.g. "/reports/Online - Last 14 Days/master.json")
 * @returns The path to fetch (unchanged in production, or a `/releases/v1/…` path)
 */
export function resolveDataPath(path: string): string {
  return resolvePathWith(resolver, path);
}

/**
 * Pure core of {@link resolveDataPath}, parameterized on the resolver so the
 * release-aware rewriting is unit-testable with an injected manifest.
 * @param withResolver - The release resolver to use
 * @param path - The legacy report path
 * @returns The resolved path (unchanged in legacy mode)
 */
export function resolvePathWith(withResolver: ReleaseResolver, path: string): string {
  if (!withResolver.isReleaseAware) {
    return path;
  }
  const classified = classify(path);
  if (classified) {
    // Only rewrite keys this release actually published; a path the release did
    // not capture (per-player bodies, per-snapshot bodies, online files that do
    // not exist) passes through UNCHANGED to its legacy (dual-written) location,
    // where a 404 is a normal optional miss rather than release-body corruption.
    if (!withResolver.servesScopePath(classified.scope, classified.rel)) {
      return path;
    }
    const resolved = withResolver.scopePath(classified.scope, classified.rel);
    return resolved.startsWith('/') ? resolved : `/${resolved}`;
  }
  // Event-folder path: /reports/{YYYY-MM-DD, Name}/{rel}. Resolve via the
  // embedded event map (keyed by the folder name the UI already uses); pass
  // through when the event is not directly linked in this release.
  const event = classifyEvent(path);
  if (event) {
    const resolved = withResolver.eventPath(event.folder, event.rel);
    if (resolved) {
      return resolved.startsWith('/') ? resolved : `/${resolved}`;
    }
  }
  return path;
}

/** True when a resolved path targets an immutable release body. */
export function isReleasePath(path: string): boolean {
  return path.startsWith('/releases/v1/');
}

/**
 * Decide how to handle a 404 on a resolved report path. A missing IMMUTABLE
 * release body is treated as corruption: recover with exactly ONE controlled
 * reload (to adopt a newer embedded release) — never fall back to a legacy
 * generation within the same document. A 404 on a legacy path, or a second
 * miss after we already reloaded, is a normal miss.
 * @param resolvedPath - The path that 404'd (post-resolution)
 * @param releaseAware - Whether a release manifest is embedded
 * @param alreadyReloaded - Whether this document already did its one recovery reload
 * @returns 'reload' to perform the single recovery reload, else 'passthrough'
 */
export function planMissingBodyRecovery(
  resolvedPath: string,
  releaseAware: boolean,
  alreadyReloaded: boolean
): 'reload' | 'passthrough' {
  return releaseAware && isReleasePath(resolvedPath) && !alreadyReloaded ? 'reload' : 'passthrough';
}

const RELOAD_FLAG = 'ciphermaniac.releaseRecoveryReloaded';

/**
 * Browser side of {@link planMissingBodyRecovery}: perform the one controlled
 * recovery reload for a missing release body, guarded by session storage so it
 * can never loop. No-op outside the browser. Returns true when it initiated a
 * reload (the caller should stop, a navigation is underway).
 * @param resolvedPath - The 404'd resolved path
 * @returns Whether a recovery reload was initiated
 */
export function recoverFromMissingReleaseBody(resolvedPath: string): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }
  const already = sessionStorage.getItem(RELOAD_FLAG) === '1';
  if (planMissingBodyRecovery(resolvedPath, isReleaseAware, already) !== 'reload') {
    return false;
  }
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
  return true;
}

/** Classify a dated event-folder report path to (folder, folder-relative path). */
function classifyEvent(path: string): { folder: string; rel: string } | null {
  const p = path.replace(/^\/+/, '');
  if (!p.startsWith('reports/')) {
    return null;
  }
  const rest = p.slice('reports/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return null;
  }
  const folder = rest.slice(0, slash);
  // Only dated event folders (exclude Online/Trends/Snapshots, handled above).
  if (!/^\d{4}-\d{2}-\d{2},/.test(folder)) {
    return null;
  }
  return { folder, rel: rest.slice(slash + 1) };
}
