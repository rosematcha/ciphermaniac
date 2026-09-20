import assert from 'node:assert/strict';
import test from 'node:test';
import { withinPruneCeiling } from '../../.github/scripts/lib/build/pruneCeiling';

test('allows drift and refuses a prune that would gut the mirror', () => {
  assert.equal(withinPruneCeiling(7152, 0), true);
  assert.equal(withinPruneCeiling(7152, 1788), true);
  assert.equal(withinPruneCeiling(7152, 1789), false);
  assert.equal(withinPruneCeiling(0, 0), true);
  assert.equal(withinPruneCeiling(0, 1), false);
});
