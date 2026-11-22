import { type _Object, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { withR2Retry } from '../r2.mjs';

/**
 * Split boundaries for one prefix: `prefix + p` for every two-digit `p` from 10 to 99. Any sorted
 * strings give a correct listing; these only spread decimal ids into ranges of similar size.
 */
export function decimalBoundaries(prefix: string): string[] {
  return Array.from({ length: 90 }, (_, index) => `${prefix}${index + 10}`);
}

/** R2 orders keys by UTF-8 bytes, which JavaScript's UTF-16 comparison does not match past ASCII. */
function pastBound(key: string, bound: string): boolean {
  return Buffer.compare(Buffer.from(key), Buffer.from(bound)) > 0;
}

interface Listing {
  client: S3Client;
  bucket: string;
  prefix: string;
}

/** Keys in (after, upTo]: `after` is exclusive as R2's StartAfter is, a missing `upTo` is unbounded. */
interface KeyRange {
  after?: string;
  upTo?: string;
}

/** Keep one page's keys inside the range; `done` once a key passes the upper bound. */
function keepInRange(contents: _Object[], { after, upTo }: KeyRange): { kept: _Object[]; done: boolean } {
  // Keys at or below the lower bound would only come back if StartAfter were ignored.
  const above = after === undefined ? contents : contents.filter(object => pastBound(object.Key ?? '', after));
  const end = upTo === undefined ? -1 : above.findIndex(object => pastBound(object.Key ?? '', upTo));
  return end < 0 ? { kept: above, done: false } : { kept: above.slice(0, end), done: true };
}

/** List one range, stopping at the first page that passes its upper bound. */
async function listRange({ client, bucket, prefix }: Listing, range: KeyRange): Promise<_Object[]> {
  const objects: _Object[] = [];
  let token: string | undefined;
  do {
    const cursor = token;
    const start = cursor ? { ContinuationToken: cursor } : range.after ? { StartAfter: range.after } : {};
    const page = await withR2Retry(() =>
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ...start }))
    );
    const { kept, done } = keepInRange(page.Contents ?? [], range);
    objects.push(...kept);
    if (done) {
      return objects;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) {
      throw new Error(`R2 listing for ${prefix} was truncated without a cursor`);
    }
  } while (token);
  return objects;
}

/**
 * Every object below a prefix, listed as contiguous key ranges side by side. Range i holds the keys
 * in (b[i-1], b[i]], with the first range open below and the last open above, so the ranges cover
 * the listing exactly once and their concatenation is the sorted listing (proved in
 * proofs/RangedListing.lean). Boundaries must be strictly increasing.
 */
export async function listR2ObjectsInRanges(
  listing: Listing,
  boundaries: readonly string[],
  concurrency = 16
): Promise<_Object[]> {
  if (boundaries.some((bound, index) => index > 0 && !pastBound(bound, boundaries[index - 1]))) {
    throw new Error('Listing boundaries must be strictly increasing');
  }
  const ranges: KeyRange[] = Array.from({ length: boundaries.length + 1 }, (_, index) => ({
    after: boundaries[index - 1],
    upTo: boundaries[index]
  }));
  const results = new Array<_Object[]>(ranges.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ranges.length) {
      const index = next++;
      results[index] = await listRange(listing, ranges[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, () => worker()));
  return results.flat();
}
