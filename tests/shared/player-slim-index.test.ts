import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeSlimIndex,
  encodeSlimIndex,
  type PlayerIndexEntry,
  type PlayerIndexSlimEntry
} from '../../shared/playerTypes.ts';
import { winPct } from '../../src/utils/playerSort.ts';

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

test('encode/decode round-trips the slim projection and drops lastEventDate', () => {
  const input = [entry(), entry({ playerId: '2', name: 'Gary Oak', country: undefined, eventCount: 3 })];
  const decoded = decodeSlimIndex(encodeSlimIndex(input));
  assert.ok(decoded);
  const expected: PlayerIndexSlimEntry[] = [
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
    },
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
    }
  ];
  assert.deepEqual(decoded, expected);
});

test('decode passes a legacy row array through, filling the record it lacks with zeros', () => {
  const legacy = [
    { playerId: '9', name: 'Misty', country: 'JP', eventCount: 4, day2s: 1, topCuts: 0, tournamentWins: 0 }
  ];
  assert.deepEqual(decodeSlimIndex(legacy), [{ ...legacy[0], wins: 0, losses: 0 }]);
});

test('a columnar payload written before the record existed decodes with zero wins and losses', () => {
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

test('a decoded legacy entry yields a real win rate, not NaN', () => {
  // The players index reads `wins + losses` straight off these entries. The
  // legacy `index.json` fallback used to skip this decoder entirely, and an
  // entry without the two fields made every arithmetic result NaN.
  const decoded = decodeSlimIndex([
    { playerId: '9', name: 'Misty', eventCount: 4, day2s: 1, topCuts: 0, tournamentWins: 0 }
  ]);
  assert.ok(decoded);
  assert.equal(Number.isNaN(decoded[0].wins + decoded[0].losses), false);
  assert.equal(winPct(decoded[0]), 0);
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
