/**
 * Read-only census of the whole bucket. The retention plan only totals
 * `releases/v1/`, so this is the figure to hold against the dashboard: every
 * tree by objects and bytes, plus unfinished multipart uploads, which no object
 * listing shows and R2 still bills.
 */
import { ListMultipartUploadsCommand, ListPartsCommand, type S3Client } from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import { createR2Client, withR2Retry } from './lib/r2.mjs';
import { r2Config } from './lib/env';
import { summarizeInventory } from './lib/build/bucketInventory';
import { createRetentionStore } from './prune-releases';

interface PendingUpload {
  key: string;
  initiated: string | null;
  bytes: number;
}

async function uploadBytes(client: S3Client, bucket: string, key: string, uploadId: string): Promise<number> {
  let bytes = 0;
  let marker: string | undefined;
  do {
    const cursor = marker;
    const page = await withR2Retry(() =>
      client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: cursor }))
    );
    bytes += (page.Parts ?? []).reduce((sum, part) => sum + (part.Size ?? 0), 0);
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return bytes;
}

async function pendingUploads(client: S3Client, bucket: string): Promise<PendingUpload[]> {
  const uploads: PendingUpload[] = [];
  let keyMarker: string | undefined;
  let idMarker: string | undefined;
  do {
    const cursor = { KeyMarker: keyMarker, UploadIdMarker: idMarker };
    const page = await withR2Retry(() => client.send(new ListMultipartUploadsCommand({ Bucket: bucket, ...cursor })));
    for (const upload of page.Uploads ?? []) {
      if (upload.Key && upload.UploadId) {
        uploads.push({
          key: upload.Key,
          initiated: upload.Initiated?.toISOString() ?? null,
          bytes: await uploadBytes(client, bucket, upload.Key, upload.UploadId)
        });
      }
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    idMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);
  return uploads;
}

async function main(): Promise<void> {
  const config = r2Config();
  const client = createR2Client(config);
  const objects: Array<{ key: string; size: number }> = [];
  for await (const { key, size } of createRetentionStore(client, config.bucket).list('')) {
    objects.push({ key, size });
  }
  const trees = summarizeInventory(objects);
  const uploads = await pendingUploads(client, config.bucket);
  const report = {
    objects: trees.reduce((sum, tree) => sum + tree.objects, 0),
    bytes: trees.reduce((sum, tree) => sum + tree.bytes, 0),
    pendingUploadBytes: uploads.reduce((sum, upload) => sum + upload.bytes, 0),
    trees,
    uploads
  };
  await writeFile('bucket-inventory.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
