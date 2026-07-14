/**
 * Release-aware URL resolution with legacy fallback.
 *
 * Builds a resolver from the (optional) embedded release manifest. When a
 * manifest is present, scope artifacts resolve to their immutable
 * `/releases/v1/…` roots and are cacheable for a year; when it is absent — the
 * default committed state — the resolver returns the legacy mutable path, so the
 * app behaves exactly as it does today until a release is actually embedded.
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
  snapshots: 'reports/Snapshots'
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
 * Build a resolver from an optional embedded manifest. An invalid manifest is
 * treated as absent (legacy fallback) rather than throwing, so a corrupt embed
 * degrades to today's behavior instead of breaking the app.
 * @param embedded - The embedded manifest, or null
 * @returns A frozen release resolver
 */
export function createReleaseResolver(embedded: unknown): ReleaseResolver {
  const manifest = coerceManifest(embedded);
  if (manifest === null) {
    return Object.freeze({
      isReleaseAware: false,
      releaseId: null,
      scopePath: (scope: ReleaseScope, relativePath: string) => joinLegacy(LEGACY_SCOPE_ROOTS[scope], relativePath),
      eventPath: (_eventId: string, _relativePath: string) => null
    });
  }
  const frozen = Object.freeze({ ...manifest, roots: Object.freeze({ ...manifest.roots }) }) as ReleaseManifest;
  return Object.freeze({
    isReleaseAware: true,
    releaseId: frozen.releaseId,
    scopePath: (scope: ReleaseScope, relativePath: string) => resolveScopePath(frozen, scope, relativePath),
    eventPath: (eventId: string, relativePath: string) => resolveEventPath(frozen, eventId, relativePath)
  });
}

/** Validate + narrow an embedded value to a manifest, or null. */
export function coerceManifest(value: unknown): ReleaseManifest | null {
  if (value === null || value === undefined) return null;
  return validateReleaseManifest(value).length === 0 ? (value as ReleaseManifest) : null;
}
