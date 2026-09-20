import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { withR2Retry } from './r2.mjs';

/**
 * Yield every object below a prefix, following all R2 listing pages. A page
 * that claims more results but carries no cursor throws: stopping there would
 * hand the caller a short listing that looks complete, and the callers prune
 * and publish from these listings.
 */
export async function* listR2Objects(client, bucket, prefix) {
  let token;
  do {
    const cursor = token;
    const page = await withR2Retry(() =>
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }))
    );
    yield* page.Contents ?? [];
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) {
      throw new Error(`R2 listing for ${prefix} was truncated without a cursor`);
    }
  } while (token);
}

/** Return every key below a prefix, following all R2 listing pages. */
export async function listR2Keys(client, bucket, prefix) {
  const keys = [];
  for await (const object of listR2Objects(client, bucket, prefix)) {
    if (object.Key) {
      keys.push(object.Key);
    }
  }
  return keys;
}

/** Delete exact keys in R2's maximum batch size. */
export async function deleteR2Keys(client, bucket, keys) {
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const chunk = keys.slice(offset, offset + 1000);
    const result = await withR2Retry(() =>
      client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true } })
      )
    );
    if (result.Errors?.length) {
      throw new Error(`R2 rejected ${result.Errors.length} deletion(s)`);
    }
  }
  return keys.length;
}
