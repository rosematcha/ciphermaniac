import test from 'node:test';
import assert from 'node:assert/strict';

import { type BuildState, decodeBuildState, encodeBuildState, type PersistedRule } from '../../src/utils/buildState.ts';

function rule(over: Partial<BuildState['rules'][number]>): BuildState['rules'][number] {
  return { id: 1, cardId: 'SVI~007', name: 'Pikachu', mode: 'include', countOp: '>=', count: 1, ...over };
}

function core(r: { cardId: string; mode: string; countOp: string; count: number }): PersistedRule {
  return {
    cardId: r.cardId,
    mode: r.mode as PersistedRule['mode'],
    countOp: r.countOp as PersistedRule['countOp'],
    count: r.count
  };
}

test('encodeBuildState omits defaults', () => {
  const params = encodeBuildState({ rules: [], successFilter: 'all', threshold: 60 });
  assert.deepEqual(params, {});
});

test('encodeBuildState emits compact params', () => {
  const params = encodeBuildState({
    rules: [
      rule({ cardId: 'SVI~007', mode: 'include', countOp: '>=', count: 1 }),
      rule({ cardId: 'TWM~095', mode: 'exclude', countOp: '=', count: 0 })
    ],
    successFilter: 'top8',
    threshold: 70
  });
  assert.equal(params.b, 'SVI~007:i:g:1,TWM~095:x:e:0');
  assert.equal(params.s, 'top8');
  assert.equal(params.t, '70');
});

test('decode(encode(state)) round-trips the persistable core', () => {
  const state: BuildState = {
    rules: [
      rule({ cardId: 'SVI~007', mode: 'include', countOp: '>=', count: 2 }),
      rule({ cardId: 'JTG~098', mode: 'exclude', countOp: '<=', count: 0 })
    ],
    successFilter: 'winner',
    threshold: 45
  };
  const decoded = decodeBuildState(encodeBuildState(state));
  assert.deepEqual(decoded.rules, state.rules.map(core));
  assert.equal(decoded.successFilter, 'winner');
  assert.equal(decoded.threshold, 45);
});

test('decodeBuildState drops malformed segments and never throws', () => {
  const decoded = decodeBuildState({
    b: 'GOOD~001:i:g:2,broken,:i:g:1,ZZZ~9:i:q:3,NEG~1:i:g:-1,OK~2:x:l:0',
    t: 'not-a-number'
  });
  assert.deepEqual(decoded.rules, [
    { cardId: 'GOOD~001', mode: 'include', countOp: '>=', count: 2 },
    { cardId: 'OK~2', mode: 'exclude', countOp: '<=', count: 0 }
  ]);
  assert.equal(decoded.threshold, undefined);
});

test('decodeBuildState ignores empty params', () => {
  const decoded = decodeBuildState({});
  assert.deepEqual(decoded.rules, []);
  assert.equal(decoded.successFilter, undefined);
  assert.equal(decoded.threshold, undefined);
});
