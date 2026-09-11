/**
 * Release-aware URL resolution.
 *
 * Builds a resolver from the (optional) embedded release manifest. When a
 * manifest is present, every data artifact resolves to its immutable root. The
 * mutable tree is producer input, never a per-file browser fallback. A null
 * manifest remains useful for local builds.
 *
 * The embedded manifest is frozen for the document lifetime: a resolver never
 * switches roots mid-session (adopting a new release requires a reload).
 * @module shared/releaseManifest
 */

import {
  type ReleaseManifest,
  type ReleaseScope,
  resolveEventPath,
  resolveScopePath,
  validateReleaseManifest
} from './data/build/release';

/** Legacy scope roots (mutable), used when no release is embedded. */
const LEGACY_SCOPE_ROOTS: Record<ReleaseScope, string> = {
  online: 'reports/Online - Last 14 Days',
  trends: 'reports/Trends - Last 30 Days',
  players: 'players',
  prices: 'reports',
  catalogs: 'reports',
  snapshots: 'reports/Snapshots',
  assets: 'assets'
};

export interface ReleaseResolver {
  /** True when an embedded release is driving resolution. */
  readonly isReleaseAware: boolean;
  /** The frozen release id, or null in legacy mode. */
  readonly releaseId: string | null;
  /** Resolve a scope artifact to a full path (release-immutable or legacy). */
  scopePath(scope: ReleaseScope, relativePath: string): string;
  /** Resolve an event artifact, or null when the event is not directly linked. */
  eventPath(eventId: string, relativePath: string): string | null;
}

function joinLegacy(root: string, relativePath: string): string {
  return `${root}/${relativePath.replace(/^\/+/, '')}`;
}

/**
 * Build a resolver from an optional embedded manifest. Invalid manifests throw:
 * silently mixing an invalid release with mutable data breaks atomicity.
 * @param embedded - The embedded manifest, or null
 * @returns A frozen release resolver
 */
export function createReleaseResolver(embedded: unknown): ReleaseResolver {
  if (embedded === null || embedded === undefined) {
    return Object.freeze({
      isReleaseAware: false,
      releaseId: null,
      scopePath: (scope: ReleaseScope, relativePath: string) => joinLegacy(LEGACY_SCOPE_ROOTS[scope], relativePath),
      eventPath: (_eventId: string, _relativePath: string) => null
    });
  }
  const manifest = coerceManifest(embedded);
  if (manifest === null) {
    throw new Error('Invalid embedded release manifest');
  }
  const frozen = Object.freeze({
    ...manifest,
    roots: Object.freeze({ ...manifest.roots }),
    events: Object.freeze({ ...manifest.events }),
    dependencies: Object.freeze({ ...manifest.dependencies })
  }) as ReleaseManifest;
  return Object.freeze({
    isReleaseAware: true,
    releaseId: frozen.releaseId,
    scopePath: (scope: ReleaseScope, relativePath: string) => resolveScopePath(frozen, scope, relativePath),
    eventPath: (eventId: string, relativePath: string) => resolveEventPath(frozen, eventId, relativePath)
  });
}

/** Validate + narrow an embedded value to a manifest, or null. */
export function coerceManifest(value: unknown): ReleaseManifest | null {
  if (value === null || value === undefined) {
    return null;
  }
  return validateReleaseManifest(value).length === 0 ? (value as ReleaseManifest) : null;
}
