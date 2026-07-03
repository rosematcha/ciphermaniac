/**
 * Card-image WebP pipeline (mobile plan P1.1).
 *
 * Converts card art from the limitless CDN's PNGs (~17/52/118KB per
 * XS/SM/LG tier) into WebP (~4/12/25KB) hosted in our own R2 bucket, cutting
 * the dominant mobile payload by ~75%. Idempotent and incremental: cards
 * already in R2 are skipped, so run it alongside the daily data update to
 * pick up newly-seen cards.
 *
 * Discovery: every (set, number) pair mentioned in tournament master reports
 * (live tournaments from R2 + local Snapshots) and archetype thumbnails.
 *
 * Upload target: card-images/{SET}/{SET}_{NUM}_R_EN_{TIER}.webp
 * plus a `card-images/_ready` marker written after the first successful run —
 * CardImage.tsx only starts preferring R2 once that marker exists, so the
 * site never 404-storms against an empty bucket.
 *
 * Env (same convention as build-rotation-snapshots.ts):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * Usage:
 *   npx tsx scripts/convert-card-images.ts            # convert + upload
 *   npx tsx scripts/convert-card-images.ts --dry-run  # discover + report only
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_BASE = join(ROOT, 'static');
const R2_BASE = 'https://r2.ciphermaniac.com';
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

const TIERS = ['XS', 'SM', 'LG'] as const;
// q=80 is visually transparent for card art at these display sizes.
const WEBP_QUALITY = 80;
const CONCURRENCY = 8;

const DRY_RUN = process.argv.includes('--dry-run');

const r2Configured =
  Boolean(process.env.R2_ACCOUNT_ID) &&
  Boolean(process.env.R2_ACCESS_KEY_ID) &&
  Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
  Boolean(process.env.R2_BUCKET_NAME);

if (!DRY_RUN && !r2Configured) {
  console.error(
    'Missing R2 credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME).\n' +
      'Run with --dry-run to preview the card list without uploading.'
  );
  process.exit(1);
}

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

interface CardRef {
  set: string;
  number: string;
}

/** Zero-pad to the CDN's canonical 3-digit form (PRE_037, not PRE_37). */
function paddedNumber(number: string): string {
  const stripped = number.replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  return parts ? `${parts[1].padStart(3, '0')}${parts[2] ?? ''}` : stripped;
}

function cardKey(ref: CardRef): string {
  return `${ref.set.toUpperCase()}~${paddedNumber(ref.number)}`;
}

function collectFromItems(items: unknown, out: Map<string, CardRef>): void {
  if (!Array.isArray(items)) {
    return;
  }
  for (const item of items) {
    if (item && typeof item === 'object' && 'set' in item && 'number' in item) {
      const set = String((item as { set: unknown }).set ?? '').trim();
      const number = String((item as { number: unknown }).number ?? '').trim();
      if (/^[A-Za-z0-9-]{2,8}$/.test(set) && /^\d+[A-Za-z]?$/.test(number.replace(/^0+/, '') || '0')) {
        const ref = { set: set.toUpperCase(), number };
        out.set(cardKey(ref), ref);
      }
    }
  }
}

