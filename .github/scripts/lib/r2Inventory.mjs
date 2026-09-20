import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { withR2Retry } from './r2.mjs';

/** Return every key below a prefix, following all R2 listing pages. */
export async function listR2Keys(client, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const cursor = token;
    const page = await withR2Retry(() =>
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }))
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) {
      throw new Error(`R2 listing for ${prefix} was truncated without a cursor`);
    }
  } while (token);
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
