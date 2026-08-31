/**
 * Shrink-to-fit sizing for social-graphics card names.
 *
 * The DOM glue is deliberately thin so the only thing worth testing is the
 * arithmetic: a name that fits keeps its design size, a long one scales down
 * proportionally, and nothing ever goes below the floor (past which the name
 * ellipsizes instead of shrinking into illegibility).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type FitBounds, fitFontSize, type FitTarget, fitToWidth } from '../../src/pages/socialGraphics/fitText.ts';

const HERO = { max: 42, min: 24 };

test('a name that already fits keeps the design size', () => {
  assert.equal(fitFontSize(HERO, 400, 260), 42);
  assert.equal(fitFontSize(HERO, 400, 400), 42);
});

test('a long name scales down in proportion to the overflow', () => {
  // Half again as wide as the box, so roughly two thirds of the size.
  assert.equal(fitFontSize(HERO, 400, 600), 28);
});

test('shrinking stops at the floor', () => {
  assert.equal(fitFontSize(HERO, 400, 4000), 24);
});

test('an unmeasurable element keeps the design size', () => {
  // A hidden or not-yet-laid-out element measures zero; sizing off that would
  // pin every name to the floor.
  assert.equal(fitFontSize(HERO, 0, 0), 42);
  assert.equal(fitFontSize(HERO, 0, 300), 42);
});

/**
 * A text box whose rendered width is proportional to its font size, plus an
 * optional per-size fudge so the "one proportional step lands a hair wide"
 * path gets exercised.
 */
function fakeTarget(boxWidth: number, pxPerChar: number, chars: number, fudge = 0): FitTarget & { size: number } {
  return {
    size: 0,
    clientWidth: boxWidth,
    get scrollWidth() {
      return Math.ceil(this.size * pxPerChar * chars) + fudge;
    },
    setFontSize(px: number) {
      this.size = px;
    }
  };
}

test('a short name is rendered at the design size', () => {
  const target = fakeTarget(400, 0.5, 10);
  assert.equal(fitToWidth(target, HERO), 42);
  assert.equal(target.size, 42);
});

test('a long name is shrunk until it fits its box', () => {
  const target = fakeTarget(400, 0.5, 30);
  const size = fitToWidth(target, HERO);
  assert.ok(size < 42, `expected a shrink, got ${size}`);
  assert.ok(target.scrollWidth <= target.clientWidth, 'the fitted name should no longer overflow');
});

test('a name that overflows after the proportional step keeps stepping down', () => {
  // The fudge makes the linear estimate land one pixel too wide.
  const target = fakeTarget(400, 0.5, 30, 3);
  fitToWidth(target, HERO);
  assert.ok(target.scrollWidth <= target.clientWidth, 'the fitted name should no longer overflow');
});

test('a name too long even at the floor stops at the floor', () => {
  const bounds: FitBounds = { max: 17, min: 11 };
  const target = fakeTarget(120, 0.6, 60);
  assert.equal(fitToWidth(target, bounds), 11);
  // Still overflowing — that is the ellipsis case, not an excuse to keep shrinking.
  assert.ok(target.scrollWidth > target.clientWidth);
});
