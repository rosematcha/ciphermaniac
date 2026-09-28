/**
 * Publishing an event's public view to R2 after every change (see
 * PublishedView in shared/tournament/view.ts). A failed publish never fails
 * the change: the page falls back to the API until the next change publishes.
 */

import { type PublishedView, publishedViewKey } from '../../../shared/tournament/view.js';
import type { TournamentRow } from './store.js';
import type { PublishBucket } from '../types.js';
import { publicViewOf } from './access.js';

/** Short: pairings go stale fast, and a poll that finds the edge copy is still a free read. */
export const PUBLISHED_CACHE_CONTROL = 'public, max-age=5';

export async function publishView(bucket: PublishBucket | undefined, row: TournamentRow): Promise<void> {
  if (!bucket) {
    return;
  }
  const view: PublishedView = publicViewOf(row);
  try {
    await bucket.put(publishedViewKey(row.code), JSON.stringify(view), {
      httpMetadata: { contentType: 'application/json', cacheControl: PUBLISHED_CACHE_CONTROL }
    });
  } catch (error) {
    console.error('Publishing the event view failed', error);
  }
}

export async function unpublishView(bucket: PublishBucket | undefined, code: string): Promise<void> {
  await bucket?.delete(publishedViewKey(code)).catch((error: unknown) => console.error('Unpublish failed', error));
}
