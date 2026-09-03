/**
 * tests/utils/tierListExport.test.ts
 * Choosing the width the tier-list board is exported at. The selection rules
 * are asserted against a model of the board's wrapping rather than a real DOM,
 * which is what `sampleLayouts` takes a measure callback for. Both rules —
 * aim wide first, and let 4:5 floor how narrow an export can be — were arrived
 * at by getting them wrong, and neither is visible in a type.
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

/** The narrowest target; below this an export is padded up rather than left tight. */
const NARROWEST = 4 / 5;

/** Tile width plus gap, and row height, roughly as the card-art view renders. */
const STRIDE = 69;
const ROW = 105;
/** The plate column plus the zone's own padding. */
const CHROME = 144;
/** Matches `TOLERANCE` in the module under test: 15%, in log space. */
const TOLERANCE = Math.log(1.15);

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
  assert.equal(exportWidth(sample), 800 + SLACK);
});

test('a narrow layout is padded out to the narrowest target', () => {
  // Content wants 318; 4:5 of 450 tall wants 360, and the ratio is what binds.
  const sample: LayoutSample = { constraint: 340, height: 450, used: 300 };
  assert.equal(exportWidth(sample), 360);
});

test('a sparse board is padded to 4:5 rather than left as a sliver', () => {
  // Six tiers holding one card between them: the export Reese got back at
  // 0.45:1 before the one-tile padding cap came out.
  const sample: LayoutSample = { constraint: 200, height: 640, used: 200 };
  assert.equal(exportWidth(sample), 640 * NARROWEST);
  assert.ok(exportWidth(sample) / sample.height - NARROWEST < 1e-9);
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
  const best = bestLayout(sampleLayouts(natural(measure), measure));
  assert.ok(best, 'a board with tiles always has a candidate');
  return exportWidth(best) / best.height;
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

test('a board with almost nothing on it still lands on a target', () => {
  // Six tiers, one card. Left to its content this is a 0.45:1 sliver.
  const ratio = chosenRatio(6, 1);
  assert.ok(Math.abs(ratio - NARROWEST) < 1e-9, `expected 4:5, got ${ratio.toFixed(3)}`);
});

const SHAPES = [1, 2, 4, 6, 8, 12].flatMap(tiers => [1, 2, 4, 8, 16, 30].map(busiest => [tiers, busiest] as const));

test('no shape is ever exported narrower than 4:5', () => {
  for (const [tiers, busiest] of SHAPES) {
    const ratio = chosenRatio(tiers, busiest);
    assert.ok(ratio >= NARROWEST - 1e-9, `${tiers} tiers by ${busiest} came out at ${ratio.toFixed(3)}`);
  }
});

test('every shape lands on a target, unless it is one row too wide to wrap', () => {
  for (const [tiers, busiest] of SHAPES) {
    const measure = board(tiers, busiest);
    const samples = sampleLayouts(natural(measure), measure);
    // The most wrapped candidate is as narrow as this board gets. If even that
    // is wider than the widest target, no amount of wrapping reaches the list —
    // one tier holding one tile is 2.2:1 and stays there.
    const narrowest = samples[samples.length - 1]!;
    if (exportWidth(narrowest) / narrowest.height > EXPORT_RATIOS[0]! * 1.15) {
      continue;
    }
    const ratio = chosenRatio(tiers, busiest);
    assert.ok(
      ratioDistance(ratio) <= TOLERANCE,
      `${tiers} tiers by ${busiest} landed at ${ratio.toFixed(3)}, off every target`
    );
  }
});

test('nothing to measure means nothing to choose', () => {
  assert.equal(bestLayout([]), null);
});
