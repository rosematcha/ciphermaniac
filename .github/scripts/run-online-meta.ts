#!/usr/bin/env node
/**
 * Online-meta producer for the "Online - Last 14 Days" report set.
 *
 * Reads:   assets/card-synonyms.json, assets/data/card-types.json, Limitless
 * Writes:  {R2_REPORTS_PREFIX}/Online - Last 14 Days/**
 *
 * The run itself lives in lib/onlineMeta.ts; this file supplies R2, the
 * network and the environment's flags.
 */

import process from 'node:process';
import { boolEnv, r2Config, requireEnv } from './lib/env';
import { fetchLimitlessJson } from './lib/onlineFetch';
import { ONLINE_META_CACHE_CONTROL, type OnlineMetaStore, runOnlineMeta } from './lib/onlineMeta';
import { createR2Client, putJsonIfChanged, readJson } from './lib/r2.mjs';
import { deleteR2Keys, listR2Keys } from './lib/r2Inventory.mjs';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';
import onlineExclusions from '../../config/online-exclusions.json';

function r2Store(): OnlineMetaStore {
  const config = r2Config();
  const client = createR2Client(config);
  return {
    read: <T>(key: string) => readJson<T>(client, config.bucket, key),
    async write(key, value) {
      await putJsonIfChanged(client, config.bucket, key, { value, cacheControl: ONLINE_META_CACHE_CONTROL });
    },
    list: prefix => listR2Keys(client, config.bucket, prefix),
    remove: keys => deleteR2Keys(client, config.bucket, keys)
  };
}

/** The shared Limitless client, with every cache bypassed. */
const fetchUncached: typeof fetchLimitlessJson = (path, options = {}) =>
  fetchLimitlessJson(path, {
    ...options,
    fetchOptions: {
      ...options.fetchOptions,
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' }
    }
  });

async function main(): Promise<void> {
  const cleanRefresh = boolEnv('CLEAN_MONTH_CACHE');
  await runOnlineMeta({
    store: r2Store(),
    fetchJson: cleanRefresh ? fetchUncached : fetchLimitlessJson,
    limitlessApiKey: requireEnv('LIMITLESS_API_KEY'),
    now: new Date(),
    reportsPrefix: process.env.R2_REPORTS_PREFIX || 'reports',
    exclusions: onlineExclusions,
    thumbnails: archetypeThumbnails || {},
    generateMaster: process.env.GENERATE_MASTER !== 'false',
    generateArchetypes: process.env.GENERATE_ARCHETYPES !== 'false',
    cleanRefresh
  });
}

main().catch(error => {
  console.error('[online-meta] Failed:', error);
  process.exitCode = 1;
});
