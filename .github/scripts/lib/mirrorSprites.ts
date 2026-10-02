import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { runR2Batch, withR2Retry } from './r2.mjs';
import { deleteR2Keys, listR2Keys } from './r2Inventory.mjs';

const PREFIX = 'pokemon-sprites/gen9/';

interface MirrorOptions {
  bucket: string;
  slugs: readonly string[];
  sourceUrl: (slug: string) => string;
  force?: boolean;
  fetchSource?: typeof fetch;
}

export async function mirrorSprites(client: S3Client, options: MirrorOptions) {
  const { bucket, sourceUrl, force, fetchSource = fetch } = options;
  const slugs = [...new Set(options.slugs)];
  const existing = new Set(await listR2Keys(client, bucket, PREFIX));
  const stats = { uploaded: 0, skipped: 0, missing: 0, removed: 0 };
  await runR2Batch(slugs, async slug => {
    const key = `${PREFIX}${slug}.png`;
    if (!force && existing.has(key)) {
      stats.skipped++;
      return;
    }
    const response = await fetchSource(sourceUrl(slug));
    if (response.status === 404) {
      stats.missing++;
      return;
    }
    if (!response.ok) {
      throw new Error(`Sprite source failed for ${slug}: HTTP ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    await withR2Retry(() =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable'
        })
      )
    );
    stats.uploaded++;
  });
  const expected = new Set(slugs.map(slug => `${PREFIX}${slug}.png`));
  const stale = [...existing].filter(key => !expected.has(key));
  stats.removed = await deleteR2Keys(client, bucket, stale);
  return stats;
}
