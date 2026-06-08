/**
 * Tests for the matchup row normalizer (src/lib/matchups.ts): orienting the
 * pre-aggregated majors matrix and the online matchups map into one row shape,
 * scoring a win as 3× a tie (match points).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mirrorRecord, rowsFromMajorsProfile, rowsFromOnlineMatchups } from '../../src/lib/matchups.ts';
import type { MatchupPair, MatchupProfile, OnlineMatchupRecord } from '../../src/lib/data.ts';

const approx = (actual: number, expected: number, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);

// Win rate with a tie worth 1/3 of a win (win 3, tie 1, loss 0).
const wr3 = (wins: number, ties: number, total: number) => ((wins + ties / 3) / total) * 100;

function pair(p: Partial<MatchupPair> & Pick<MatchupPair, 'archetypeA' | 'archetypeB'>): MatchupPair {
  const base = {
    matches: 0,
    winsA: 0,
    winsB: 0,
    ties: 0,
    doubleLosses: 0,
    weightedWinsA: 0,
    weightedWinsB: 0,
    weightedTies: 0,
    weightedWinRateA: 0,
    weightedWinRateB: 0,
    weightedMatches: 0,
    ...p
  };
  // Default the weighted components to the raw values (the 'all' profile), so
  // fixtures only need to set raw W/L/T. The win rate is recomputed from these.
  return {
    ...base,
    weightedWinsA: p.weightedWinsA ?? base.winsA,
    weightedWinsB: p.weightedWinsB ?? base.winsB,
    weightedTies: p.weightedTies ?? base.ties,
    weightedMatches: p.weightedMatches ?? base.matches
  };
}

function profile(pairs: MatchupPair[]): MatchupProfile {
  return { name: 'all', matchesConsidered: 0, weightedMatches: 0, byArchetypePair: pairs };
}

// Real-shape fixture mirroring observed Turin values (ties folded as 0.5 into winsA/B).
const PROF = profile([
  pair({
    archetypeA: 'Dragapult',
    archetypeB: 'Dragapult Dusknoir',
    matches: 271,
    winsA: 160.5,
    winsB: 110.5,
    ties: 33
  }),
  pair({ archetypeA: 'Dragapult', archetypeB: 'Dragapult', matches: 191, winsA: 97.5, winsB: 93.5, ties: 29 }),
  // A pair with double-losses: winsA + winsB < matches.
  pair({
    archetypeA: 'Dragapult',
    archetypeB: 'Festival Lead',
    matches: 10,
    winsA: 5,
    winsB: 3,
    ties: 0,
    doubleLosses: 2
  }),
  // Doesn't involve Dragapult — must be excluded.
  pair({ archetypeA: 'Slowking', archetypeB: 'Gholdengo', matches: 40, winsA: 20, winsB: 20 })
]);

test('majors: orients pairs so the current archetype is "us" and recovers raw W-L-T', () => {
  const rows = rowsFromMajorsProfile(PROF, 'Dragapult');
  const byOpp = new Map(rows.map(r => [r.opponentLabel, r]));

  const vsDusk = byOpp.get('Dragapult Dusknoir')!;
  assert.equal(vsDusk.isMirror, false);
  // winsA 160.5 with ties 33 → raw wins 144, raw losses 94 (110.5 − 16.5).
  assert.equal(vsDusk.wins, 144);
  assert.equal(vsDusk.losses, 94);
  assert.equal(vsDusk.ties, 33);
  assert.equal(vsDusk.matches, 271);
  approx(vsDusk.winRate, wr3(144, 33, 271)); // ~57.20, tie = 1/3
});

test('majors: the same pair seen from the OTHER side flips wins/losses and win rate', () => {
  const rows = rowsFromMajorsProfile(PROF, 'Dragapult Dusknoir');
  const vsDrag = rows.find(r => r.opponentLabel === 'Dragapult')!;
  assert.equal(vsDrag.wins, 94);
  assert.equal(vsDrag.losses, 144);
  approx(vsDrag.winRate, wr3(94, 33, 271)); // ~38.75
});

test('majors: mirror is presented symmetrically at 50% with the real sample size', () => {
  const mirror = rowsFromMajorsProfile(PROF, 'Dragapult').find(r => r.isMirror)!;
  assert.equal(mirror.opponentLabel, 'Dragapult');
  assert.equal(mirror.winRate, 50);
  assert.equal(mirror.wins, mirror.losses);
  assert.equal(mirror.wins, 81); // round((191 − 29)/2)
  assert.equal(mirror.ties, 29);
  assert.equal(mirror.matches, 191);
});

test('majors: double-losses count toward the denominator but not wins/losses', () => {
  const row = rowsFromMajorsProfile(PROF, 'Dragapult').find(r => r.opponentLabel === 'Festival Lead')!;
  assert.equal(row.matches, 10);
  assert.equal(row.doubleLosses, 2);
  assert.equal(row.wins, 5);
  assert.equal(row.losses, 3);
  approx(row.winRate, wr3(5, 0, 10)); // 50 — 5 wins over 10 weighted matches (2 double-losses)
});

test('majors: pairs not involving the archetype are excluded', () => {
  const rows = rowsFromMajorsProfile(PROF, 'Dragapult');
  assert.ok(!rows.some(r => r.opponentLabel === 'Slowking' || r.opponentLabel === 'Gholdengo'));
  assert.equal(rows.length, 3);
});

const ONLINE: Record<string, OnlineMatchupRecord> = {
  Slowking: { opponent: 'Slowking', wins: 93, losses: 115, ties: 0, total: 208, winRate: 44.7 },
  'Alakazam Dudunsparce': {
    opponent: 'Alakazam Dudunsparce',
    wins: 99,
    losses: 63,
    ties: 6,
    total: 168,
    winRate: 58.9
  },
  Dragapult: { opponent: 'Dragapult', wins: 139, losses: 127, ties: 3, total: 269, winRate: 51.7 }
};

test('online: recomputes win rate with a tie worth 1/3 (not the stored wins/total)', () => {
  const rows = rowsFromOnlineMatchups(ONLINE, 'Dragapult');
  const slow = rows.find(r => r.opponentLabel === 'Slowking')!;
  approx(slow.winRate, wr3(93, 0, 208)); // 44.71, not the stored 44.7
  const alak = rows.find(r => r.opponentLabel === 'Alakazam Dudunsparce')!;
  approx(alak.winRate, wr3(99, 6, 168)); // ties as 1/3: ~60.12
  assert.equal(alak.ties, 6);
});

test('online: mirror is symmetric at 50%', () => {
  const mirror = rowsFromOnlineMatchups(ONLINE, 'Dragapult').find(r => r.isMirror)!;
  assert.equal(mirror.winRate, 50);
  assert.equal(mirror.wins, mirror.losses);
  assert.equal(mirror.matches, 269);
});

test('mirrorRecord splits decisive games evenly and drops double-losses', () => {
  assert.deepEqual(mirrorRecord(191, 29, 0), { wins: 81, losses: 81, winRate: 50 });
  assert.deepEqual(mirrorRecord(10, 0, 2), { wins: 4, losses: 4, winRate: 50 });
});
