#!/usr/bin/env node

/**
 * Mirror the gen9 Pokémon sprite icons used by archetype rows into our R2
 * bucket (pokemon-sprites/gen9/{slug}.png), so ArchetypeIcon serves them from
 * r2.ciphermaniac.com instead of hotlinking the Limitless CDN. The component
 * falls back to Limitless for any slug this mirror doesn't have yet, so the
 * script is safe to run incrementally — slugs already in the bucket are skipped.
 *
 * The (Card Metadata) Archetype Icons workflow runs this daily after re-scraping
 * the icon map. To run it by hand:
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET_NAME=ciphermaniac-reports npx tsx scripts/mirror-archetype-sprites.ts
 *
 * Pass --force to re-upload every slug regardless of what's already mirrored.
 */

import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const SOURCE_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';
const DEST_PREFIX = 'pokemon-sprites/gen9';
// Sprites for a given gen are effectively frozen once published.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

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

async function collectSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  const icons = JSON.parse(await readFile('src/data/archetype-icons.json', 'utf-8')) as Record<string, string[]>;
  for (const list of Object.values(icons)) {
    for (const slug of list) {
      slugs.add(slug);
    }
  }
  // Icon slugs only ever come from this committed map (the runtime looks
  // archetypes up in it), so mirroring the map's slugs covers everything.
  return slugs;
}

async function alreadyMirrored(slug: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${DEST_PREFIX}/${slug}.png` }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Sprites are immutable once published, so a slug already in the bucket never
  // needs re-fetching. Pass --force to re-upload everything anyway.
  const force = process.argv.includes('--force');
  const slugs = [...(await collectSlugs())].sort();
  console.log(`Mirroring ${slugs.length} sprites${force ? ' (forced)' : ''}…`);
  let uploaded = 0;
  let skipped = 0;
  let missing = 0;
  for (const slug of slugs) {
    if (!force && (await alreadyMirrored(slug))) {
      skipped += 1;
      continue;
    }
    const res = await fetch(`${SOURCE_BASE}/${slug}.png`);
    if (!res.ok) {
      missing += 1;
      console.warn(`  ✗ ${slug} (${res.status} from source)`);
      continue;
    }
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${DEST_PREFIX}/${slug}.png`,
        Body: Buffer.from(await res.arrayBuffer()),
        ContentType: 'image/png',
        CacheControl: CACHE_CONTROL
      })
    );
    uploaded += 1;
  }
  console.log(`Done: ${uploaded} uploaded, ${skipped} already mirrored, ${missing} missing at source.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
