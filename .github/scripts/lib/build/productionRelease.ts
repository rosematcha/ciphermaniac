import {
  type ReleaseManifest,
  type ReleaseScope,
  resolveEventPath,
  resolveScopePath,
  validateReleaseManifest
} from '../../../../shared/data/build/release.ts';

export interface JsonReader {
  read<T>(key: string): Promise<T | null>;
}

interface ReleasePointer {
  releaseId?: unknown;
  manifest?: unknown;
}

const MANIFEST_KEY = /^(?:build\/v1\/releases|releases\/v1\/manifests)\/[a-zA-Z0-9_-]+\.json$/;
const EVENT_ROOT = /^\/?releases\/v1\/events\/[^/]+\/[a-f0-9]{12,64}$/;

function validateEventRoots(events: Record<string, string>, label: string): void {
  for (const [folder, root] of Object.entries(events)) {
    if (!/^\d{4}-\d{2}-\d{2},/.test(folder) || !EVENT_ROOT.test(root)) {
      throw new Error(`Invalid ${label} event root: ${folder} -> ${root}`);
    }
  }
}

export async function loadProductionRelease(reader: JsonReader): Promise<ReleaseManifest> {
  const pointer = await reader.read<ReleasePointer>('current.json');
  if (!pointer || typeof pointer.releaseId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(pointer.releaseId)) {
    throw new Error('Production release pointer is missing or invalid');
  }
  const manifestKey =
    typeof pointer.manifest === 'string'
      ? pointer.manifest.replace(/^\/+/, '')
      : `build/v1/releases/${pointer.releaseId}.json`;
  if (!MANIFEST_KEY.test(manifestKey)) {
    throw new Error(`Production manifest key is invalid: ${manifestKey}`);
  }
  const manifest = await reader.read<unknown>(manifestKey);
  const errors = validateReleaseManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Production release manifest is invalid:\n  ${errors.join('\n  ')}`);
  }
  const release = manifest as ReleaseManifest;
  if (release.releaseId !== pointer.releaseId) {
    throw new Error('Production pointer and manifest release IDs disagree');
  }
  return release;
}

export function productionEventKey(manifest: ReleaseManifest, event: string, relativePath: string): string {
  const path = resolveEventPath(manifest, event, relativePath);
  if (!path) {
    throw new Error(`Event is absent from production release ${manifest.releaseId}: ${event}`);
  }
  return path.replace(/^\/+/, '');
}

export function productionScopeKey(manifest: ReleaseManifest, scope: ReleaseScope, relativePath: string): string {
  return resolveScopePath(manifest, scope, relativePath).replace(/^\/+/, '');
}

export function resolveLegacyEventKey(manifest: ReleaseManifest, key: string): string {
  const normalized = key.replace(/^\/+/, '');
  if (normalized === 'reports/tournaments.json') {
    return productionScopeKey(manifest, 'catalogs', 'tournaments.json');
  }
  const match = /^reports\/(\d{4}-\d{2}-\d{2},[^/]+)\/(.+)$/.exec(normalized);
  return match ? productionEventKey(manifest, match[1], match[2]) : normalized;
}

export async function loadEventSources(
  reader: JsonReader
): Promise<{ release: ReleaseManifest; sources: Record<string, string> }> {
  const release = await loadProductionRelease(reader);
  const pending = await reader.read<{ events?: Record<string, string> }>('pending-events.json');
  const additions = pending?.events ?? {};
  validateEventRoots(release.events, 'production');
  validateEventRoots(additions, 'pending');
  return { release, sources: { ...release.events, ...additions } };
}
