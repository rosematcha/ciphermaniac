/**
 * Reading a whole run's worth of rounds.
 *
 * The rule that matters is the one that keeps a phone on venue wifi usable: a
 * finished round is read once and held, so the sixty-second poll costs one
 * request rather than fifteen.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { LiveRound } from '../../shared/live/types.ts';
import { clearRoundArchive, fetchPostedRounds, type RoundReader } from '../../src/lib/liveRounds.ts';

let read: string[] = [];
let missing = new Set<number>();

const reader: RoundReader = (slug, round, version) => {
  read.push(version ? `${slug}|${round}@${version}` : `${slug}|${round}`);
  return Promise.resolve(
    missing.has(round) ? null : ({ round, updatedAt: '', unreadable: 0, matches: [] } as LiveRound)
  );
};

beforeEach(() => {
  clearRoundArchive();
  read = [];
  missing = new Set();
});

test('every posted round is read, oldest first', async () => {
  const loaded = await fetchPostedRounds('test-2027', 3, undefined, reader);
  assert.deepEqual(
    loaded.map(round => round?.round),
    [1, 2, 3]
  );
  assert.deepEqual(read, ['test-2027|1', 'test-2027|2', 'test-2027|3']);
});

test('the current round is read at the index hash, and the rounds before it are not', async () => {
  await fetchPostedRounds('test-2027', 3, 'abc', reader);
  assert.deepEqual(read, ['test-2027|1', 'test-2027|2', 'test-2027|3@abc']);
});

test('a second read costs one request, not the whole run', async () => {
  await fetchPostedRounds('test-2027', 3, undefined, reader);
  read = [];
  const loaded = await fetchPostedRounds('test-2027', 3, undefined, reader);
  assert.deepEqual(read, ['test-2027|3'], 'finished rounds are held for the session');
  assert.deepEqual(
    loaded.map(round => round?.round),
    [1, 2, 3],
    'the held rounds still come back'
  );
});

test('the round the event moves on from is archived on the pass that leaves it', async () => {
  await fetchPostedRounds('test-2027', 3, undefined, reader);
  read = [];
  await fetchPostedRounds('test-2027', 4, undefined, reader);
  assert.deepEqual(read, ['test-2027|3', 'test-2027|4']);
  read = [];
  await fetchPostedRounds('test-2027', 4, undefined, reader);
  assert.deepEqual(read, ['test-2027|4']);
});

test('a round file that is not there yet is not remembered as absent', async () => {
  missing.add(2);
  const first = await fetchPostedRounds('test-2027', 3, undefined, reader);
  assert.equal(first[1], null);
  missing.clear();
  read = [];
  const second = await fetchPostedRounds('test-2027', 3, undefined, reader);
  assert.equal(second[1]?.round, 2, 'the gap fills in rather than lasting the session');
  assert.deepEqual(read, ['test-2027|2', 'test-2027|3']);
});

test('a failed read is not held either', async () => {
  let fail = true;
  const flaky: RoundReader = (slug, round) => {
    read.push(`${slug}|${round}`);
    if (fail && round === 1) {
      return Promise.reject(new Error('offline'));
    }
    return Promise.resolve({ round, updatedAt: '', unreadable: 0, matches: [] } as LiveRound);
  };
  await assert.rejects(fetchPostedRounds('test-2027', 2, undefined, flaky));
  fail = false;
  read = [];
  const loaded = await fetchPostedRounds('test-2027', 2, undefined, flaky);
  assert.equal(loaded[0]?.round, 1);
  assert.deepEqual(read, ['test-2027|1', 'test-2027|2']);
});

test('each event keeps its own archive', async () => {
  await fetchPostedRounds('test-2027', 2, undefined, reader);
  read = [];
  await fetchPostedRounds('other-2027', 2, undefined, reader);
  assert.deepEqual(read, ['other-2027|1', 'other-2027|2']);
});
