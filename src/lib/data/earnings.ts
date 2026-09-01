/**
 * Player prize earnings.
 *
 * Unlike every other reader here, this one does NOT go through `dataClient`:
 * the payload is a build artifact (`static/earnings.json`, refreshed by
 * `npm run scrape:earnings`) rather than pipeline output on R2, so it is served
 * same-origin in dev and in production alike.
 * @module src/lib/data/earnings
 */

import type { EarningsPayload } from '../../../shared/earningsTypes.js';

const EARNINGS_PATH = '/earnings.json';

export async function fetchEarnings(): Promise<EarningsPayload> {
  const res = await fetch(EARNINGS_PATH);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${EARNINGS_PATH}: ${res.status}`);
  }
  return (await res.json()) as EarningsPayload;
}
