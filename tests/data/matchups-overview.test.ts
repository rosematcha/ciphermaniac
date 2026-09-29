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
  shownMatchups,
  summarizeMatchups
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

test('gaugeWidth: |WR-50|/30 as a percentage, clamped 0..100', () => {
  approx(gaugeWidth(50), 0);
  approx(gaugeWidth(80), 100); // ±30pp fills the track
  approx(gaugeWidth(20), 100);
  approx(gaugeWidth(65), 50); // half at 15pp
  approx(gaugeWidth(35), 50);
  approx(gaugeWidth(60), (10 / 30) * 100);
  approx(gaugeWidth(0), 100); // clamped
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

test('summarizeMatchups: accumulates field share per bucket for popularity weighting', () => {
  const rows: MatchupStat[] = [
    stat({ opponentLabel: 'BigFav', winRate: 60, matches: 200, fieldShare: 80 }),
    stat({ opponentLabel: 'SmallFav', winRate: 55, matches: 200, fieldShare: 5 }),
    stat({ opponentLabel: 'Even', winRate: 50, matches: 200, fieldShare: 10 }),
    stat({ opponentLabel: 'Unf', winRate: 40, matches: 200, fieldShare: 3 }),
    stat({ opponentLabel: 'Unknown', winRate: 42, matches: 200, fieldShare: null })
  ];
  const s = summarizeMatchups(rows);
  assert.equal(s.favoredShare, 85); // 80 + 5
  assert.equal(s.evenShare, 10);
  assert.equal(s.unfavoredShare, 3); // null contributes 0
});

test('summarizeMatchups: empty when nothing meets the floor', () => {
  const s = summarizeMatchups([stat({ opponentLabel: 'X', matches: 5 })]);
  assert.equal(s.tracked, 0);
  assert.equal(s.best, null);
  assert.equal(s.toughest, null);
});

test('shownMatchups: every row at the floor shows, topped up to MIN_SHOWN by the most-played', () => {
  const rows = (counts: number[]) => counts.map((matches, i) => ({ opponentLabel: 'abcdefghij'[i], matches }));
  const cases: Array<[string, number[], string]> = [
    // Eight clear the floor of 20 (h exactly at it), so 19 stays hidden.
    ['a well-sampled deck', [200, 100, 60, 40, 30, 25, 21, 20, 19, 3], 'abcdefgh'],
    // Nothing clears the floor; the most-played headline and the two rarest spill to the expander.
    ['a low-playrate deck', [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'abcdefgh'],
    // Three clear the floor; fill tops up with the next most-played.
    ['floor rows plus fill', [50, 40, 20, 15, 14, 13, 12, 11, 10], 'abcdefgh'],
    // Nine clear the floor: all show, more than MIN_SHOWN.
    ['more than MIN_SHOWN at the floor', [90, 80, 70, 60, 50, 40, 30, 21, 20, 5], 'abcdefghi']
  ];
  for (const [label, counts, expected] of cases) {
    assert.deepEqual([...shownMatchups(rows(counts))].sort().join(''), expected, label);
  }
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
