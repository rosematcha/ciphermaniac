import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeSlimIndex,
  encodeSlimIndex,
  type PlayerIndexEntry,
  type PlayerIndexSlimEntry
} from '../../shared/playerTypes.ts';

function entry(over: Partial<PlayerIndexEntry> = {}): PlayerIndexEntry {
  return {
    playerId: '1',
    name: 'Ash Ketchum',
    country: 'US',
    eventCount: 10,
    day2s: 5,
    topCuts: 2,
    tournamentWins: 1,
    lastEventDate: '2026-06-12',
    ...over
  };
}

test('encode/decode round-trips the slim projection and drops lastEventDate', () => {
  const input = [entry(), entry({ playerId: '2', name: 'Gary Oak', country: undefined, eventCount: 3 })];
  const decoded = decodeSlimIndex(encodeSlimIndex(input));
  assert.ok(decoded);
  const expected: PlayerIndexSlimEntry[] = [
    { playerId: '1', name: 'Ash Ketchum', country: 'US', eventCount: 10, day2s: 5, topCuts: 2, tournamentWins: 1 },
    { playerId: '2', name: 'Gary Oak', country: undefined, eventCount: 3, day2s: 5, topCuts: 2, tournamentWins: 1 }
  ];
  assert.deepEqual(decoded, expected);
});

test('decode passes a legacy row array through unchanged', () => {
  const legacy: PlayerIndexSlimEntry[] = [
    { playerId: '9', name: 'Misty', country: 'JP', eventCount: 4, day2s: 1, topCuts: 0, tournamentWins: 0 }
  ];
  assert.equal(decodeSlimIndex(legacy), legacy);
});

test('decode preserves entry order', () => {
  const input = [entry({ playerId: 'b' }), entry({ playerId: 'a' }), entry({ playerId: 'c' })];
  const decoded = decodeSlimIndex(encodeSlimIndex(input));
  assert.deepEqual(
    decoded?.map(e => e.playerId),
    ['b', 'a', 'c']
  );
});

test('decode returns null for unrecognizable payloads', () => {
  assert.equal(decodeSlimIndex(null), null);
  assert.equal(decodeSlimIndex(undefined), null);
  assert.equal(decodeSlimIndex('nope'), null);
  assert.equal(decodeSlimIndex({}), null);
  assert.equal(decodeSlimIndex({ format: 'slim-columnar-v2', playerIds: [] }), null);
  assert.equal(decodeSlimIndex({ format: 'slim-columnar-v1', playerIds: ['1'] }), null);
});

test('empty index encodes and decodes to an empty list', () => {
  assert.deepEqual(decodeSlimIndex(encodeSlimIndex([])), []);
});
