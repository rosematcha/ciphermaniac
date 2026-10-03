import { type LiveReports, liveReportsKey } from '../../../shared/live/reports.js';
import type { DirtySeat, VoteStore } from './votes.js';

export interface LiveBucket {
  get: (key: string) => Promise<{ etag: string; text: () => Promise<string> } | null>;
  put: (
    key: string,
    value: string,
    options: { httpMetadata: Record<string, string>; onlyIf: { etagMatches: string } | Headers }
  ) => Promise<{ etag: string } | null>;
}

function merge(current: LiveReports | null, seats: readonly DirtySeat[]): LiveReports | null {
  if (seats.length === 0) {
    return null;
  }
  const changed = seats.filter(row => (current?.decks[row.seat] ?? null) !== row.archetype);
  const decks = { ...current?.decks };
  for (const row of changed) {
    if (row.archetype === null) {
      delete decks[row.seat];
    } else {
      decks[row.seat] = row.archetype;
    }
  }
  // Even unchanged decks must invalidate older publishers' ETags before acknowledgment.
  const previous = Date.parse(current?.updatedAt ?? '') || 0;
  return { updatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(), decks };
}

async function attempt(
  bucket: LiveBucket,
  votes: VoteStore,
  slug: string
): Promise<{ updatedAt: string | null } | null> {
  const key = liveReportsKey(slug);
  // Read R2 before D1: a writer publishing newer tallies invalidates this ETag.
  const object = await bucket.get(key);
  const current = object ? (JSON.parse(await object.text()) as LiveReports) : null;
  const seats = await votes.dirty(slug);
  const reports = merge(current, seats);
  if (reports) {
    const written = await bucket.put(key, JSON.stringify(reports), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=30' },
      onlyIf: object ? { etagMatches: object.etag } : new Headers({ 'If-None-Match': '*' })
    });
    if (written === null) {
      return null;
    }
  }
  // An intervening vote increments revision, so its dirty marker survives.
  await votes.acknowledge(slug, seats);
  return { updatedAt: reports?.updatedAt ?? current?.updatedAt ?? null };
}

export async function publishSeats(bucket: LiveBucket, votes: VoteStore, slug: string): Promise<string | null> {
  for (let retry = 0; retry < 5; retry += 1) {
    if (retry > 0) {
      await new Promise(resolve => {
        const backoff = 10 * 2 ** (retry - 1);
        setTimeout(resolve, backoff * (0.5 + Math.random()));
      });
    }
    try {
      const result = await attempt(bucket, votes, slug);
      if (result) {
        return result.updatedAt;
      }
    } catch {
      // Keep the durable marker on transient read, write, or acknowledgment failure.
    }
  }
  throw new Error('Live report publication exhausted retries');
}
