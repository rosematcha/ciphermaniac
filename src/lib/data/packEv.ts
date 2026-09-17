/**
 * Pack-EV artifacts: what a pack of a set is worth opened, and what the sealed
 * product costs.
 *
 * Built daily by `.github/scripts/run-pack-ev.ts` from TCGCSV. The index is a
 * few hundred bytes and carries every set's headline; a set's own payload
 * carries its whole card list (tens of KB), so it is only fetched for the set
 * being looked at.
 *
 * These are live prices, not part of a data release, so they get their own
 * client with an identity path resolver — same as the event locator. A
 * release-aware build would otherwise try to rewrite `/reports/pack-ev/…` onto
 * a release root and throw, since no release carries them.
 * @module src/lib/data/packEv
 */

import { createDataClient } from './client';
import type { PackEvIndex, PackEvSetPayload } from '../../../shared/packEv/types';

const client = createDataClient({ resolvePath: path => path });

/** Matches the job's `PACK_EV_PREFIX`; the fetch test holds the two together. */
const PREFIX = '/reports/pack-ev/v2/';

/** Null until the job has run for the first time. */
export function fetchPackEvIndex(): Promise<PackEvIndex | null> {
  return client.fetchJsonOptional<PackEvIndex>(`${PREFIX}index.json`);
}

export function fetchPackEvSet(code: string): Promise<PackEvSetPayload | null> {
  return client.fetchJsonOptional<PackEvSetPayload>(`${PREFIX}${encodeURIComponent(code)}.json`);
}
