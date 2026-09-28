import { inputFingerprint } from './provenance';
import { playerObjectPath, playerRouteShard } from '../../../../shared/playerObjectRoutes';

export interface CapturedObject {
  sourceKey: string;
  relativeKey: string;
  etag: string;
  size: number;
}
interface InventoryEntry {
  etag: string;
  size: number;
  path: string;
}
export type PlayerInventory = Record<string, InventoryEntry>;

/** The producer manifest is the complete set of current careers. Old keys can linger in R2. */
export function currentPlayerObjects(objects: CapturedObject[], players: Record<string, string[]>): CapturedObject[] {
  const ids = new Set(Object.keys(players));
  const selected = objects.filter(object => {
    const key = object.relativeKey;
    return key === 'index.json' || key === 'index-slim.json' || (playerObjectPath(key) && ids.has(key.split('/')[0]));
  });
  const profiles = new Set(
    selected
      .filter(object => object.relativeKey.endsWith('/profile.json'))
      .map(object => object.relativeKey.split('/')[0])
  );
  if (profiles.size !== ids.size) {
    throw new Error(`Player scope is incomplete: ${profiles.size} profiles for ${ids.size} manifest players`);
  }
  return selected;
}

interface CaptureStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, body: unknown): Promise<void>;
  copy(object: CapturedObject, target: string): Promise<void>;
}

function validPlayerReference(path: string | undefined, relativeKey: string): boolean {
  const root = path?.match(/^\/releases\/v1\/players\/[a-f0-9]{12,64}\//)?.[0];
  return Boolean(root && path === `${root}${relativeKey}`);
}

function copyReason(
  playerBody: boolean,
  prior: InventoryEntry | undefined,
  validPath: boolean
): 'other' | 'new' | 'invalidRoot' | 'changed' {
  if (!playerBody) {
    return 'other';
  }
  if (!prior) {
    return 'new';
  }
  return validPath ? 'changed' : 'invalidRoot';
}

export function planPlayerCapture(
  objects: CapturedObject[],
  previous: PlayerInventory,
  root: string,
  previousRoot: string
) {
  const inventory: PlayerInventory = {};
  const copies: Array<{ object: CapturedObject; target: string }> = [];
  const copyReasons = { other: 0, new: 0, invalidRoot: 0, changed: 0 };
  let reusedFromOlderRoot = 0;
  for (const object of objects) {
    const prior = previous[object.relativeKey];
    const playerBody = playerObjectPath(object.relativeKey);
    const validPath = validPlayerReference(prior?.path, object.relativeKey);
    const reusable = playerBody && validPath && prior?.etag === object.etag && prior.size === object.size;
    if (reusable && !prior?.path.startsWith(`${previousRoot}/`)) {
      reusedFromOlderRoot++;
    }
    const path = reusable ? prior.path : `${root}/${object.relativeKey}`;
    inventory[object.relativeKey] = { etag: object.etag, size: object.size, path };
    if (!reusable) {
      const reason = copyReason(playerBody, prior, validPath);
      copyReasons[reason]++;
      copies.push({ object, target: path.replace(/^\//, '') });
    }
  }
  return { inventory, copies, copyReasons, reusedFromOlderRoot };
}

function routingArtifacts(inventory: PlayerInventory): Map<string, unknown> {
  const shards = new Map<string, Record<string, string>>();
  for (let index = 0; index < 256; index++) {
    shards.set(index.toString(16).padStart(2, '0'), {});
  }
  for (const [relative, entry] of Object.entries(inventory)) {
    if (playerObjectPath(relative)) {
      shards.get(playerRouteShard(relative))![relative] = entry.path;
    }
  }
  return new Map([...shards].map(([shard, routes]) => [`_routes/${shard}.json`, routes]));
}

export async function capturePlayers(options: {
  objects: CapturedObject[];
  previous: PlayerInventory;
  store: CaptureStore;
  write: boolean;
  previousRoot: string;
}): Promise<{ root: string; copied: number; reused: number }> {
  const { objects, previous, store, write, previousRoot } = options;
  const generation = inputFingerprint(objects.map(({ relativeKey, etag, size }) => ({ relativeKey, etag, size })));
  const root = `/releases/v1/players/${generation}`;
  const { inventory, copies, copyReasons, reusedFromOlderRoot } = planPlayerCapture(
    objects,
    previous,
    root,
    previousRoot
  );
  const result = { root, copied: copies.length, reused: objects.length - copies.length };
  console.log(
    `[players] planned ${objects.length} objects: ${copies.length} copies, ${result.reused} reused (${reusedFromOlderRoot} from older roots); reasons ${JSON.stringify(copyReasons)}`
  );
  if (!write || (await store.read(`${root.slice(1)}/_complete.json`))) {
    console.log(`[players] ${write ? 'complete generation already exists' : 'dry run'}; skipping copies`);
    return { ...result, copied: 0 };
  }
  // Bounded concurrency; a failed copy cannot publish a completion marker.
  let next = 0;
  let completed = 0;
  const started = Date.now();
  const progress = (): void => {
    console.log(
      `[players] copied ${completed}/${copies.length} objects in ${Math.round((Date.now() - started) / 1000)}s`
    );
  };
  const heartbeat = setInterval(progress, 30_000);
  heartbeat.unref();
  const worker = async (): Promise<void> => {
    while (next < copies.length) {
      const { object, target } = copies[next++];
      await store.copy(object, target);
      completed++;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(24, copies.length) }, worker));
  } finally {
    clearInterval(heartbeat);
    progress();
  }
  console.log('[players] writing 256 route shards, inventory, references, and completion marker');
  for (const [path, body] of routingArtifacts(inventory)) {
    await store.write(`${root.slice(1)}/${path}`, body);
  }
  const references = [...new Set(Object.values(inventory).map(entry => entry.path.split('/').slice(0, 5).join('/')))];
  await store.write(`${root.slice(1)}/_inventory.json`, inventory);
  await store.write(
    `${root.slice(1)}/_references.json`,
    references.filter(reference => reference !== root)
  );
  await store.write(`${root.slice(1)}/_complete.json`, {
    generation,
    objectCount: objects.length,
    layout: 'routes-v1'
  });
  console.log(`[players] generation complete in ${Math.round((Date.now() - started) / 1000)}s`);
  return result;
}
