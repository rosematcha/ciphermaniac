import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createR2Client, getJsonResult, readJson, withR2Retry } from './lib/r2.mjs';
import { r2Config } from './lib/env';
import { staleCapturedReport } from './lib/build/capturedScope';
import {
  expiredGenerations,
  type Generation,
  GENERATION_GRACE_MS,
  generationPrefix,
  protectedGenerations,
  protectedReleaseIds,
  recordGeneration,
  type RetainedManifest,
  retentionManifest,
  type StoredObject
} from './lib/build/retention';

const LIVE_RETENTION_MS = 30 * 86_400_000;

interface Store {
  list(prefix: string): AsyncIterable<StoredObject>;
  read(key: string): Promise<unknown>;
  readOptional(key: string): Promise<unknown | null>;
  remove(keys: string[]): Promise<void>;
}

export function createRetentionStore(client: S3Client, bucket: string): Store {
  return {
    async *list(prefix) {
      let token: string | undefined;
      do {
        const cursor = token;
        const page = await withR2Retry(() =>
          client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }))
        );
        for (const object of page.Contents ?? []) {
          if (!object.Key || object.Size === undefined || !object.LastModified) {
            throw new Error('R2 listing returned incomplete metadata');
          }
          yield { key: object.Key, size: object.Size, modified: object.LastModified.getTime() };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !token) {
          throw new Error('R2 listing is truncated without a continuation token');
        }
      } while (token);
    },
    async read(key) {
      const result = await getJsonResult(client, bucket, key);
      if (result.status !== 'found') {
        throw new Error(`Cannot read retention reference ${key}: ${result.status}`);
      }
      return result.value;
    },
    readOptional: key => readJson(client, bucket, key),
    async remove(keys) {
      const result = await withR2Retry(() =>
        client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map(Key => ({ Key })) } }))
      );
      if (result.Errors?.length) {
        throw new Error(`R2 rejected ${result.Errors.length} deletions`);
      }
    }
  };
}

async function activeManifest(store: Store): Promise<RetainedManifest> {
  const key = 'current.json';
  const pointer = (await store.read(key)) as { releaseId?: string; manifest?: string };
  if (!pointer || !/^[a-zA-Z0-9_-]+$/.test(pointer.releaseId ?? '')) {
    throw new Error(`Invalid production pointer: ${key}`);
  }
  const manifestKey = pointer.manifest?.replace(/^\//, '') ?? `build/v1/releases/${pointer.releaseId}.json`;
  if (!/^(?:build\/v1\/releases|releases\/v1\/manifests)\/[a-zA-Z0-9_-]+\.json$/.test(manifestKey)) {
    throw new Error(`Invalid manifest key: ${manifestKey}`);
  }
  const manifest = retentionManifest(await store.read(manifestKey));
  if (manifest.releaseId !== pointer.releaseId) {
    throw new Error(`Production pointer and manifest disagree: ${key}`);
  }
  return manifest;
}

async function retainedState(store: Store, now: number): Promise<{ roots: Set<string>; releaseIds: Set<string> }> {
  const active = await activeManifest(store);
  const manifests = new Map([[active.releaseId, active]]);
  for (const prefix of ['build/v1/releases/', 'releases/v1/manifests/']) {
    for await (const object of store.list(prefix)) {
      const manifest = retentionManifest(await store.read(object.key));
      manifests.set(manifest.releaseId, manifest);
    }
  }
  const values = [...manifests.values()];
  const activeIds = new Set([active.releaseId]);
  const keep = protectedGenerations(values, activeIds, now);
  const releaseIds = protectedReleaseIds(values, activeIds, now);
  const pending = (await store.readOptional('pending-events.json')) as { events?: Record<string, string> } | null;
  for (const root of Object.values(pending?.events ?? {})) {
    const prefix = `${root.replace(/^\/+/, '')}/`;
    if (!prefix.startsWith('releases/v1/events/') || generationPrefix(prefix) !== prefix) {
      throw new Error(`Invalid pending event root: ${root}`);
    }
    keep.add(prefix);
  }
  await protectPlayerReferences(store, keep);
  return { roots: keep, releaseIds };
}

export async function protectPlayerReferences(store: Pick<Store, 'readOptional'>, keep: Set<string>): Promise<void> {
  const pending = [...keep].filter(root => root.startsWith('releases/v1/players/'));
  const visited = new Set<string>();
  while (pending.length) {
    const root = pending.pop()!;
    if (visited.has(root)) {
      continue;
    }
    visited.add(root);
    const references = await store.readOptional(`${root}_references.json`);
    if (references === null) {
      continue;
    }
    if (!Array.isArray(references)) {
      throw new Error(`Invalid player references: ${root}`);
    }
    for (const reference of references) {
      if (typeof reference !== 'string' || !/^\/releases\/v1\/players\/[a-f0-9]{12,64}$/.test(reference)) {
        throw new Error(`Invalid player generation reference: ${root}`);
      }
      const prefix = `${reference.slice(1)}/`;
      keep.add(prefix);
      pending.push(prefix);
    }
  }
}

function isLegacyMutableObject(key: string): boolean {
  return (
    /^reports\/\d{4}-\d{2}-\d{2},[^/]+\//.test(key) ||
    key === 'reports/tournaments.json' ||
    key.endsWith('/tournament.db') ||
    staleCapturedReport(key)
  );
}

function releaseIdForKey(key: string, prefix: string): string {
  return key.slice(prefix.length).replace(/\.json$/, '');
}

function isExpiredLiveObject(object: StoredObject, now: number): boolean {
  return object.key !== 'live/v1/schedule.json' && object.modified <= now - LIVE_RETENTION_MS;
}

async function obsoleteObjects(store: Store, retainedReleaseIds: Set<string>, now: number): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  for (const prefix of ['channels/', 'build/v1/channels/']) {
    for await (const object of store.list(prefix)) {
      objects.push(object);
    }
  }
  for await (const object of store.list('reports/')) {
    if (isLegacyMutableObject(object.key)) {
      objects.push(object);
    }
  }
  for (const prefix of ['build/v1/releases/', 'releases/v1/manifests/']) {
    for await (const object of store.list(prefix)) {
      const id = releaseIdForKey(object.key, prefix);
      if (!retainedReleaseIds.has(id)) {
        objects.push(object);
      }
    }
  }
  for await (const object of store.list('live/v1/')) {
    if (isExpiredLiveObject(object, now)) {
      objects.push(object);
    }
  }
  return objects;
}

