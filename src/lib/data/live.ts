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
  return client.fetchJsonOptional<LiveRound>(`${PREFIX}${encodeURIComponent(slug)}/r${round}.json${query}`);
}

/** Null until the poller has published one. */
export function fetchLiveSchedule(): Promise<LiveSchedule | null> {
  return client.fetchJsonOptional<LiveSchedule>(`/${LIVE_SCHEDULE_KEY}`);
}

/** Null until someone has reported a deck at the event. */
export function fetchLiveReports(slug: string): Promise<LiveReports | null> {
  return client.fetchJsonOptional<LiveReports>(`/${liveReportsKey(slug)}`);
}

/**
 * Reports one or more seats' decks in a single request, and answers with the
 * archetype now shown for each seat, which may not be the one just reported:
 * a seat only shows the archetype more than half its reports agree on.
 */
export async function submitDeckReports(reports: readonly DeckReport[]): Promise<Record<string, string | null>> {
  const response = await fetch('/api/live/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reports })
  });
  if (!response.ok) {
    throw new Error(`Report failed (${response.status})`);
  }
  return ((await response.json()) as { archetypes: Record<string, string | null> }).archetypes;
}
