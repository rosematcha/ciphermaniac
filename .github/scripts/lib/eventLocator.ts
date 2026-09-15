/**
 * The event locator producer's logic, separated from its entrypoint so the
 * publish order, the shrink guard, and orphan cleanup can be tested without
 * R2 or the network.
 *
 * Publish order is the contract. Cells go first, then places, then the index:
 * the browser reads the index to learn which cells exist, so until the new
 * index lands every visitor is on the previous generation's cell list, and
 * every cell that list names still exists. Cells the new generation dropped
 * are deleted only after its index is live.
 * @module .github/scripts/lib/eventLocator
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildLocatorArtifacts,
  type BuildStats,
  type LocatorArtifacts,
  shrinkProblem
} from '../../../shared/events/build.ts';
import { semanticHash } from '../../../shared/data/hash.ts';
import { buildLocalsArtifacts, type LocalsArtifacts, type LocalsBuildStats } from '../../../shared/events/locals.ts';
import {
  LOCALS_INDEX_KEY,
  type LocalsCell,
  localsCellPath,
  type LocalsIndex,
  LOCATOR_INDEX_KEY,
  locatorCellPath,
  type LocatorIndex,
  locatorPlacesPath
} from '../../../shared/events/types.ts';
import { LOCALS_HORIZON_DAYS, POKEDATA_SITE, type PokedataPull } from './pokedata.ts';
import { createR2Client, createReportsBinding, getJsonResult, putJson } from './r2.mjs';
import type { R2Config } from './env.ts';

/** Live data: the same six-hour client cache as every other daily artifact. */
export const LOCATOR_CACHE_CONTROL = 'public, max-age=21600';
const UPLOAD_CONCURRENCY = 8;

