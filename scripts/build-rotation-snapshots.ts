/**
 * Build frozen-in-time snapshots for each historical Pokemon TCG rotation, so
 * pages for rotated cards/archetypes (e.g. /cards/SVI/86, /archetypes/gardevoir-ex)
 * resolve to the meta as it stood in the 30 days before that card or archetype
 * rotated out of Standard.
 *
 * Reads exclusively from R2: tournaments.json and each in-window tournament's
 * decks.json. No Limitless API calls, no API key needed. Note that R2 only
 * persists in-person events (regionals/internationals/specials) — the rolling
 * online meta isn't snapshotted per-event, so the older rotations (2023, 2024)
 * with no R2 coverage will simply be skipped.
 *
 * Modes:
 *   - Local (default): writes to `static/reports/Snapshots/{date}/...`. The
 *     frontend's snapshot fetchers check `import.meta.env.DEV` and read these
 *     local files in dev.
 *   - R2 deploy: if R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/
 *     R2_BUCKET_NAME are all set, ALSO uploads each write to R2.
 *
 * Usage:
 *   npx tsx scripts/build-rotation-snapshots.ts             # all rotations
 *   npx tsx scripts/build-rotation-snapshots.ts 2026-04-10  # single rotation
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { runRotationSnapshot } from '../functions/lib/onlineMeta/snapshotGenerator';
import { rebuildSnapshotIndex, type RotationDescriptor } from '../functions/lib/onlineMeta/snapshotIndexBuilder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_BASE = join(ROOT, 'static');
const R2_BASE = 'https://r2.ciphermaniac.com';

// Rotation calendar. Pre-rotation snapshots aggregate the 30 days before each date.
// The user reported "April 11, 2024" in the original list; treated as a typo for
// 2025-04-11 based on Limitless's published rotation calendar. Revisit if wrong.
const ROTATIONS: RotationDescriptor[] = [
  { date: '2023-04-14', label: '2023 rotation' },
  { date: '2024-04-05', label: '2024 rotation' },
  { date: '2025-04-11', label: '2025 rotation' },
  { date: '2026-04-10', label: '2026 rotation' }
];

const r2Configured =
  Boolean(process.env.R2_ACCOUNT_ID) &&
  Boolean(process.env.R2_ACCESS_KEY_ID) &&
  Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
  Boolean(process.env.R2_BUCKET_NAME);

const s3Client = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
      }
    })
  : null;
const r2Bucket = process.env.R2_BUCKET_NAME;

async function readLocal(key: string): Promise<string | null> {
  try {
    return await readFile(join(OUT_BASE, key), 'utf8');
  } catch {
    return null;
  }
}

async function readFromR2Public(key: string): Promise<string | null> {
  const url = `${R2_BASE}/${encodeURI(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  return res.text();
}

async function writeLocal(key: string, body: string | Uint8Array): Promise<void> {
  const fullPath = join(OUT_BASE, key);
  await mkdir(dirname(fullPath), { recursive: true });
  if (typeof body === 'string') {
    await writeFile(fullPath, body);
  } else {
    await writeFile(fullPath, Buffer.from(body));
  }
}

async function writeToR2(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
  if (!s3Client || !r2Bucket) {
    return;
  }
  // Same policy as functions/lib/onlineMeta/storageWriter.ts (P3.1): dated
  // snapshot dirs are immutable; the rebuilt-on-rotation index gets 6 hours.
  const cacheControl = /^reports\/Snapshots\/\d{4}-\d{2}-\d{2}\//.test(key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=21600';
  await s3Client.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: typeof body === 'string' ? body : Buffer.from(body),
      ContentType: contentType,
      CacheControl: cacheControl
    })
  );
}

// Env shim mirroring the Cloudflare R2 binding shape that the pipeline expects
// (env.REPORTS.get / env.REPORTS.put). `get` reads local first then falls back
// to public R2; `put` writes locally and (if configured) to R2.
const env = {
  REPORTS: {
    async get(key: string) {
      const local = await readLocal(key);
      if (local !== null) {
        return { text: async () => local };
      }
      const remote = await readFromR2Public(key);
      if (remote !== null) {
        return { text: async () => remote };
      }
      return null;
    },
    async put(key: string, data: string | Uint8Array | Buffer, opts?: { httpMetadata?: { contentType?: string } }) {
      const body = data instanceof Buffer ? new Uint8Array(data) : data;
      const contentType = opts?.httpMetadata?.contentType || 'application/octet-stream';
      await writeLocal(key, body as string | Uint8Array);
      await writeToR2(key, body as string | Uint8Array, contentType);
    }
  }
};

async function main() {
  const arg = process.argv[2];
  const targets = arg ? ROTATIONS.filter(r => r.date === arg) : ROTATIONS;
  if (!targets.length) {
    console.error(`[snapshots] No matching rotation for "${arg}". Known: ${ROTATIONS.map(r => r.date).join(', ')}`);
    process.exit(1);
  }

  console.info(
    `[snapshots] Writing to ${r2Configured ? `static/ + R2 (${r2Bucket})` : 'static/ only (no R2 creds)'}; targets: ${targets.map(t => t.date).join(', ')}`
  );

  const results = [];
  for (const target of targets) {
    try {
      const result = await runRotationSnapshot(env as unknown as object, {
        rotationDate: target.date,
        label: target.label
      });
      results.push(result);
      if (!result.success) {
        console.warn(`[snapshots] ${target.date}: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[snapshots] ${target.date} failed:`, err);
      results.push({ success: false, rotationDate: target.date, reason: String(err) });
    }
  }

  console.info('[snapshots] Rebuilding snapshot index...');
  const index = await rebuildSnapshotIndex(env as unknown as object, ROTATIONS);
  console.info(
    `[snapshots] Index: ${Object.keys(index.cardsBySetNumber).length} card slots, ${Object.keys(index.archetypes).length} archetype slugs across ${index.rotations.length} rotations`
  );
  console.info('[snapshots] Done', results.map(r => `${r.rotationDate}=${r.success ? 'ok' : 'skip'}`).join(' '));
}

main().catch(err => {
  console.error('[snapshots] Fatal', err);
  process.exit(1);
});
