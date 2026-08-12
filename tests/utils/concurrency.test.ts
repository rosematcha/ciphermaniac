import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWithConcurrency } from '../../src/lib/concurrency';

test('mapWithConcurrency preserves order and bounds active jobs', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => {
      setTimeout(resolve, value);
    });
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(result, [10, 8, 6, 4, 2]);
  assert.equal(peak, 2);
});

test('mapWithConcurrency handles empty input and invalid limits', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async value => value), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async value => value), [1, 2]);
});
