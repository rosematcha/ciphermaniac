/**
 * Live round artifacts: `live/v1/{labsCode}/index.json` (the current round, a
 * couple of hundred bytes) and `r{round}.json` (every table of a round).
 *
 * Written minute by minute by `.github/scripts/run-live-rounds.ts`, so not part
 * of a data release: identity path resolver, like Pack EV. The zone rewrites
 * browser `Cache-Control` to hours whatever the object says, so every read
 * revalidates with the edge, which does honour the object's thirty seconds.
 * @module src/lib/data/live
 */

import { createDataClient } from './client';
import type { LiveIndex, LiveRound } from '../../../shared/live/types';

/** Shorter than the poll interval, so a poll always refetches while two readers still share one request. */
const SHARE_MS = 20_000;

const client = createDataClient({
  resolvePath: path => path,
  ttlMs: SHARE_MS,
  fetch: (input, init) => globalThis.fetch(input, { ...init, cache: 'no-cache' })
});

const PREFIX = '/live/v1/';

/** Null until the poller has seen a round posted. */
export function fetchLiveIndex(labsCode: string): Promise<LiveIndex | null> {
  return client.fetchJsonOptional<LiveIndex>(`${PREFIX}${encodeURIComponent(labsCode)}/index.json`);
}

export function fetchLiveRound(labsCode: string, round: number): Promise<LiveRound | null> {
  return client.fetchJsonOptional<LiveRound>(`${PREFIX}${encodeURIComponent(labsCode)}/r${round}.json`);
}