async function removeObjects(store: Store, objects: StoredObject[]): Promise<void> {
  await removeKeys(
    store,
    objects.map(object => object.key)
  );
}

async function removeKeys(store: Store, keys: string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await store.remove(keys.slice(offset, offset + 1000));
  }
}

async function inventoryGeneration(store: Store, generation: Generation, now: number): Promise<string[]> {
  const keys: string[] = [];
  for await (const object of store.list(generation.prefix)) {
    if (!object.key.startsWith(generation.prefix) || object.modified >= now - GENERATION_GRACE_MS) {
      throw new Error(`Generation changed during cleanup: ${generation.prefix}`);
    }
    keys.push(object.key);
  }
  return keys;
}

async function removeGenerations(store: Store, generations: Generation[], now: number): Promise<void> {
  let next = 0;
  const inventories: string[][] = [];
  async function inventoryWorker(): Promise<void> {
    while (next < generations.length) {
      const index = next++;
      inventories[index] = await inventoryGeneration(store, generations[index], now);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, generations.length) }, inventoryWorker));
  await removeKeys(store, inventories.flat());
}

/** Call only under the shared bucket-writer lock. Dry-run is the default. */
export async function pruneReleases(
  store: Store,
  now: number,
  write = false
): Promise<{
  totalBytes: number;
  reclaimBytes: number;
  generations: Generation[];
  obsolete: StoredObject[];
}> {
  const retained = await retainedState(store, now);
  const groups = new Map<string, Generation>();
  for await (const object of store.list('releases/v1/')) {
    recordGeneration(groups, object);
  }
  const generations = expiredGenerations(groups.values(), retained.roots, now);
  const obsolete = await obsoleteObjects(store, retained.releaseIds, now);
  const plan = {
    totalBytes: [...groups.values()].reduce((sum, group) => sum + group.bytes, 0),
    reclaimBytes:
      generations.reduce((sum, group) => sum + group.bytes, 0) + obsolete.reduce((sum, object) => sum + object.size, 0),
    generations,
    obsolete
  };
  if (write) {
    // Re-read production after the inventory; an unexpected promotion cancels deletion.
    const fresh = await retainedState(store, now);
    for (const group of generations) {
      if (fresh.roots.has(group.prefix)) {
        throw new Error(`Release became active during cleanup: ${group.prefix}`);
      }
    }
    await removeGenerations(store, generations, now);
    await removeObjects(store, obsolete);
  }
  return plan;
}

async function main(): Promise<void> {
  const config = r2Config();
  const plan = await pruneReleases(
    createRetentionStore(createR2Client(config), config.bucket),
    Date.now(),
    process.argv.includes('--write')
  );
  await writeFile('retention-plan.json', JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify({
      totalBytes: plan.totalBytes,
      reclaimBytes: plan.reclaimBytes,
      generations: plan.generations.length,
      obsoleteObjects: plan.obsolete.length
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
