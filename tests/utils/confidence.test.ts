import assert from 'node:assert/strict';
import test from 'node:test';
import { differenceInterval, matchPointWilson, sampleTier, wilsonInterval } from '../../src/lib/confidence.ts';

function near(actual: number, expected: number, tolerance = 0.2): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test('wilsonInterval returns null without a sample', () => {
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(wilsonInterval(-1, 10), null);
  assert.equal(wilsonInterval(11, 10), null);
});

test('wilsonInterval matches known 95% references', () => {
  const small = wilsonInterval(10, 20)!;
  near(small.low, 29.9);
  near(small.high, 70.1);
  const large = wilsonInterval(500, 1000)!;
  near(large.low, 46.9);
  near(large.high, 53.1);
});

test('wilsonInterval accepts fractional effective successes', () => {
  const range = wilsonInterval(10 + 1 / 3, 20)!;
  assert.ok(range.low < range.center && range.center < range.high);
});

test('differenceInterval reports direction and whether zero is excluded', () => {
  const positive = differenceInterval({ wins: 80, ties: 0, total: 100 }, { wins: 40, ties: 0, total: 100 })!;
  assert.ok(positive.low > 0);
  assert.equal(positive.excludesZero, true);
  const uncertain = differenceInterval({ wins: 6, ties: 0, total: 10 }, { wins: 5, ties: 0, total: 10 })!;
  assert.ok(uncertain.low < 0 && uncertain.high > 0);
  assert.equal(uncertain.excludesZero, false);
});

test('differenceInterval uses the match-point tie treatment', () => {
  const range = differenceInterval({ wins: 0, ties: 3, total: 3 }, { wins: 0, ties: 0, total: 3 })!;
  near((range.low + range.high) / 2, 33.3);
});

test('differenceInterval requires games on both sides', () => {
  assert.equal(differenceInterval({ wins: 0, ties: 0, total: 0 }, { wins: 1, ties: 0, total: 1 }), null);
});

test('matchPointWilson converts ties to fractional successes', () => {
  assert.deepEqual(matchPointWilson(10, 1, 20), wilsonInterval(10 + 1 / 3, 20));
});

test('sampleTier uses the existing 20 and 50 game boundaries', () => {
  assert.equal(sampleTier(19), 'thin');
  assert.equal(sampleTier(20), 'ok');
  assert.equal(sampleTier(49), 'ok');
  assert.equal(sampleTier(50), 'solid');
});