export interface Publisher {
  /** A published JSON object, or null when none exists yet. Throws on a transport failure. */
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface RunOptions {
  fetchEvents: () => Promise<PokedataPull>;
  publisher: Publisher;
  now?: () => Date;
  /** Publish past the shrink guard. Never publishes an empty generation. */
  allowShrink?: boolean;
  log?: (message: string) => void;
}

export interface RunResult {
  total: number;
  cells: number;
  removed: string[];
  stats: BuildStats;
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Write a generation into its own folder, switch the index to it, then delete
 * the run before last. The last run stays one more cycle, far longer than the
 * six-hour cache any visitor's copy of the old index can live.
 * @returns Keys of the cells deleted
 */
export async function publish(
  artifacts: LocatorArtifacts,
  publisher: Publisher,
  previous: LocatorIndex | null
): Promise<string[]> {
  const { generation } = artifacts.index;
  await runLimited([...artifacts.cells.entries()], UPLOAD_CONCURRENCY, ([key, cell]) =>
    publisher.write(locatorCellPath(generation, key), cell)
  );
  await publisher.write(locatorPlacesPath(generation), artifacts.places);
  const kept = previous?.generation
    ? { generation: previous.generation, cells: Object.keys(previous.cells) }
    : undefined;
  await publisher.write(LOCATOR_INDEX_KEY, kept ? { ...artifacts.index, previous: kept } : artifacts.index);
  const retired = previous?.previous;
  if (!retired || retired.generation === generation) {
    return [];
  }
  for (const key of retired.cells) {
    await publisher.remove(locatorCellPath(retired.generation, key));
  }
  await publisher.remove(locatorPlacesPath(retired.generation));
  return retired.cells;
}

function describeStats(stats: BuildStats): string {
  const skipped = Object.entries(stats.skipped)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  return `kept ${stats.kept} of ${stats.received} (past ${stats.past}, duplicates ${stats.duplicates}${skipped ? `, skipped: ${skipped}` : ''})`;
}

/**
 * Fetch, build, guard, publish.
 * @throws {Error} When the pull fails, or the new generation fails the shrink guard
 */
export async function runEventLocator(options: RunOptions): Promise<RunResult> {
  const { publisher, now = () => new Date(), allowShrink = false, log = () => undefined } = options;
  const pull = await options.fetchEvents();
  log(`Pokedata listed ${pull.totalItems} events across ${pull.totalPages} pages`);
  const artifacts = buildLocatorArtifacts(pull.events, { now: now(), source: POKEDATA_SITE });
  log(describeStats(artifacts.stats));
  const previous = await publisher.read<LocatorIndex>(LOCATOR_INDEX_KEY);
  const problem = shrinkProblem(previous?.total ?? null, artifacts.index.total);
  if (problem && !(allowShrink && artifacts.index.total > 0)) {
    throw new Error(`Refusing to publish: ${problem}. Re-run with allow_shrink if the drop is real.`);
  }
  if (problem) {
    log(`Publishing past the shrink guard: ${problem}`);
  }
  const removed = await publish(artifacts, publisher, previous);
  return { total: artifacts.index.total, cells: artifacts.cells.size, removed, stats: artifacts.stats };
}

export interface LocalsRunOptions {
  fetchLocals: () => Promise<unknown[]>;
  publisher: Publisher;
  now?: () => Date;
  horizonDays?: number;
  allowShrink?: boolean;
  log?: (message: string) => void;
}

export interface LocalsRunResult {
  /** Slots across every cell. */
  total: number;
  venues: number;
  written: string[];
  removed: string[];
  unchanged: number;
  stats: LocalsBuildStats;
}

/** Content hash of a cell (canonical, so key order cannot churn it), short enough for the index. */
export function cellHash(cell: LocalsCell): string {
  return semanticHash(cell).slice(0, 16);
}

/**
 * Write the locals cells whose content changed, then the index if anything
 * did, then delete the cells no longer listed. Cells sit at stable paths: a
 * visitor holding an older index reads a cell that is either the one it
 * expects or a newer whole one, and a dropped cell answers 404, which the
 * browser treats as empty.
 */
export async function publishLocals(
  artifacts: LocalsArtifacts,
  publisher: Publisher,
  previous: LocalsIndex | null
): Promise<Pick<LocalsRunResult, 'written' | 'removed' | 'unchanged'>> {
  const changed = [...artifacts.cells.entries()].filter(
    ([key]) => previous?.cells[key]?.hash !== artifacts.index.cells[key]?.hash
  );
  await runLimited(changed, UPLOAD_CONCURRENCY, ([key, cell]) => publisher.write(localsCellPath(key), cell));
  const removed = Object.keys(previous?.cells ?? {}).filter(key => !artifacts.cells.has(key));
  // A changed or dropped cell changes the index too, since it lists every hash.
  if (!previous || semanticHash(previous) !== semanticHash(artifacts.index)) {
    await publisher.write(LOCALS_INDEX_KEY, artifacts.index);
  }
  for (const key of removed) {
    await publisher.remove(localsCellPath(key));
  }
  return { written: changed.map(([key]) => key), removed, unchanged: artifacts.cells.size - changed.length };
}

function describeLocalsStats(stats: LocalsBuildStats): string {
  const skipped = Object.entries(stats.skipped)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  return `${stats.slots} slots (${stats.weekly} weekly) at ${stats.venues} stores from ${stats.kept} of ${stats.received} listings (past ${stats.past}${skipped ? `, skipped: ${skipped}` : ''})`;
}

/**
 * Fetch, build, guard, publish the locals. Independent of the sanctioned
 * listing: a locals outage never blocks Cups and Challenges, and vice versa.
 * @throws {Error} When the pull fails, or the new listing fails the shrink guard
 */
export async function runLocalsLocator(options: LocalsRunOptions): Promise<LocalsRunResult> {
  const { publisher, now = () => new Date(), allowShrink = false, log = () => undefined } = options;
  const raw = await options.fetchLocals();
  const artifacts = buildLocalsArtifacts(raw, {
    now: now(),
    source: POKEDATA_SITE,
    horizonDays: options.horizonDays ?? LOCALS_HORIZON_DAYS,
    hash: cellHash
  });
  log(describeLocalsStats(artifacts.stats));
  const previous = await publisher.read<LocalsIndex>(LOCALS_INDEX_KEY);
  const problem = shrinkProblem(previous?.total ?? null, artifacts.index.total);
  if (problem && !(allowShrink && artifacts.index.total > 0)) {
    throw new Error(`Refusing to publish locals: ${problem}. Re-run with allow_shrink if the drop is real.`);
  }
  if (problem) {
    log(`Publishing locals past the shrink guard: ${problem}`);
  }
  const outcome = await publishLocals(artifacts, publisher, previous);
  return { total: artifacts.index.total, venues: artifacts.index.venues, ...outcome, stats: artifacts.stats };
}

/** Publisher over a local directory, for running the producer without R2. */
export function createLocalPublisher(root: string): Publisher {
  const pathFor = (key: string) => join(root, key);
  return {
    async read<T>(key: string) {
      try {
        return JSON.parse(await readFile(pathFor(key), 'utf8')) as T;
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async write(key, value) {
      await mkdir(dirname(pathFor(key)), { recursive: true });
      await writeFile(pathFor(key), JSON.stringify(value));
    },
    async remove(key) {
      const { rm } = await import('node:fs/promises');
      await rm(pathFor(key), { force: true });
    }
  };
}

/** Publisher over the R2 bucket. */
export function createR2Publisher(config: R2Config): Publisher {
  const client = createR2Client(config);
  const binding = createReportsBinding(client, config.bucket);
  return {
    async read<T>(key: string) {
      const result = await getJsonResult<T>(client, config.bucket, key);
      if (result.status === 'found') {
        return result.value;
      }
      if (result.status === 'missing') {
        return null;
      }
      // Publishing blind would skip the shrink guard; a corrupt index is
      // worth a human look before anything replaces it.
      throw new Error(`Could not read ${key} (${result.status})`, { cause: result.error });
    },
    write: (key, value) =>
      putJson(client, config.bucket, key, value, {
        cacheControl: LOCATOR_CACHE_CONTROL,
        contentType: 'application/json'
      }),
    remove: key => binding.delete(key)
  };
}
