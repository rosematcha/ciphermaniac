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

const client = createDataClient({
  resolvePath: path => path,
  ttlMs: SHARE_MS,
  fetch: (input, init) => globalThis.fetch(input, { ...init, cache: 'no-cache' })
});

const PREFIX = '/live/v1/';

/** Null until the poller has seen a round posted. */
export function fetchLiveIndex(slug: string): Promise<LiveIndex | null> {
  return client.fetchJsonOptional<LiveIndex>(`${PREFIX}${encodeURIComponent(slug)}/index.json`);
}

export function fetchLiveRound(slug: string, round: number): Promise<LiveRound | null> {
  return client.fetchJsonOptional<LiveRound>(`${PREFIX}${encodeURIComponent(slug)}/r${round}.json`);
}

/** Null until the poller has published one. */
export function fetchLiveSchedule(): Promise<LiveSchedule | null> {
  return client.fetchJsonOptional<LiveSchedule>(`/${LIVE_SCHEDULE_KEY}`);
}
