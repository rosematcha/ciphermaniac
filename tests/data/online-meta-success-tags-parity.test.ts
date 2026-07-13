/**
 * Parity corpus pinning the run-online-meta.mjs success-tag logic to the one
 * frozen SUCCESS_TAG_POLICY.
 *
 * DB-MASTER-PLAN Phase 2 slice 2 consolidates every TypeScript producer onto
 * computeSuccessTags / SUCCESS_TAG_POLICY (shared/data/contracts.ts).
 * `.github/scripts/run-online-meta.mjs` is an ESM producer that cannot import
 * TypeScript, so its private determinePlacementTags copy stays until the
 * producer-conversion slice rewrites it as orchestration around the shared
 * builders. This test asserts the .mjs copy and the shared policy emit
 * identical tags across a placement x field-size grid plus edge inputs, so the
 * two can only be retired once proven equal.
 *
 * Online windows never carry Day-2 phases, so computeSuccessTags runs with
 * appendPhaseTags defaulting false — matching the .mjs, which has no phase-tag
 * branch at all (divergence D7).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SUCCESS_TAG_NAMES, SUCCESS_TAG_POLICY, computeSuccessTags } from '../../shared/data/contracts.ts';
import {
  determinePlacementTags,
  PLACEMENT_TAG_RULES,
  PERCENT_TAG_RULES
} from '../../.github/scripts/run-online-meta.mjs';

// Field sizes that straddle every rule boundary (min-player cutoffs 2/4/8/12/16/20/32
// and the percentile ceilings) plus a large field.
const FIELD_SIZES = [2, 4, 7, 8, 12, 16, 20, 24, 32, 40, 100];

describe('run-online-meta success-tag parity with SUCCESS_TAG_POLICY', () => {
  it('matches across placements 1..40 x field sizes {2,4,7,8,12,16,20,24,32,40,100}', () => {
    for (const fieldSize of FIELD_SIZES) {
      for (let placement = 1; placement <= 40; placement += 1) {
        const legacy = determinePlacementTags(placement, fieldSize);
        const policy = computeSuccessTags(placement, fieldSize);
        assert.deepEqual(
          policy,
          legacy,
          `placement=${placement} field=${fieldSize}: policy [${policy}] != legacy [${legacy}]`
        );
      }
    }
  });

  it('matches on edge-case placements (null/undefined/0/NaN) across every field size', () => {
    const edgePlacements: Array<number | null | undefined> = [null, undefined, 0, Number.NaN];
    const edgeFields: Array<number | null | undefined> = [...FIELD_SIZES, null, undefined, 0, Number.NaN];
    for (const fieldSize of edgeFields) {
      for (const placement of edgePlacements) {
        const legacy = determinePlacementTags(placement, fieldSize);
        const policy = computeSuccessTags(placement, fieldSize);
        assert.deepEqual(
          policy,
          legacy,
          `placement=${String(placement)} field=${String(fieldSize)}: policy [${policy}] != legacy [${legacy}]`
        );
      }
    }
  });

  it('the .mjs rule tables are byte-identical to the frozen policy', () => {
    assert.deepEqual(PLACEMENT_TAG_RULES, SUCCESS_TAG_POLICY.placementRules);
    assert.deepEqual(PERCENT_TAG_RULES, SUCCESS_TAG_POLICY.percentRules);
  });

  it('SUCCESS_TAG_NAMES stays in sync with the policy tag order', () => {
    const derived = [
      ...SUCCESS_TAG_POLICY.placementRules.map(rule => rule.tag),
      ...SUCCESS_TAG_POLICY.percentRules.map(rule => rule.tag)
    ];
    assert.deepEqual([...SUCCESS_TAG_NAMES], derived);
  });
});
