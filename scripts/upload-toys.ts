#!/usr/bin/env node

/**
 * Sync static/toys/ to R2 under the same keys (toys/...).
 *
 * Production never serves /toys/* from Pages — the SPA fallback would answer
 * any missing path with HTML and a 200 — so toy data must live on R2 next to
 * reports/ and players/. Run after scrape-memorial.py:
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET_NAME=ciphermaniac-reports npx tsx scripts/upload-toys.ts
 */

import process from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const TOYS_DIR = 'static/toys';
const CACHE_CONTROL = 'public, max-age=21600';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  }
});
const bucket = requireEnv('R2_BUCKET_NAME');

function contentTypeFor(path: string): string {
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.webp')) {
    return 'image/webp';
  }
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  return 'application/octet-stream';
}

async function main() {
  const files = await readdir(TOYS_DIR, { recursive: true, withFileTypes: true });
  let uploaded = 0;
  for (const entry of files) {
    if (!entry.isFile() || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = join(entry.parentPath, entry.name);
    const key = `toys/${relative(TOYS_DIR, fullPath).split(sep).join('/')}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(fullPath),
        ContentType: contentTypeFor(entry.name),
        CacheControl: CACHE_CONTROL
      })
    );
    uploaded += 1;
    console.log(`  ✓ ${key}`);
  }
  console.log(`Uploaded ${uploaded} files to ${bucket}/toys/`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
