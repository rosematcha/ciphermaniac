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
import { type DeckReport, type LiveReports, liveReportsKey } from '../../../shared/live/reports';
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

/** Null until someone has reported a deck at the event. */
export function fetchLiveReports(slug: string): Promise<LiveReports | null> {
  return client.fetchJsonOptional<LiveReports>(`/${liveReportsKey(slug)}`);
}

/** The archetype now shown for the seat, which may not be the one just reported. */
export async function submitDeckReport(report: DeckReport): Promise<string | null> {
  const response = await fetch('/api/live/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report)
  });
  if (!response.ok) {
    throw new Error(`Report failed (${response.status})`);
  }
  return ((await response.json()) as { archetype: string | null }).archetype;
}
