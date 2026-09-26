/**
 * Live round artifacts: `live/v1/{slug}/index.json` (the current round, a
 * couple of hundred bytes) and `r{round}.json` (every table of a round).
 *
 * Written minute by minute by `.github/scripts/run-live-rounds.ts`, so not part
 * of a data release: identity path resolver, like Pack EV. The zone rewrites
 * browser `Cache-Control` to hours whatever the object says, so every read
 * revalidates with the edge, which does honour the object's thirty seconds.
 * @module src/lib/data/live
 */

import { createDataClient } from './client';
import { LIVE_SCHEDULE_KEY } from '../../../shared/live/schedule';
import type { LiveIndex, LiveRound, LiveSchedule } from '../../../shared/live/types';

/** Shorter than the poll interval, so a poll always refetches while two readers still share one request. */
const SHARE_MS = 20_000;

/** Shared with the live-page-only readers (`./liveReports`), so every live read shares one cache. */
export const liveClient = createDataClient({
  resolvePath: path => path,
  ttlMs: SHARE_MS,
  fetch: (input, init) => globalThis.fetch(input, { ...init, cache: 'no-cache' })
});

const PREFIX = '/live/v1/';

/** Null until the poller has seen a round posted. */
export function fetchLiveIndex(slug: string): Promise<LiveIndex | null> {
  return liveClient.fetchJsonOptional<LiveIndex>(`${PREFIX}${encodeURIComponent(slug)}/index.json`);
}

/**
 * A round file. The edge holds each file thirty seconds on its own clock, so an
 * index just read can name a round whose plain URL still serves the copy from
 * before it; a reader keyed on the index would then keep that copy until the
 * round next changed, which for its last result is the next round. Read under
 * the index hash (`roundVersion` in lib/liveRounds), the file is at a URL nothing older is cached
 * under, and the poller writes a round before the index that names it.
 * @param version - The index hash the round is read at; omitted for a round the event has left
 */
export function fetchLiveRound(slug: string, round: number, version?: string): Promise<LiveRound | null> {
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return liveClient.fetchJsonOptional<LiveRound>(`${PREFIX}${encodeURIComponent(slug)}/r${round}.json${query}`);
}

/** Null until the poller has published one. */
export function fetchLiveSchedule(): Promise<LiveSchedule | null> {
  return liveClient.fetchJsonOptional<LiveSchedule>(`/${LIVE_SCHEDULE_KEY}`);
}
