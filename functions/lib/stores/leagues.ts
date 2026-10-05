/**
 * Reading what the locator knows of a league (shared/events/leagues.ts) from
 * the data bucket: where the store is, for an application to start from, and
 * the events pokemon.com lists for it, for a store to start one from. Both
 * listings' shards are read at once; the sanctioned one's venue details win,
 * as Cups and Challenges are listed with more care than locals.
 */

import {
  LEAGUE_SOURCES,
  type LeagueEntry,
  type LeagueShard,
  leagueShardOf,
  leagueShardPath
} from '../../../shared/events/leagues.js';
import type { LeagueFound, Listing } from '../../../shared/accounts/types.js';
import type { PublishBucket } from '../types.js';

async function shardEntry(bucket: PublishBucket, path: string, leagueId: string): Promise<LeagueEntry | null> {
  const object = await bucket.get?.(path).catch(() => null);
  if (!object) {
    return null;
  }
  try {
    return (JSON.parse(await object.text()) as LeagueShard).leagues[leagueId] ?? null;
  } catch {
    return null;
  }
}

/** The league's entries in each listing that has it, sanctioned first. */
async function entriesOf(bucket: PublishBucket | undefined, leagueId: string): Promise<LeagueEntry[]> {
  if (!bucket) {
    return [];
  }
  const shard = leagueShardOf(leagueId);
  const found = await Promise.all(
    LEAGUE_SOURCES.map(source => shardEntry(bucket, leagueShardPath(source, shard), leagueId))
  );
  return found.filter((entry): entry is LeagueEntry => entry !== null);
}

/** Where the league's store is, as the locator lists it; null when it lists nothing for the league. */
export async function findLeague(bucket: PublishBucket | undefined, leagueId: string): Promise<LeagueFound | null> {
  const [entry] = await entriesOf(bucket, leagueId);
  if (!entry) {
    return null;
  }
  const { shop, address, city, region, cc, lat, lon, timeZone } = entry;
  return { leagueId, shop, address, city, region, cc, lat, lon, timeZone };
}

/** The league's listed events from `today` (YYYY-MM-DD, the store's date) on, soonest first. */
export async function leagueListings(
  bucket: PublishBucket | undefined,
  leagueId: string,
  today: string
): Promise<Listing[]> {
  const listings = (await entriesOf(bucket, leagueId)).flatMap(entry => entry.listings);
  const seen = new Set<string>();
  return listings
    .filter(listing => listing.date >= today && !seen.has(listing.sanctionId) && seen.add(listing.sanctionId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
