/**
 * Publishing an event's public view to R2 after every change (see
 * PublishedView in shared/tournament/view.ts). A failed publish never fails
 * the change: the stale copy is taken down, so the page falls back to the API
 * until the next change publishes.
 *
 * Two changes can publish out of order, the older landing last, and a publish
 * can land after the event was deleted. So every publish looks at the event
 * again once its copy is up: a newer version goes up in its place, and a
 * deleted event's copy comes down. Whatever publishes last has checked after
 * its own write, so the copy that stays is the newest; one still behind after
 * a burst of writes comes down, and pages ask the API until the next publish.
 */

import { type PublishedView, publishedViewKey } from '../../../shared/tournament/view.js';
import type { Context } from '../auth/env.js';
import { loadTournament, loadVersion, type TournamentRow } from './store.js';
import type { D1Like, PublishBucket } from '../types.js';
import { publicViewOf } from './access.js';

/** Short: pairings go stale fast, and a poll that finds the edge copy is still a free read. */
export const PUBLISHED_CACHE_CONTROL = 'public, max-age=5';

/** Enough for a burst of writes; the write after that publishes for itself. */
const MAX_PUBLISHES = 3;

interface PublishEnv {
  REPORTS?: PublishBucket;
  TOURNAMENT_DB?: D1Like;
}

/** Puts the row's view up; false when R2 refused it. */
async function put(bucket: PublishBucket, row: TournamentRow): Promise<boolean> {
  const view: PublishedView = publicViewOf(row);
  try {
    await bucket.put(publishedViewKey(row.code), JSON.stringify(view), {
      httpMetadata: { contentType: 'application/json', cacheControl: PUBLISHED_CACHE_CONTROL }
    });
    return true;
  } catch (error) {
    console.error('Publishing the event view failed', error);
    return false;
  }
}

/**
 * After a publish: the newer row to publish in its place, or null when the
 * copy up stands. A deleted event's copy is taken down.
 */
async function supersededBy(env: PublishEnv, published: TournamentRow): Promise<TournamentRow | null> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return null;
  }
  const version = await loadVersion(db, published.code);
  if (version === null) {
    await unpublishView(env.REPORTS, published.code);
    return null;
  }
  return version > published.version ? loadTournament(db, published.code) : null;
}

export async function publishView(env: PublishEnv, row: TournamentRow): Promise<void> {
  const bucket = env.REPORTS;
  if (!bucket) {
    return;
  }
  let next: TournamentRow | null = row;
  for (let attempt = 0; next && attempt < MAX_PUBLISHES; attempt += 1) {
    if (!(await put(bucket, next))) {
      // A copy left up would stay stale; without one, the page asks the API.
      await unpublishView(bucket, row.code);
      return;
    }
    next = await supersededBy(env, next);
  }
  if (next) {
    // Still behind after a burst of writes, and the newest may have gone up before this copy did.
    await unpublishView(bucket, row.code);
  }
}

/**
 * Publishes once the answer has gone, where the runtime can keep the function
 * alive for it: whoever made the change does not wait on R2 and the look back
 * at the database. The pages that read the copy poll it seconds apart.
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
