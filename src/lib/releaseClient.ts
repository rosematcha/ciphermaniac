/**
 * Release-aware data path resolution for the browser.
 *
 * Builds one resolver from the embedded release manifest (frozen for the
 * document lifetime) and maps legacy `reports/…` / `players/…` paths to their
 * immutable `/releases/v1/…` roots when a release is embedded. The committed
 * null state leaves local development usable without a published release.
 */

import { EMBEDDED_RELEASE } from '../../shared/generated/release';
import { createReleaseResolver, type ReleaseResolver } from '../../shared/releaseManifest';
import type { ReleaseScope } from '../../shared/data/build/release';

const resolver = createReleaseResolver(EMBEDDED_RELEASE);

/** True when an immutable release drives resolution. */
export const { isReleaseAware } = resolver;

/** Folder prefixes whose whole subtree is one scope, relative paths kept. */
const SCOPE_PREFIXES: ReadonlyArray<[prefix: string, scope: ReleaseScope]> = [
  ['assets/', 'assets'],
  ['reports/Online - Last 14 Days/', 'online'],
  ['reports/Trends - Last 30 Days/', 'trends'],
  ['reports/Snapshots/', 'snapshots'],
  ['reports/Formats/', 'formats'],
  ['players/', 'players']
];

/** Single report files, by path, with the scope they live in. */
const SCOPE_FILES: Readonly<Record<string, { scope: ReleaseScope; rel: string }>> = {
  'reports/tournaments.json': { scope: 'catalogs', rel: 'tournaments.json' },
  'reports/prices.json': { scope: 'prices', rel: 'prices.json' },
  'reports/prices-history.json': { scope: 'prices', rel: 'prices-history.json' },
  'reports/price-movers.json': { scope: 'prices', rel: 'price-movers.json' },
  'reports/majors-trends.json': { scope: 'trends', rel: 'majors-trends.json' }
};

/** Classify a legacy report path to a scope + scope-relative path, or null. */
function classify(path: string): { scope: ReleaseScope; rel: string } | null {
  const p = path.replace(/^\/+/, '');
  const prefixed = SCOPE_PREFIXES.find(([prefix]) => p.startsWith(prefix));
  if (prefixed) {
    return { scope: prefixed[1], rel: p.slice(prefixed[0].length) };
  }
  if (p.startsWith('reports/price-history/')) {
    return { scope: 'prices', rel: p.slice('reports/'.length) };
  }
  return SCOPE_FILES[p] ?? null;
}

/**
 * Resolve a report path. Local builds without a manifest pass paths through;
 * release builds resolve every recognized data path immutably and reject paths
 * absent from that release.
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
  if (path === '/upcoming.json' || !withResolver.isReleaseAware) {
    return path;
  }
  const normalized = path.replace(
    /^(\/*reports\/)([^/]+)/,
    (_match, prefix: string, folder: string) => `${prefix}${decodeURIComponent(folder)}`
  );
  const classified = classify(normalized);
  if (classified) {
    const resolved = withResolver.scopePath(classified.scope, classified.rel);
    return resolved.startsWith('/') ? resolved : `/${resolved}`;
  }
  // Event-folder path: /reports/{YYYY-MM-DD, Name}/{rel}. Resolve via the
  // embedded event map, keyed by the folder name the UI already uses.
  const event = classifyEvent(normalized);
  if (event) {
    const resolved = withResolver.eventPath(event.folder, event.rel);
    if (resolved) {
      return resolved.startsWith('/') ? resolved : `/${resolved}`;
    }
  }
  throw new Error(`Data path is not present in release ${withResolver.releaseId}: ${path}`);
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
