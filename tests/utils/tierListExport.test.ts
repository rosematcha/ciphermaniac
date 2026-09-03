/**
 * tests/utils/tierListExport.test.ts
 * Choosing the width the tier-list board is exported at. The selection rules
 * are asserted against a model of the board's wrapping rather than a real DOM,
 * which is what `sampleLayouts` takes a measure callback for: the two rules
 * that matter — aim wide first, and never pad more than one tile — were both
 * arrived at by getting them wrong, and neither is visible in a type.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bestLayout,
  EXPORT_RATIOS,
  exportWidth,
  type LayoutSample,
  ratioDistance,
  sampleLayouts,
  SLACK
} from '../../src/lib/tierList/exportFit';

/** Tile width plus gap, and row height, roughly as the card-art view renders. */
const STRIDE = 69;
const ROW = 105;
/** The plate column plus the zone's own padding. */
const CHROME = 144;

/**
 * A board of `tiers`, the busiest holding `busiest` tiles, wrapping the way a
 * flex row does — and refusing to go under one tile wide, which is the property
 * that lets the sweep terminate by producing duplicates.
 */
function board(tiers: number, busiest: number): (width: number) => LayoutSample {
  return (width: number) => {
    const perRow = Math.max(1, Math.floor((width - CHROME) / STRIDE));
    const rows = tiers - 1 + Math.ceil(busiest / perRow);
    return {
      constraint: width,
      height: rows * ROW,
      used: CHROME + Math.min(busiest, perRow) * STRIDE
    };
  };
}

const natural = (measure: (width: number) => LayoutSample): LayoutSample => measure(100_000);

// ---------------------------------------------------------------------------
// Ratio scoring
// ---------------------------------------------------------------------------

test('a target ratio scores zero and the distance is symmetric in log space', () => {
  for (const target of EXPORT_RATIOS) {
    assert.ok(ratioDistance(target) < 1e-9, `${target} should be a perfect match`);
  }
  // 25% over and 20% under 1:1 are the same multiplicative distance.
  assert.ok(Math.abs(ratioDistance(1.25) - ratioDistance(0.8)) < 1e-9);
});

test('a degenerate ratio is infinitely far rather than NaN', () => {
  assert.equal(ratioDistance(0), Infinity);
  assert.equal(ratioDistance(Number.NaN), Infinity);
});

// ---------------------------------------------------------------------------
// Width
// ---------------------------------------------------------------------------

test('a layout already wider than the narrowest target is exported at the content width', () => {
  const sample: LayoutSample = { constraint: 900, height: 400, used: 800 };
  assert.equal(exportWidth(sample, STRIDE), 800 + SLACK);
});

test('a narrow layout is padded towards the narrowest target', () => {
  // Content wants 318; 4:5 of 450 tall wants 360; the one-tile cap allows 387.
  // The ratio is what binds, so 360 is the answer.
  const sample: LayoutSample = { constraint: 340, height: 450, used: 300 };
  assert.equal(exportWidth(sample, STRIDE), 360);
});

test('padding stops at one tile, so a tall column is never blown out into a void', () => {
  // A single column: 4:5 would want 1000px against 200px of content.
  const sample: LayoutSample = { constraint: 200, height: 1250, used: 200 };
  assert.equal(exportWidth(sample, STRIDE), 200 + SLACK + STRIDE);
  assert.ok(exportWidth(sample, STRIDE) < 1250 * 0.8);
});

test('a zero stride still yields the tight width rather than NaN', () => {
  const sample: LayoutSample = { constraint: 200, height: 1250, used: 200 };
  assert.equal(exportWidth(sample, 0), 200 + SLACK);
});

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

test('the sweep reports one candidate per distinct wrapping, widest first', () => {
  const measure = board(6, 8);
  const samples = sampleLayouts(natural(measure), measure);
  assert.ok(samples.length > 1);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i]!.used < samples[i - 1]!.used, 'each candidate is narrower than the last');
    assert.ok(samples[i]!.height >= samples[i - 1]!.height, 'and no shorter');
  }
});

test('the sweep bottoms out at one tile per row instead of running away', () => {
  const measure = board(6, 8);
  const samples = sampleLayouts(natural(measure), measure);
  assert.equal(samples[samples.length - 1]!.used, CHROME + STRIDE);
});

test('a board that cannot wrap yields a single candidate', () => {
  const measure = board(6, 1);
  assert.equal(sampleLayouts(natural(measure), measure).length, 1);
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** The exported proportions of whatever the selector picked. */
function chosenRatio(tiers: number, busiest: number): number {
  const measure = board(tiers, busiest);
  const samples = sampleLayouts(natural(measure), measure);
  const best = bestLayout(samples, STRIDE);
  assert.ok(best, 'a board with tiles always has a candidate');
  return exportWidth(best, STRIDE) / best.height;
}

test('a wide board stays wide instead of wrapping into a portrait', () => {
  // The regression this rule exists for: scoring every candidate against every
  // ratio turned two tiers of eighteen tiles into a 4:5 portrait, because
  // wrapping a wide board far enough eventually passes near some target.
  const ratio = chosenRatio(2, 18);
  assert.ok(ratio > 1.4, `two tiers of eighteen came out at ${ratio.toFixed(3)}`);
});

test('a sparse card-art board lands near the narrowest target rather than staying page-wide', () => {
  // Six tiers, the busiest holding four: the shape Reese exported at 1.6:1
  // with two thirds of the image empty.
  const ratio = chosenRatio(6, 4);
  assert.ok(ratio < 1, `expected a portrait, got ${ratio.toFixed(3)}`);
  assert.ok(ratio > 0.6, `but not a sliver, got ${ratio.toFixed(3)}`);
});

test('a board with no width to give is left narrow rather than padded to a ratio', () => {
  const ratio = chosenRatio(10, 1);
  assert.ok(ratio < 0.5, `a ten-tier column should stay a column, got ${ratio.toFixed(3)}`);
});

test('every shape lands within a quarter of some target, or is a column that cannot', () => {
  for (const tiers of [1, 2, 4, 6, 8]) {
    for (const busiest of [2, 4, 8, 16, 30]) {
      const ratio = chosenRatio(tiers, busiest);
      const distance = ratioDistance(ratio);
      const measure = board(tiers, busiest);
      const widest = natural(measure);
      // A board whose content is narrower than 4:5 of its own height at one
      // tile per row has no reachable target; everything else should be close.
      const reachable = widest.used + SLACK + STRIDE >= widest.height * 0.8;
      if (reachable) {
        assert.ok(distance <= Math.log(1.25), `${tiers}x${busiest} landed at ${ratio.toFixed(3)}`);
      }
    }
  }
});

test('nothing to measure means nothing to choose', () => {
  assert.equal(bestLayout([], STRIDE), null);
});
