#!/usr/bin/env node

/**
 * Career-wide player aggregator runner.
 *
 * Wires an R2-binding-shaped adapter (backed by the S3 SDK) into the same
 * `buildPlayerAggregates` worker code that runs in Cloudflare. The aggregator
 * is incremental via `players/_manifest.json`, so the first CI run back-fills
 * everything and subsequent runs only rewrite players whose tournament
 * membership changed.
 *
 * Reads:  reports/tournaments.json + reports/{key}/{players,decks,meta}.json
 * Writes: players/index.json, players/{id}/profile.json, players/{id}/decks.json,
 *         players/_manifest.json
 */

import { boolEnv, requireEnv } from './lib/env.ts';
import process from 'node:process';
import { createR2Client, createReportsBinding, putJson } from './lib/r2.mjs';
import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.ts';
import { requireEventBodies } from '../../shared/onlineMeta/requiredEventBodies.ts';
import { loadEventSources } from './lib/build/productionRelease.ts';
import { builderRevision, PLAYER_BUILD_FILES } from './lib/build/revision';
import { buildTournamentCatalog } from './event-cli.ts';

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');
const FORCE_FULL_REBUILD = boolEnv('FORCE_FULL_REBUILD');

const s3Client = createR2Client({
  accountId: R2_ACCOUNT_ID,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY
});

// Aggregator uses bare keys (`reports/tournaments.json`, `players/index.json`)
// so this binding does NOT prefix anything.
const reportsBinding = createReportsBinding(s3Client, R2_BUCKET_NAME);

async function readJson<T>(key: string): Promise<T | null> {
  const object = await reportsBinding.get(key);
  return object ? ((await object.json()) as T) : null;
}

async function main() {
  const t0 = Date.now();
  const { sources } = await loadEventSources({ read: readJson });
  const catalog = buildTournamentCatalog(Object.keys(sources));
  const productionBinding = {
    ...reportsBinding,
    // The aggregator writes only players whose events changed, and each body carries a fresh
    // generatedAt, so the binding's compare-first HEAD never matched: a wasted round trip a write.
    put: (key: string, data: string, opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) =>
      putJson(s3Client, R2_BUCKET_NAME, key, data, {
        contentType: opts?.httpMetadata?.contentType,
        cacheControl: opts?.httpMetadata?.cacheControl
      }),
    get: (key: string) => {
      if (key === 'reports/tournaments.json') {
        return Promise.resolve({
          text: () => Promise.resolve(JSON.stringify(catalog)),
          json: () => Promise.resolve(catalog)
        });
      }
      const match = /^reports\/(\d{4}-\d{2}-\d{2},[^/]+)\/(.+)$/.exec(key);
      const root = match ? sources[match[1]] : undefined;
      return reportsBinding.get(root && match ? `${root.replace(/^\/+/, '')}/${match[2]}` : key);
    }
  };
  console.log('[player-aggregator]', {
    bucket: R2_BUCKET_NAME,
    forceFullRebuild: FORCE_FULL_REBUILD
  });

  // Every selected event must load whole, decklists and meta included, or nothing is written.
  const result = await buildPlayerAggregates({ REPORTS: requireEventBodies(productionBinding) } as any, {
    concurrency: 6,
    // Writes are pure latency (about 0.5 s each); a full rebuild took 110 minutes at 8.
    r2Concurrency: 32,
    forceFullRebuild: FORCE_FULL_REBUILD,
    requireEveryEvent: true,
    builderRevision: await builderRevision(PLAYER_BUILD_FILES),
    // Immutable event metas carry no fetch timestamp; the content-addressed
    // root changes exactly when the event's content does.
    fingerprintOf: key => sources[key]
  });

  const ms = Date.now() - t0;
  console.log('[player-aggregator] Done', {
    skippedNoChanges: result.skippedNoChanges,
    profileCount: result.profileCount,
    profilesWritten: result.profilesWritten,
    indexEntries: result.index.length,
    tournamentsScanned: result.tournamentsScanned,
    tournamentsSkipped: result.tournamentsSkipped,
    durationMs: ms
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs');
    const lines = [
      '## Player Aggregator',
      '',
      `- **Skipped (no changes)**: ${result.skippedNoChanges ? 'Yes' : 'No'}`,
      `- **Profiles tracked**: ${result.profileCount}`,
      `- **Profiles rewritten**: ${result.profilesWritten}`,
      `- **Index entries**: ${result.index.length}`,
      `- **Tournaments scanned**: ${result.tournamentsScanned}`,
      `- **Tournaments skipped (load failures)**: ${result.tournamentsSkipped}`,
      `- **Duration**: ${(ms / 1000).toFixed(1)}s`,
      `- **Force full rebuild**: ${FORCE_FULL_REBUILD ? 'Yes' : 'No'}`,
      ''
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}

main().catch((err: unknown) => {
  console.error('[player-aggregator] Failed', err);
  process.exit(1);
});
