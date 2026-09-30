/**
 * Publishing an event's public view to R2 after every change (see
 * PublishedView in shared/tournament/view.ts). A failed publish never fails
 * the change: the stale copy is taken down, so the page falls back to the API
 * until the next change publishes.
 *
 * Two changes can publish out of order, the older landing last. So each copy
 * carries its version, and a publish replaces only an older copy, and only
 * the copy it looked at: R2 refuses the write if another landed in between,
 * and the publish looks again. The copy up only ever moves forward, a burst
 * of writes puts up what it can skip, and nothing asks the database.
 *
 * A publish can also land after the event was deleted. Deleting takes the
 * copy down after the row, so a publish that lands on a copy still up is
 * taken down with it; one that finds no copy up asks the database whether
 * the event is still there.
 */

import { type PublishedView, publishedViewKey } from '../../../shared/tournament/view.js';
import type { Context } from '../auth/env.js';
import { loadVersion, type TournamentRow } from './store.js';
import type { D1Like, PublishBucket, PublishedObject } from '../types.js';
import { publicViewOf } from './access.js';

/** Short: pairings go stale fast, and a poll that finds the edge copy is still a free read. */
export const PUBLISHED_CACHE_CONTROL = 'public, max-age=5';

/**
 * Each refused write means another publish landed first, and a landing only
 * ever moves the copy forward, so the tries run out only when a publish is
 * behind that many others at once: a safety stop, not a limit a round's end
 * reaches.
 */
const MAX_TRIES = 32;

interface PublishEnv {
  REPORTS?: PublishBucket;
  TOURNAMENT_DB?: D1Like;
}

/** The version a copy was published at; -1 for none, or one put up before copies carried it. */
function versionOf(object: PublishedObject | null): number {
  const version = Number(object?.customMetadata?.version);
  return Number.isInteger(version) ? version : -1;
}

/** Only the copy that was looked at, or only onto no copy at all. */
const unchangedSince = (held: PublishedObject | null) =>
  held ? { etagMatches: held.etag } : new Headers({ 'If-None-Match': '*' });

/** Whether the copy up is now `row`'s or newer. */
async function putOver(bucket: PublishBucket, row: TournamentRow, body: string): Promise<'up' | 'landed' | 'raced'> {
  const key = publishedViewKey(row.code);
  const held = await bucket.head(key);
  if (versionOf(held) >= row.version) {
    return 'up';
  }
  const put = await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json', cacheControl: PUBLISHED_CACHE_CONTROL },
    customMetadata: { version: String(row.version) },
    onlyIf: unchangedSince(held)
  });
  if (!put) {
    return 'raced';
  }
  return held ? 'up' : 'landed';
}

export async function publishView(env: PublishEnv, row: TournamentRow): Promise<void> {
  const bucket = env.REPORTS;
  if (!bucket) {
    return;
  }
  const view: PublishedView = publicViewOf(row);
  const body = JSON.stringify(view);
  try {
    for (let tries = 0; tries < MAX_TRIES; tries += 1) {
      const outcome = await putOver(bucket, row, body);
      if (outcome === 'landed') {
        await takeDownIfGone(env, row.code);
      }
      if (outcome !== 'raced') {
        return;
      }
    }
    console.error('Publishing the event view gave up behind other publishes', row.code);
  } catch (error) {
    console.error('Publishing the event view failed', error);
  }
  // A copy left up could stay stale; without one, the page asks the API.
  await unpublishView(bucket, row.code);
}

/** A copy put where there was none may belong to an event deleted meanwhile. */
async function takeDownIfGone(env: PublishEnv, code: string): Promise<void> {
  if (env.TOURNAMENT_DB && (await loadVersion(env.TOURNAMENT_DB, code)) === null) {
    await unpublishView(env.REPORTS, code);
  }
}

/**
 * Publishes once the answer has gone, where the runtime can keep the function
 * alive for it: whoever made the change does not wait on R2. The pages that
 * read the copy poll it seconds apart.
 */
export function publishAfter(context: Pick<Context, 'env' | 'waitUntil'>, row: TournamentRow): Promise<void> {
  const published = publishView(context.env, row);
  if (!context.waitUntil) {
    return published;
  }
  context.waitUntil(published);
  return Promise.resolve();
}

export async function unpublishView(bucket: PublishBucket | undefined, code: string): Promise<void> {
  await bucket?.delete(publishedViewKey(code)).catch((error: unknown) => console.error('Unpublish failed', error));
}
