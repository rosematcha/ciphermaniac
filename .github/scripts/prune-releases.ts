import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createR2Client, getJsonResult, withR2Retry } from './lib/r2.mjs';
import { r2Config } from './lib/env';
import {
  expiredGenerations,
  type Generation,
  protectedGenerations,
  recordGeneration,
  type RetainedManifest,
  retentionManifest,
  type StoredObject
} from './lib/build/retention';

interface Store {
  list(prefix: string): AsyncIterable<StoredObject>;
  read(key: string): Promise<unknown>;
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

async function activeManifests(store: Store): Promise<RetainedManifest[]> {
  const keys = ['current.json'];
  for (const prefix of ['channels/', 'build/v1/channels/']) {
    for await (const object of store.list(prefix)) {
      if (object.key.endsWith('.json')) {
        keys.push(object.key);
      }
    }
  }
  return Promise.all(
    keys.map(async key => {
      const pointer = (await store.read(key)) as { releaseId?: string; manifest?: string };
      if (!pointer || !/^[a-zA-Z0-9_-]+$/.test(pointer.releaseId ?? '')) {
        throw new Error(`Invalid channel pointer: ${key}`);
      }
      const manifestKey = pointer.manifest?.replace(/^\//, '') ?? `build/v1/releases/${pointer.releaseId}.json`;
      if (!/^(?:build\/v1\/releases|releases\/v1\/manifests)\/[a-zA-Z0-9_-]+\.json$/.test(manifestKey)) {
        throw new Error(`Invalid manifest key: ${manifestKey}`);
      }
      const manifest = retentionManifest(await store.read(manifestKey));
      if (manifest.releaseId !== pointer.releaseId) {
        throw new Error(`Channel and manifest disagree: ${key}`);
      }
      return manifest;
    })
  );
}

async function retainedRoots(store: Store, now: number): Promise<Set<string>> {
  const active = await activeManifests(store);
  const manifests = new Map(active.map(manifest => [manifest.releaseId, manifest]));
  for (const prefix of ['build/v1/releases/', 'releases/v1/manifests/']) {
    for await (const object of store.list(prefix)) {
      const manifest = retentionManifest(await store.read(object.key));
      manifests.set(manifest.releaseId, manifest);
    }
  }
  return protectedGenerations([...manifests.values()], new Set(active.map(manifest => manifest.releaseId)), now);
}

async function removeGeneration(store: Store, generation: Generation, now: number): Promise<void> {
  const keys: string[] = [];
  for await (const object of store.list(generation.prefix)) {
    if (!object.key.startsWith(generation.prefix) || object.modified >= now - 7 * 86_400_000) {
      throw new Error(`Generation changed during cleanup: ${generation.prefix}`);
    }
    keys.push(object.key);
  }
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await store.remove(keys.slice(offset, offset + 1000));
  }
}

async function removeGenerations(store: Store, generations: Generation[], now: number): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < generations.length) {
      const generation = generations[next++];
      await removeGeneration(store, generation, now);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, generations.length) }, worker));
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
}> {
  const keep = await retainedRoots(store, now);
  const groups = new Map<string, Generation>();
  for await (const object of store.list('releases/v1/')) {
    recordGeneration(groups, object);
  }
  const generations = expiredGenerations(groups.values(), keep, now);
  const plan = {
    totalBytes: [...groups.values()].reduce((sum, group) => sum + group.bytes, 0),
    reclaimBytes: generations.reduce((sum, group) => sum + group.bytes, 0),
    generations
  };
  if (write) {
    // Re-read all channels after the inventory; an unexpected promotion cancels deletion.
    const freshKeep = await retainedRoots(store, now);
    for (const group of generations) {
      if (freshKeep.has(group.prefix)) {
        throw new Error(`Release became active during cleanup: ${group.prefix}`);
      }
    }
    await removeGenerations(store, generations, now);
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
      generations: plan.generations.length
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
