#!/usr/bin/env node

/**
 * The City League source, run on its own.
 *
 * By default, gathers the window's events and decks (caching pages under
 * `sources/city-leagues/`) and prints a summary. With `--mirror-images`, it
 * mirrors pokemonproxies.com's images of Japanese-only cards into
 * `jp-card-images/` instead. The meta producer calls the same functions.
 *
 * Without R2 (local development), keep the cache in a directory:
 *   npx tsx .github/scripts/run-city-leagues.ts --store .cache/city-leagues [--out decks.json]
 *   npx tsx .github/scripts/run-city-leagues.ts --store .cache/city-leagues --mirror-images
 */

import process from 'node:process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Config } from './lib/env.ts';
import { createR2Client, putJson, readJson, withR2Retry } from './lib/r2.mjs';
import { listR2Keys } from './lib/r2Inventory.mjs';
import { createPoliteFetcher, gatherCityLeagues } from './lib/cityLeagues/index.ts';
import { mirrorProxyImages, type ProxyImageStore } from './lib/cityLeagues/proxies.ts';
import type { CityLeagueStore } from './lib/cityLeagues/types.ts';

type Store = CityLeagueStore & ProxyImageStore;

function localStore(root: string): Store {
  const put = async (key: string, body: string | Uint8Array) => {
    const path = join(root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  };
  return {
    async read<T>(key: string) {
      const text = await readFile(join(root, key), 'utf8').catch(() => null);
      return text === null ? null : (JSON.parse(text) as T);
    },
    write: (key, value) => put(key, JSON.stringify(value)),
    async list(prefix) {
      const files = await readdir(join(root, prefix), { recursive: true }).catch(() => []);
      return files.map(file => relative(root, join(root, prefix, file)));
    },
    putObject: (key, body) => put(key, body)
  };
}

function r2Store(): Store {
  const config = r2Config();
  const client = createR2Client(config);
  return {
    read: key => readJson(client, config.bucket, key),
    write: (key, value) => putJson(client, config.bucket, key, value),
    list: prefix => listR2Keys(client, config.bucket, prefix),
    async putObject(key, body, contentType) {
      await withR2Retry(() =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable'
          })
        )
      );
    }
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
  const now = new Date();

  if (process.argv.includes('--mirror-images')) {
    const stats = await mirrorProxyImages({ store, ...fetcher, now });
    console.log(`Mirrored ${stats.mirrored}, ${stats.current} already current, ${stats.unmapped} on unmapped sets`);
    return;
  }

  const result = await gatherCityLeagues({ store, fetchText: fetcher.fetchText, now });
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
