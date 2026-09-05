/**
 * Trends chart hover-tooltip placement.
 *
 * The card flips to the other side of the crosshair on measured fit, not on
 * which half of the chart is hovered — the old midpoint rule both flipped early
 * (plenty of room still on the right) and overflowed late (a card wider than
 * half the chart hangs off the edge either way).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { placeChartTooltip } from '../../src/pages/trendsPage/chartTooltip.ts';

const BOX = 800;
const TIP = 260;

test('sits to the right of the crosshair while there is room', () => {
  assert.equal(placeChartTooltip(100, TIP, BOX), 112);
  // Still fits on the right past the midpoint — the old midpoint rule flipped here.
  assert.equal(placeChartTooltip(500, TIP, BOX), 512);
});

test('flips to the left only once the right side would overflow', () => {
  // 528 + 12 + 260 = 800 exactly: the last position that fits on the right.
  assert.equal(placeChartTooltip(528, TIP, BOX), 540);
  assert.equal(placeChartTooltip(529, TIP, BOX), 529 - 12 - TIP);
});

test('a crosshair at the far edge keeps the tooltip inside the box', () => {
  const left = placeChartTooltip(BOX, TIP, BOX);
  assert.ok(left >= 0 && left + TIP <= BOX);
});

test('near the left edge it stays on the right rather than going negative', () => {
  assert.equal(placeChartTooltip(0, TIP, BOX), 12);
  assert.equal(placeChartTooltip(4, TIP, BOX), 16);
});

test('a tooltip wider than the chart clamps to the left edge', () => {
  assert.equal(placeChartTooltip(120, 400, 300), 0);
});
