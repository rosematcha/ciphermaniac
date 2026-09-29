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
    wins: 30,
    losses: 10,
    day2s: 5,
    topCuts: 2,
    tournamentWins: 1,
    lastEventDate: '2026-06-12',
    ...over
  };
}

test('encode/decode round-trips the slim projection in order and drops lastEventDate', () => {
  const input = [entry({ playerId: '2', name: 'Gary Oak', country: undefined, eventCount: 3 }), entry()];
  const decoded = decodeSlimIndex(encodeSlimIndex(input));
  assert.ok(decoded);
  const expected: PlayerIndexSlimEntry[] = [
    {
      playerId: '2',
      name: 'Gary Oak',
      country: undefined,
      eventCount: 3,
      wins: 30,
      losses: 10,
      day2s: 5,
      topCuts: 2,
      tournamentWins: 1
    },
    {
      playerId: '1',
      name: 'Ash Ketchum',
      country: 'US',
      eventCount: 10,
      wins: 30,
      losses: 10,
      day2s: 5,
      topCuts: 2,
      tournamentWins: 1
    }
  ];
  assert.deepEqual(decoded, expected);
});

test('decode fills zero wins and losses into rows and columns written before the record existed', () => {
  // The players index reads `wins + losses` straight off these entries; a
  // missing pair made every arithmetic result NaN.
  const legacy = [
    { playerId: '9', name: 'Misty', country: 'JP', eventCount: 4, day2s: 1, topCuts: 0, tournamentWins: 0 }
  ];
  assert.deepEqual(decodeSlimIndex(legacy), [{ ...legacy[0], wins: 0, losses: 0 }]);

  const columnar = encodeSlimIndex([entry()]) as unknown as Record<string, unknown>;
  delete columnar.wins;
  delete columnar.losses;
  const decoded = decodeSlimIndex(columnar);
  assert.equal(decoded?.[0].wins, 0);
  assert.equal(decoded?.[0].losses, 0);
});

test('encoding a legacy index that predates the record writes zeros, not nulls', () => {
  // The aggregator's no-change fast path re-encodes whatever `index.json`
  // already held. An index written before win rate existed has no wins/losses,
  // and `undefined` in the columnar arrays serialises as `null` — which used to
  // reach the browser as a record for the entire field.
  const legacy = [entry()] as unknown as Record<string, unknown>[];
  delete legacy[0].wins;
  delete legacy[0].losses;
  const encoded = encodeSlimIndex(legacy as unknown as PlayerIndexEntry[]);
  assert.deepEqual(encoded.wins, [0]);
  assert.deepEqual(encoded.losses, [0]);
  assert.equal(JSON.stringify(encoded).includes('null'), false);
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
