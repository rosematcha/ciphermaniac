/**
 * Tests for the pure overview/key-matchup logic added for the Matchups redesign
 * (src/lib/matchups.ts): bucketing by displayed win rate, gauge width, summary
 * derivation, and key-matchup selection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketWinRate,
  gaugeWidth,
  matchupImportance,
  type MatchupStat,
  selectKeyMatchups,
  summarizeMatchups,
  WR_MIN_GAMES
} from '../../src/lib/matchups.ts';

const approx = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);

function stat(p: Partial<MatchupStat> & Pick<MatchupStat, 'opponentLabel'>): MatchupStat {
  return { winRate: 50, matches: 100, fieldShare: 1, isMirror: false, ...p };
}

test('bucketWinRate: 48-52 (rounded) inclusive is even, else fav/unf', () => {
  assert.equal(bucketWinRate(50), 'even');
  assert.equal(bucketWinRate(48), 'even');
  assert.equal(bucketWinRate(52), 'even');
  assert.equal(bucketWinRate(47.6), 'even'); // rounds to 48
  assert.equal(bucketWinRate(52.4), 'even'); // rounds to 52
  assert.equal(bucketWinRate(52.5), 'fav'); // rounds to 53
  assert.equal(bucketWinRate(47.4), 'unf'); // rounds to 47
  assert.equal(bucketWinRate(63), 'fav');
  assert.equal(bucketWinRate(39), 'unf');
});

test('gaugeWidth: |WR-50|/50 as a percentage, clamped 0..100', () => {
  approx(gaugeWidth(50), 0);
  approx(gaugeWidth(57), 14);
  approx(gaugeWidth(63), 26);
  approx(gaugeWidth(45), 10);
  approx(gaugeWidth(0), 100);
  approx(gaugeWidth(100), 100);
  approx(gaugeWidth(200), 100); // clamped
});

test('summarizeMatchups: counts by bucket, mirror counts as even, low-sample excluded', () => {
  const rows: MatchupStat[] = [
    stat({ opponentLabel: 'Gardevoir ex', winRate: 63, matches: 196 }),
    stat({ opponentLabel: 'Dragapult Dusknoir', winRate: 57, matches: 271 }),
    stat({ opponentLabel: 'Gholdengo', winRate: 52, matches: 133 }), // even (52 inclusive)
    stat({ opponentLabel: 'Dragapult', winRate: 50, matches: 191, isMirror: true }), // even
    stat({ opponentLabel: 'Slowking', winRate: 45, matches: 208 }),
    stat({ opponentLabel: 'Regidrago VSTAR', winRate: 39, matches: 121 }),
    stat({ opponentLabel: 'Iron Thorns', winRate: 40, matches: 15 }) // low-sample, excluded
  ];
  const s = summarizeMatchups(rows);
  assert.equal(s.favored, 2);
  assert.equal(s.even, 2);
  assert.equal(s.unfavored, 2);
  assert.equal(s.tracked, 6);
  assert.equal(s.best?.label, 'Gardevoir ex');
  assert.equal(s.best?.winRate, 63);
  assert.equal(s.toughest?.label, 'Regidrago VSTAR');
  assert.equal(s.toughest?.winRate, 39);
});

test('summarizeMatchups: empty when nothing meets the floor', () => {
  const s = summarizeMatchups([stat({ opponentLabel: 'X', matches: 5 })]);
  assert.equal(s.tracked, 0);
  assert.equal(s.best, null);
  assert.equal(s.toughest, null);
});

test('matchupImportance: field share weighted by sqrt of deviation (min 1)', () => {
  approx(matchupImportance(stat({ opponentLabel: 'A', winRate: 50, fieldShare: 10 })), 10); // sqrt(max(0,1))
  approx(matchupImportance(stat({ opponentLabel: 'B', winRate: 63, fieldShare: 9.4 })), 9.4 * Math.sqrt(13));
});

test('selectKeyMatchups: excludes mirror + low-sample, ranks by importance, displays by field share', () => {
  const rows: MatchupStat[] = [
    stat({ opponentLabel: 'Dragapult Dusknoir', winRate: 57, matches: 271, fieldShare: 12.7 }),
    stat({ opponentLabel: 'Gardevoir ex', winRate: 63, matches: 196, fieldShare: 9.4 }),
    stat({ opponentLabel: 'Charizard ex', winRate: 55, matches: 170, fieldShare: 8.2 }),
    stat({ opponentLabel: 'Gholdengo', winRate: 52, matches: 133, fieldShare: 7.8 }),
    stat({ opponentLabel: 'Slowking', winRate: 45, matches: 208, fieldShare: 6.1 }),
    stat({ opponentLabel: 'Raging Bolt', winRate: 54, matches: 142, fieldShare: 6.5 }),
    stat({ opponentLabel: 'Dragapult', winRate: 50, matches: 191, fieldShare: 12.7, isMirror: true }),
    stat({ opponentLabel: 'Iron Thorns', winRate: 30, matches: 15, fieldShare: 0.9 }) // low-sample
  ];
  const key = selectKeyMatchups(rows);
  assert.equal(key.length, 5);
  // Mirror + low-sample never selected.
  assert.ok(!key.some(r => r.isMirror));
  assert.ok(!key.some(r => r.opponentLabel === 'Iron Thorns'));
  // Displayed order is descending field share. Note Raging Bolt (imp 6.5*sqrt(4)=13)
  // edges out Gholdengo (imp 7.8*sqrt(2)=11) — the importance formula, not raw share.
  assert.deepEqual(
    key.map(r => r.opponentLabel),
    ['Dragapult Dusknoir', 'Gardevoir ex', 'Charizard ex', 'Raging Bolt', 'Slowking']
  );
});

test('selectKeyMatchups: a lopsided but rarer matchup can beat a common even one', () => {
  const rows: MatchupStat[] = [
    stat({ opponentLabel: 'CommonEven', winRate: 50, matches: 300, fieldShare: 10 }), // imp 10
    stat({ opponentLabel: 'RareBlowout', winRate: 80, matches: 100, fieldShare: 2 }) // imp 2*sqrt(30)=10.95
  ];
  const key = selectKeyMatchups(rows, WR_MIN_GAMES, 1);
  assert.equal(key[0]?.opponentLabel, 'RareBlowout');
});
