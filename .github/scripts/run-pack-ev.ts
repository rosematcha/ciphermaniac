#!/usr/bin/env node

/**
 * Pack-EV producer for /tools/pack-ev.
 *
 * Reads:   config/pack-ev.json (slot model and pull rates), TCGCSV
 * Writes:  reports/pack-ev/{SET}.json, reports/pack-ev/index.json
 *
 * Without R2 (local development), write to a directory instead:
 *   npx tsx .github/scripts/run-pack-ev.ts --out .cache/pack-ev
 */

import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { r2Config } from './lib/env.ts';
import { createR2Client, putJson } from './lib/r2.mjs';
import { type FetchJson, PACK_EV_CACHE_CONTROL, type PackEvPublisher, runPackEv } from './lib/packEv.ts';
import type { PackEvConfig } from '../../shared/packEv/types.ts';
import rawConfig from '../../config/pack-ev.json';

const USER_AGENT = 'ciphermaniac-pack-ev/1.0 (+https://ciphermaniac.com)';
const REQUEST_TIMEOUT_MS = 30_000;

const fetchJson: FetchJson = async url => {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return response.json();
};

function localPublisher(root: string): PackEvPublisher {
  return {
    async write(key, value) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value));
    }
  };
}

function r2Publisher(): PackEvPublisher {
  const config = r2Config({ defaultBucket: 'ciphermaniac-reports' });
  const client = createR2Client(config);
  return {
    write: (key, value) =>
      putJson(client, config.bucket, key, value, {
        cacheControl: PACK_EV_CACHE_CONTROL,
        contentType: 'application/json'
      })
  };
}

function outDirectory(): string | null {
  const flag = process.argv.indexOf('--out');
  return flag === -1 ? null : (process.argv[flag + 1] ?? null);
}

async function main(): Promise<void> {
  const out = outDirectory();
  const index = await runPackEv({
    config: rawConfig as unknown as PackEvConfig,
    fetchJson,
    publisher: out ? localPublisher(out) : r2Publisher(),
    log: message => console.log(message)
  });
  console.log(`Published ${index.sets.length} sets${out ? ` to ${out}` : ''}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
