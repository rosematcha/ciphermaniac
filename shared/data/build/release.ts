/**
 * Immutable release manifest and path resolution.
 *
 * A release composes independently versioned scopes: unchanged scopes keep their
 * existing roots, so a build that only touched online meta reuses every other
 * scope's root. The manifest is embedded in the deployed app (kept small, under
 * ~8 KB compressed) and is the ONLY thing the browser resolves — report bodies
 * are then fetched directly from the scope roots with a one-year cache policy.
 *
 * Environment-neutral: the browser validates this small contract and trusts the
 * build-validated large bodies.
 * @module shared/data/build/release
 */

export const RELEASE_CONTRACT_VERSION = 1;

/** Scopes that carry a single root path for the whole scope. */
export type ReleaseScope = 'online' | 'trends' | 'players' | 'prices' | 'catalogs' | 'snapshots';

const RELEASE_SCOPES: readonly ReleaseScope[] = ['online', 'trends', 'players', 'prices', 'catalogs', 'snapshots'];

/** The immutable release manifest embedded in the deployed app. */
export interface ReleaseManifest {
  contractVersion: number;
  /** Sortable release id, e.g. "20260712T170331Z-a1b2c3d". */
  releaseId: string;
  /** ISO publish time (informational). */
  publishedAt: string;
  /** Scope -> immutable root path (e.g. "/releases/v1/online/abc123"). */
  roots: Record<ReleaseScope, string>;
  /**
   * Scope -> the exact scope-relative keys this release actually published.
   * The resolver rewrites a scope path to its immutable root ONLY when the key
   * appears here; every other path passes through to the legacy (dual-written)
   * location. This keeps the release self-describing and provably free of the
   * "release body 404 → recovery reload" trap for keys we never captured (e.g.
   * per-player bodies, or online conversion/matchupProfiles that don't exist).
   */
  served: Record<ReleaseScope, string[]>;
  /** Direct-link event id -> immutable event root path. */
  events: Record<string, string>;
  /** Cross-scope dependency generations, for provenance and GC. */
  dependencies: Record<string, string>;
}

function isImmutableRoot(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/releases/v1/') && !path.endsWith('/');
}

/**
 * Resolve a scope-relative artifact path against the release. Returns the full
 * immutable path the browser fetches.
 * @param manifest - The release manifest
 * @param scope - The data scope
 * @param relativePath - Path relative to the scope root (e.g. "master.json")
 * @returns The full immutable path
 */
export function resolveScopePath(manifest: ReleaseManifest, scope: ReleaseScope, relativePath: string): string {
  const root = manifest.roots[scope];
  if (!root) {
    throw new Error(`release ${manifest.releaseId} has no root for scope "${scope}"`);
  }
  return joinPath(root, relativePath);
}

/**
 * Resolve an event artifact path. Falls back to null when the event is not in
 * the embedded map (the caller then uses the tournament catalog).
 * @param manifest - The release manifest
 * @param eventId - The event id
 * @param relativePath - Path relative to the event root
 * @returns The full path, or null when the event is not directly linked
 */
export function resolveEventPath(manifest: ReleaseManifest, eventId: string, relativePath: string): string | null {
  const root = manifest.events[eventId];
  return root ? joinPath(root, relativePath) : null;
}

function joinPath(root: string, relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '');
  return `${root}/${trimmed}`;
}

/**
 * Whether the release actually published `relativePath` under `scope`. Only
 * served keys are safe to rewrite to the immutable root; everything else must
 * fall back to the legacy path.
 * @param manifest - The release manifest
 * @param scope - The data scope
 * @param relativePath - Path relative to the scope root
 * @returns True when this exact key is in the release's served set
 */
export function isScopeArtifactServed(manifest: ReleaseManifest, scope: ReleaseScope, relativePath: string): boolean {
  const keys = manifest.served?.[scope];
  return Array.isArray(keys) && keys.includes(relativePath.replace(/^\/+/, ''));
}

/** Collect all errors preventing `value` from being a valid release manifest. */
export function validateReleaseManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return ['manifest: expected object'];
  }
  const manifest = value as Record<string, unknown>;

  if (manifest.contractVersion !== RELEASE_CONTRACT_VERSION) {
    errors.push(`contractVersion: expected ${RELEASE_CONTRACT_VERSION}`);
  }
  for (const field of ['releaseId', 'publishedAt'] as const) {
    if (typeof manifest[field] !== 'string' || (manifest[field] as string).length === 0) {
      errors.push(`${field}: expected non-empty string`);
    }
  }

  if (typeof manifest.roots !== 'object' || manifest.roots === null) {
    errors.push('roots: expected object');
  } else {
    const roots = manifest.roots as Record<string, unknown>;
    for (const scope of RELEASE_SCOPES) {
      if (!(scope in roots)) {
        errors.push(`roots.${scope}: missing`);
      } else if (!isImmutableRoot(roots[scope])) {
        errors.push(`roots.${scope}: expected an immutable /releases/v1/... path`);
      }
    }
  }

  if (typeof manifest.served !== 'object' || manifest.served === null) {
    errors.push('served: expected object');
  } else {
    const served = manifest.served as Record<string, unknown>;
    for (const scope of RELEASE_SCOPES) {
      const keys = served[scope];
      if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string')) {
        errors.push(`served.${scope}: expected an array of scope-relative key strings`);
      }
    }
  }

  if (typeof manifest.events !== 'object' || manifest.events === null) {
    errors.push('events: expected object');
  } else {
    for (const [eventId, root] of Object.entries(manifest.events as Record<string, unknown>)) {
      if (!isImmutableRoot(root)) {
        errors.push(`events.${eventId}: expected an immutable /releases/v1/... path`);
      }
    }
  }

  if (typeof manifest.dependencies !== 'object' || manifest.dependencies === null) {
    errors.push('dependencies: expected object');
  }

  return errors;
}

/** Inputs to compose a release: each scope's chosen root and event roots. */
export interface ReleaseComposition {
  releaseId: string;
  publishedAt: string;
  roots: Record<ReleaseScope, string>;
  /** Exact scope-relative keys published per scope (see {@link ReleaseManifest.served}). */
  served: Record<ReleaseScope, string[]>;
  events?: Record<string, string>;
  dependencies?: Record<string, string>;
}

/**
 * Compose an immutable release manifest. Throws if any provided root is not an
 * immutable path — a release must never point at a mutable key.
 * @param composition - The chosen scope + event roots
 * @returns A validated release manifest
 */
export function composeRelease(composition: ReleaseComposition): ReleaseManifest {
  const manifest: ReleaseManifest = {
    contractVersion: RELEASE_CONTRACT_VERSION,
    releaseId: composition.releaseId,
    publishedAt: composition.publishedAt,
    roots: composition.roots,
    served: composition.served,
    events: composition.events ?? {},
    dependencies: composition.dependencies ?? {}
  };
  const errors = validateReleaseManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`composeRelease produced an invalid manifest:\n  ${errors.join('\n  ')}`);
  }
  return manifest;
}
