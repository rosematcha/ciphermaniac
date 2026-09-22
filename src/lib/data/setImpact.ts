/**
 * How much each set has supplied to the majors.
 *
 * Like earnings, a build artifact (`npx tsx scripts/build-set-impact.ts`,
 * rerun about monthly) served same-origin rather than pipeline output on R2.
 * @module src/lib/data/setImpact
 */

import type { SetImpactPayload } from '../../../shared/setImpactTypes.js';

const SET_IMPACT_PATH = '/set-impact.json';

export async function fetchSetImpact(): Promise<SetImpactPayload> {
  const res = await fetch(SET_IMPACT_PATH);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SET_IMPACT_PATH}: ${res.status}`);
  }
  return (await res.json()) as SetImpactPayload;
}
