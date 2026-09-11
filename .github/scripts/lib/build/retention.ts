const DAY_MS = 86_400_000;
const GENERATION =
  /^(releases\/v1\/(?:events\/[^/]+|catalogs|online|trends|players|prices|snapshots|assets)\/[a-f0-9]{12,64})\//;

export interface StoredObject {
  key: string;
  size: number;
  modified: number;
}

export interface Generation {
  prefix: string;
  bytes: number;
  objects: number;
  newest: number;
}

export interface RetainedManifest {
  releaseId: string;
  publishedAt: string;
  roots: Record<string, string>;
  events: Record<string, string>;
}

function validateReferences(references: Record<string, string>): void {
  if (!references || typeof references !== 'object' || Array.isArray(references)) {
    throw new Error('Invalid release references');
  }
  for (const root of Object.values(references)) {
    if (typeof root !== 'string') {
      throw new Error('Invalid immutable root');
    }
    const prefix = `${root.replace(/^\//, '')}/`;
    if (generationPrefix(prefix) !== prefix) {
      throw new Error(`Invalid immutable root: ${root}`);
    }
  }
}

/** Accept both historical contracts, but fail closed on malformed references. */
export function retentionManifest(value: unknown): RetainedManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Missing release manifest');
  }
  const manifest = value as RetainedManifest;
  if (typeof manifest.releaseId !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt))) {
    throw new Error('Invalid release identity');
  }
  validateReferences(manifest.roots);
  validateReferences(manifest.events);
  if (!Object.keys(manifest.roots).length) {
    throw new Error('Release has no scope roots');
  }
  return manifest;
}

export function generationPrefix(key: string): string | null {
  const match = GENERATION.exec(key);
  return match ? `${match[1]}/` : null;
}

export function recordGeneration(groups: Map<string, Generation>, object: StoredObject): void {
  const prefix = generationPrefix(object.key);
  if (!prefix) {
    return;
  }
  if (!Number.isFinite(object.modified) || !Number.isFinite(object.size) || object.size < 0) {
    throw new Error(`Invalid object metadata: ${object.key}`);
  }
  const group = groups.get(prefix) ?? { prefix, bytes: 0, objects: 0, newest: 0 };
  group.bytes += object.size;
  group.objects += 1;
  group.newest = Math.max(group.newest, object.modified);
  groups.set(prefix, group);
}

/** Keep active channels, a week of rollbacks, and at least the last two releases. */
export function protectedGenerations(manifests: RetainedManifest[], activeIds: Set<string>, now: number): Set<string> {
  if (!Number.isFinite(now) || activeIds.size === 0) {
    throw new Error('Retention requires a valid clock and an active release');
  }
  const ordered = [...manifests].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  for (const id of activeIds) {
    if (!ordered.some(manifest => manifest.releaseId === id)) {
      throw new Error(`Active release manifest not found: ${id}`);
    }
  }
  const keep = new Set<string>();
  ordered.forEach((manifest, index) => {
    if (index >= 2 && !activeIds.has(manifest.releaseId) && Date.parse(manifest.publishedAt) < now - 7 * DAY_MS) {
      return;
    }
    for (const root of [...Object.values(manifest.roots), ...Object.values(manifest.events)]) {
      keep.add(`${root.replace(/^\//, '')}/`);
    }
  });
  return keep;
}

/** Only complete generations outside both the reference set and grace window qualify. */
export function expiredGenerations(groups: Iterable<Generation>, keep: Set<string>, now: number): Generation[] {
  if (!Number.isFinite(now) || keep.size === 0) {
    throw new Error('Refusing cleanup without protected generations');
  }
  return [...groups].filter(group => !keep.has(group.prefix) && group.newest < now - 7 * DAY_MS);
}
