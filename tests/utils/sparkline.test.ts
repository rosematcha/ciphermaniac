import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSparkBounds, SPARK_MIN_REL_RANGE } from '../../src/lib/sparkline';

const range = (b: { lo: number; hi: number }) => b.hi - b.lo;
const mid = (b: { lo: number; hi: number }) => (b.lo + b.hi) / 2;

test('a near-flat series is floored, not amplified, around its midpoint', () => {
  // $21 card that wobbled ~$0.66: without a floor this fills the whole height.
  const b = computeSparkBounds([21.67, 21.4, 21.2, 21.01]);
  // Visible range is at least the relative floor around the mid price.
  const m = mid(b);
  assert.ok(range(b) >= m * SPARK_MIN_REL_RANGE, `range ${range(b)} < floor ${m * SPARK_MIN_REL_RANGE}`);
  assert.ok(Math.abs(m - (21.67 + 21.01) / 2) < 1e-9, 'the floored band is centered on the series midpoint');
});

test('a genuine mover keeps its own range', () => {
  // 30% swing is well above the floor, so bounds track the data (plus headroom).
  const b = computeSparkBounds([2.5, 2.9, 3.23]);
  assert.ok(range(b) > 3.23 * SPARK_MIN_REL_RANGE);
  // Data stays inside the band.
  assert.ok(b.lo < 2.5 && b.hi > 3.23);
});

test('an all-zero or empty series still yields a finite, non-degenerate band', () => {
  for (const series of [[0, 0], []]) {
    const b = computeSparkBounds(series);
    assert.ok(range(b) > 0 && Number.isFinite(b.lo) && Number.isFinite(b.hi), JSON.stringify(series));
  }
});
