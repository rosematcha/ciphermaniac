#!/usr/bin/env node
/**
 * Non-Standard format producer: one report per format under
 * `{R2_REPORTS_PREFIX}/Formats/<id>/`, plus `Formats/index.json`.
 *
 * The runs themselves live in lib/formatMeta.ts; this file supplies R2, the
 * network and the environment.
 */

import process from 'node:process';
import { r2Config, requireEnv } from './lib/env';
import { fetchLimitlessJson } from './lib/onlineFetch';
import { ONLINE_META_CACHE_CONTROL } from './lib/onlineMeta';
import { runFormatMetas } from './lib/formatMeta';
import { createR2Client, putJsonIfChanged, readJson } from './lib/r2.mjs';
import { deleteR2Keys, listR2Keys } from './lib/r2Inventory.mjs';

async function main(): Promise<void> {
  const config = r2Config();
  const client = createR2Client(config);
  const index = await runFormatMetas({
    store: {
      read: <T>(key: string) => readJson<T>(client, config.bucket, key),
      async write(key, value) {
        await putJsonIfChanged(client, config.bucket, key, { value, cacheControl: ONLINE_META_CACHE_CONTROL });
      },
      list: prefix => listR2Keys(client, config.bucket, prefix),
      remove: keys => deleteR2Keys(client, config.bucket, keys)
    },
    fetchJson: fetchLimitlessJson,
    limitlessApiKey: requireEnv('LIMITLESS_API_KEY'),
    now: new Date(),
    reportsPrefix: process.env.R2_REPORTS_PREFIX || 'reports'
  });
  for (const failure of index.failed ?? []) {
    // A GitHub annotation, so a failed format is visible without failing the day's Standard data.
    console.log(`::error title=Format report failed::${failure.id}: ${failure.message}`);
  }
}

main().catch(error => {
  console.error('[format-meta] Failed:', error);
  process.exitCode = 1;
});
