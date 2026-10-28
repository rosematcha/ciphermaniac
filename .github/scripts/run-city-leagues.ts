#!/usr/bin/env node

/**
 * The City League source, run on its own.
 *
 * Gathers the window's events and decks (caching pages under
 * `sources/city-leagues/`) and prints a summary. The meta producer calls the
 * same function.
 *
 * Without R2 (local development), keep the cache in a directory:
 *   npx tsx .github/scripts/run-city-leagues.ts --store .cache/city-leagues [--out decks.json]
 */

import process from 'node:process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { r2Config } from './lib/env.ts';
import { createR2Client, putJson, readJson } from './lib/r2.mjs';
import { listR2Keys } from './lib/r2Inventory.mjs';
import { createPoliteFetcher, gatherCityLeagues } from './lib/cityLeagues/index.ts';
import type { CityLeagueStore } from './lib/cityLeagues/types.ts';

function localStore(root: string): CityLeagueStore {
  return {
    async read<T>(key: string) {
      const text = await readFile(join(root, key), 'utf8').catch(() => null);
      return text === null ? null : (JSON.parse(text) as T);
    },
    async write(key, value) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
    },
    async list(prefix) {
      const files = await readdir(join(root, prefix), { recursive: true }).catch(() => []);
      return files.map(file => relative(root, join(root, prefix, file)));
    }
  };
}

function r2Store(): CityLeagueStore {
  const config = r2Config();
  const client = createR2Client(config);
  return {
    read: key => readJson(client, config.bucket, key),
    write: (key, value) => putJson(client, config.bucket, key, value),
    list: prefix => listR2Keys(client, config.bucket, prefix)
  };
}

function flagValue(name: string): string | null {
  const flag = process.argv.indexOf(name);
  return flag === -1 ? null : (process.argv[flag + 1] ?? null);
}

async function main(): Promise<void> {
  const storeDir = flagValue('--store');
  const store = storeDir ? localStore(storeDir) : r2Store();
  const fetcher = createPoliteFetcher();
  const result = await gatherCityLeagues({ store, fetchText: fetcher.fetchText, now: new Date() });
  console.log(`Gathered ${result.tournaments.length} events, ${result.decks.length} decks`);
  const out = flagValue('--out');
  if (out) {
    await writeFile(out, JSON.stringify(result, null, 2));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
