import test from 'node:test';
import assert from 'node:assert/strict';

import { getState, setState } from '../../src/archetype/state.ts';

test('getState returns a shared singleton', () => {
  const state = getState();
  assert.strictEqual(getState(), state);
});

test('setState updates selected fields', () => {
  const state = getState();
  const original = {
    archetypeBase: state.archetypeBase,
    successFilter: state.successFilter,
    nextFilterId: state.nextFilterId
  };

  setState({ archetypeBase: 'mew', successFilter: 'top8', nextFilterId: 42 });

  const updated = getState();
  assert.equal(updated.archetypeBase, 'mew');
  assert.equal(updated.successFilter, 'top8');
  assert.equal(updated.nextFilterId, 42);

  setState(original);
});