function collectFromThumbnails(thumbs: unknown, out: Map<string, CardRef>): void {
  if (!Array.isArray(thumbs)) {
    return;
  }
  for (const t of thumbs) {
    if (typeof t === 'string' && t.includes('/')) {
      const [set, number] = t.split('/');
      if (set && number) {
        const ref = { set: set.toUpperCase(), number };
        out.set(cardKey(ref), ref);
      }
    }
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

async function discoverCards(): Promise<CardRef[]> {
  const cards = new Map<string, CardRef>();

  // Live tournaments (R2 is the production source of truth).
  const tournaments = (await fetchJson(`${R2_BASE}/reports/tournaments.json`)) as string[] | null;
  const liveNames = [...(tournaments ?? []), 'Online - Last 14 Days'];
  for (const name of liveNames) {
    const master = (await fetchJson(`${R2_BASE}/reports/${encodeURIComponent(name)}/master.json`)) as {
      items?: unknown;
    } | null;
    collectFromItems(master?.items, cards);
    const archeIndex = (await fetchJson(`${R2_BASE}/reports/${encodeURIComponent(name)}/archetypes/index.json`)) as
      | { archetypes?: { thumbnails?: unknown }[] }
      | { thumbnails?: unknown }[]
      | null;
    const list = Array.isArray(archeIndex) ? archeIndex : (archeIndex?.archetypes ?? []);
    for (const entry of list) {
      collectFromThumbnails((entry as { thumbnails?: unknown }).thumbnails, cards);
    }
  }

  // Local rotation snapshots (immutable historical reports).
  try {
    const snapshotsDir = join(STATIC_BASE, 'reports', 'Snapshots');
    for (const snapshot of await readdir(snapshotsDir)) {
      const masterPath = join(snapshotsDir, snapshot, 'master.json');
      try {
        const master = JSON.parse(await readFile(masterPath, 'utf8')) as { items?: unknown };
        collectFromItems(master.items, cards);
      } catch {
        /* index.json or snapshots without a master — skip */
      }
    }
  } catch {
    /* no local snapshots checkout — R2 discovery alone is fine */
  }

  return [...cards.values()];
}

async function r2Has(key: string): Promise<boolean> {
  if (!s3Client || !r2Bucket) {
    return false;
  }
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const stats = { uploaded: 0, skipped: 0, missingSource: 0, failed: 0, pngBytes: 0, webpBytes: 0 };

async function convertCard(ref: CardRef): Promise<void> {
  const setU = ref.set.toUpperCase();
  const num = paddedNumber(ref.number);
  for (const tier of TIERS) {
    const key = `card-images/${setU}/${setU}_${num}_R_EN_${tier}.webp`;
    if (await r2Has(key)) {
      stats.skipped++;
      continue;
    }
    const sourceUrl = `${LIMITLESS_CDN}/${setU}/${setU}_${num}_R_EN_${tier}.png`;
    let png: ArrayBuffer;
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) {
        stats.missingSource++;
        continue;
      }
      png = await res.arrayBuffer();
    } catch {
      stats.missingSource++;
      continue;
    }
    try {
      const webp = await sharp(Buffer.from(png)).webp({ quality: WEBP_QUALITY }).toBuffer();
      stats.pngBytes += png.byteLength;
      stats.webpBytes += webp.byteLength;
      if (!DRY_RUN && s3Client && r2Bucket) {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: r2Bucket,
            Key: key,
            Body: webp,
            ContentType: 'image/webp',
            // Card art for a given set/number/tier never changes.
            CacheControl: 'public, max-age=31536000, immutable'
          })
        );
      }
      stats.uploaded++;
    } catch (err) {
      stats.failed++;
      console.error(`  convert/upload failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Discovering cards${DRY_RUN ? ' (dry run)' : ''}...`);
  const cards = await discoverCards();
  console.log(`Found ${cards.length} unique cards (${cards.length * TIERS.length} tier objects).`);
  if (cards.length === 0) {
    console.error('No cards discovered — check network access to r2.ciphermaniac.com.');
    process.exit(1);
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < cards.length) {
      const ref = cards[cursor++];
      await convertCard(ref);
      const done = cursor;
      if (done % 100 === 0) {
        console.log(`  ${done}/${cards.length} cards processed...`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(
    `\nDone. uploaded=${stats.uploaded} skipped(existing)=${stats.skipped} ` +
      `missing-source=${stats.missingSource} failed=${stats.failed}\n` +
      `PNG ${mb(stats.pngBytes)}MB -> WebP ${mb(stats.webpBytes)}MB ` +
      `(${stats.pngBytes > 0 ? Math.round(100 - (stats.webpBytes / stats.pngBytes) * 100) : 0}% smaller)`
  );

  // The marker gates CardImage's R2-first behavior; only write it when the
  // bucket actually has content and nothing hard-failed.
  if (!DRY_RUN && s3Client && r2Bucket && stats.failed === 0 && (stats.uploaded > 0 || stats.skipped > 0)) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: 'card-images/_ready',
        Body: JSON.stringify({ generatedAt: new Date().toISOString(), cards: cards.length }),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=86400'
      })
    );
    console.log('Wrote card-images/_ready marker — CardImage will now prefer R2 WebP.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
