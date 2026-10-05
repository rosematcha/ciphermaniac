/**
 * The stores the event locator shows as running their events on the site
 * (shared/events/stores.ts), published to the data bucket whenever one
 * changes: each active store's place, league nights and exceptions. The
 * locator merges it over what Pokedata lists for the same league, so a store
 * on the site says its own schedule, and a change shows within minutes, not
 * at the next daily run.
 */

import { STORES_INDEX_KEY, type StoresIndex } from '../../../shared/events/stores.js';
import type { LeagueNight, NightException } from '../../../shared/accounts/stores.js';
import type { Context } from '../auth/env.js';
import type { D1Like, PublishBucket } from '../types.js';

/** Five minutes at the edge, as the locator's own files. */
const CACHE_CONTROL = 'public, max-age=300';

interface Row {
  id: string;
  league_id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  lat: number | null;
  lon: number | null;
  time_zone: string;
  nights: string;
  exceptions: string;
}

export async function storesIndex(db: D1Like, now = Date.now()): Promise<StoresIndex> {
  const { results } = await db
    .prepare(
      'SELECT id, league_id, name, address, city, region, country, lat, lon, time_zone, nights, exceptions ' +
        "FROM stores WHERE status = 'active' ORDER BY league_id LIMIT 5000"
    )
    .all<Row>();
  return {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    stores: results.map(row => ({
      id: row.id,
      leagueId: row.league_id,
      name: row.name,
      address: row.address,
      city: row.city,
      region: row.region,
      cc: row.country,
      lat: row.lat,
      lon: row.lon,
      timeZone: row.time_zone,
      nights: JSON.parse(row.nights) as LeagueNight[],
      exceptions: JSON.parse(row.exceptions) as NightException[]
    }))
  };
}

/** Read the destination ETag before D1, and reread both after each lost conditional write. */
async function putNewer(bucket: PublishBucket, db: D1Like): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const held = await bucket.head(STORES_INDEX_KEY);
    const index = await storesIndex(db);
    const written = await bucket.put(STORES_INDEX_KEY, JSON.stringify(index), {
      httpMetadata: { contentType: 'application/json', cacheControl: CACHE_CONTROL },
      customMetadata: { updatedAt: index.updatedAt },
      onlyIf: held ? { etagMatches: held.etag } : new Headers({ 'If-None-Match': '*' })
    });
    if (written) {
      return;
    }
  }
  throw new Error('Stores index changed during every publish attempt');
}

/** Writes the index again, after the answer where the runtime keeps the function alive for it. */
export async function publishStores(context: Pick<Context, 'env' | 'waitUntil'>): Promise<void> {
  const { REPORTS: bucket, TOURNAMENT_DB: db } = context.env;
  if (!bucket || !db) {
    return;
  }
  const written = putNewer(bucket, db);
  const done = written.then(
    () => undefined,
    (error: unknown) => console.error('Stores index publish failed', error)
  );
  if (context.waitUntil) {
    context.waitUntil(done);
    return;
  }
  await done;
}
