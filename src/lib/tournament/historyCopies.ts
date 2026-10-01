/**
 * Where History's rows read their events from: each event's public copy on
 * R2, as the event page reads it (see history.ts for what a row takes out of
 * it). A long History therefore costs reads at the edge, not function
 * requests: a page asks for a copy only as its row comes into view, four at
 * a time. A finished event's copy no longer changes, so the browser's cache
 * may answer for it; a live or upcoming one is asked of the edge each time.
 * A copy the edge does not have yet comes from the API, as on the event page.
 */

import type { HistoryEntry } from '../../../shared/accounts/types';
import type { PublishedView } from '../../../shared/tournament/view';
import { createLimiter } from '../concurrency';
import { fetchPublished, fetchView } from './api';
import { type EntryResult, readEntry } from './history';

/** The event's copy: the edge's, or the API's when the edge has none. */
async function copyOf(entry: HistoryEntry): Promise<PublishedView | null> {
  const cache = entry.status === 'finished' ? 'default' : 'no-cache';
  const published = await fetchPublished(entry.code, cache).catch(() => null);
  return published ?? fetchView(entry.code);
}

const limit = createLimiter(4);

/** Reads one entry's event, waiting its turn behind the other rows' reads. */
export function loadEntry(entry: HistoryEntry): Promise<EntryResult | null> {
  return limit(async () => {
    const view = await copyOf(entry);
    return view ? readEntry(entry, view) : null;
  });
}
