#!/usr/bin/env node
/**
 * Publishes Play! Limitless's deck categorization rules for the events site.
 *
 * Reads:   Limitless /games/PTCG/decks
 * Writes:  limitless/deck-rules.json
 *
 * The run lives in lib/limitlessDeckRules.ts; this file supplies R2, the
 * network and the environment.
 */

import process from 'node:process';
import { r2Config, requireEnv } from './lib/env';
import { publishDeckRules } from './lib/limitlessDeckRules';
import { ONLINE_META_CACHE_CONTROL } from './lib/onlineMeta';
import { fetchLimitlessJson } from './lib/onlineFetch';
import { createR2Client, putJsonIfChanged } from './lib/r2.mjs';

async function main(): Promise<void> {
  const config = r2Config();
  const client = createR2Client(config);
  const env = { LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY') };
  await publishDeckRules({
    fetchJson: path => fetchLimitlessJson(path, { env }),
    async write(key, value) {
      await putJsonIfChanged(client, config.bucket, key, { value, cacheControl: ONLINE_META_CACHE_CONTROL });
    },
    log: line => console.log(line)
  });
}

main().catch(error => {
  console.error('[deck-rules] Failed:', error);
  process.exitCode = 1;
});
