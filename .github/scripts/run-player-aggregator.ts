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

import process from 'node:process';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { buildPlayerAggregates } from '../../functions/lib/onlineMeta/playerAggregator.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');
const FORCE_FULL_REBUILD = parseBoolean(process.env.FORCE_FULL_REBUILD, false);

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

// Aggregator uses bare keys (`reports/tournaments.json`, `players/index.json`)
// so this binding does NOT prefix anything.
const reportsBinding = {
  async get(key: string) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key
        })
      );
      return {
        async text() {
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks).toString('utf-8');
        }
      };
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  },
  async put(key: string, data: string | ArrayBuffer | ArrayBufferView, opts?: any) {
    const body =
      typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data))
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: opts?.httpMetadata?.contentType || 'application/json',
        CacheControl: opts?.httpMetadata?.cacheControl
      })
    );
  }
};

async function main() {
  const t0 = Date.now();
  console.log('[player-aggregator]', {
    bucket: R2_BUCKET_NAME,
    forceFullRebuild: FORCE_FULL_REBUILD
  });

  const result = await buildPlayerAggregates(
    { REPORTS: reportsBinding } as any,
    {
      concurrency: 6,
      r2Concurrency: 8,
      forceFullRebuild: FORCE_FULL_REBUILD
    }
  );

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

main().catch(err => {
  console.error('[player-aggregator] Failed', err);
  process.exit(1);
});
