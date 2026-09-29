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

test('sits right of the crosshair while it fits, flips left only on overflow, and stays inside the box', () => {
  const cases = [
    ['room on the right', 100, TIP, BOX, 112],
    // Still fits on the right past the midpoint — the old midpoint rule flipped here.
    ['past the midpoint', 500, TIP, BOX, 512],
    // 528 + 12 + 260 = 800 exactly: the last position that fits on the right.
    ['the last position that fits on the right', 528, TIP, BOX, 540],
    ['one pixel further flips left', 529, TIP, BOX, 529 - 12 - TIP],
    ['a crosshair at the far edge', BOX, TIP, BOX, BOX - 12 - TIP],
    ['near the left edge it stays right rather than going negative', 0, TIP, BOX, 12],
    ['a few pixels in from the left edge', 4, TIP, BOX, 16],
    ['a tooltip wider than the chart clamps to the left edge', 120, 400, 300, 0]
  ] as const;
  for (const [name, x, tip, box, expected] of cases) {
    assert.equal(placeChartTooltip(x, tip, box), expected, name);
  }
});
