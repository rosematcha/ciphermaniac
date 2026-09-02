/**
 * Player prize earnings.
 *
 * Unlike every other reader here, this one does NOT go through `dataClient`:
 * these payloads are build artifacts (refreshed by `npm run crawl:players`
 * then `npm run build:earnings`) rather than pipeline output on R2, so they are
 * served same-origin in dev and in production alike.
 * @module src/lib/data/earnings
 */

import type { EarningsEventsPayload, EarningsPayload } from '../../../shared/earningsTypes.js';

const EARNINGS_PATH = '/earnings.json';
const EVENTS_PATH = '/earnings-events.json';

async function fetchStatic<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchEarnings(): Promise<EarningsPayload> {
  return fetchStatic<EarningsPayload>(EARNINGS_PATH);
}

/**
 * Per-event detail, for expanded rows only.
 *
 * Three times the size of the leaderboard and needed by nothing else on the
 * page, so it is requested on the first row a visitor opens — most visits
 * never ask for it. The promise is memoized: expanding a second row reuses the
 * first request rather than starting another.
 */
let eventsPromise: Promise<EarningsEventsPayload> | null = null;

export function fetchEarningsEvents(): Promise<EarningsEventsPayload> {
  eventsPromise ??= fetchStatic<EarningsEventsPayload>(EVENTS_PATH).catch(err => {
    // Don't cache a failure — a later expand should be able to retry.
    eventsPromise = null;
    throw err;
  });
  return eventsPromise;
}
