/**
 * Swiss pairing: inside point groups, no rematches while any other pairing
 * exists, the bye to the lowest player without one, and a top cut seeded so the
 * top two can only meet in the final.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type Entrant,
  type PairingHistory,
  pairNextElimination,
  pairSwiss,
  pairTopCut,
  pickBye,
  rankForPairing
} from '../../shared/tournament/pairing.ts';
import { seededRandom } from '../../shared/tournament/random.ts';

const noHistory: PairingHistory = { opponents: new Map(), byes: new Set() };

function entrants(points: number[]): Entrant[] {
  return points.map((p, i) => ({ id: `p${i}`, points: p }));
}

function history(pairs: [string, string][], byes: string[] = []): PairingHistory {
  const opponents = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    opponents.set(a, new Set([...(opponents.get(a) ?? []), b]));
    opponents.set(b, new Set([...(opponents.get(b) ?? []), a]));
  }
  return { opponents, byes: new Set(byes) };
}

test('ranks by points and keeps each point group together', () => {
  const ranked = rankForPairing(entrants([0, 3, 3, 6, 0, 3]), seededRandom(1));
  assert.equal(ranked[0], 'p3');
  assert.deepEqual(new Set(ranked.slice(1, 4)), new Set(['p1', 'p2', 'p5']));
  assert.deepEqual(new Set(ranked.slice(4)), new Set(['p0', 'p4']));
});

test('pairs everyone once in an even field', () => {
  const pairings = pairSwiss(entrants([0, 0, 0, 0, 0, 0]), noHistory, seededRandom(7));
  assert.equal(pairings.length, 3);
  const seen = pairings.flatMap(p => [p.p1, p.p2]);
  assert.equal(new Set(seen).size, 6);
  assert.ok(seen.every(id => id !== null));
});

test('gives the bye to the lowest player who has not had one', () => {
  const field = entrants([6, 3, 3, 0, 0]);
  const pairings = pairSwiss(field, history([], ['p3', 'p4']), seededRandom(3));
  const bye = pairings.find(p => p.p2 === null);
  assert.ok(bye);
  // Both 0-point players have had a bye, so it moves up to a 3-point player.
  assert.ok(['p1', 'p2'].includes(bye.p1));
  assert.equal(pairings.at(-1), bye);
});

test('pickBye falls back to the last player when everyone has had one', () => {
  assert.equal(pickBye(['a', 'b'], new Set(['a', 'b'])), 'b');
});

test('pairs within the point group before pairing down', () => {
  const pairings = pairSwiss(entrants([3, 3, 3, 3, 0, 0, 0, 0]), noHistory, seededRandom(11));
  for (const pairing of pairings) {
    const points = [pairing.p1, pairing.p2].map(id => Number(id?.slice(1)) < 4);
    assert.equal(points[0], points[1], `${pairing.p1} v ${pairing.p2} crosses groups`);
  }
});

test('avoids a rematch when another pairing exists', () => {
  const field = entrants([3, 3, 0, 0]);
  const pairings = pairSwiss(field, history([['p0', 'p1']]), seededRandom(5));
  for (const pairing of pairings) {
    assert.notDeepEqual(new Set([pairing.p1, pairing.p2]), new Set(['p0', 'p1']));
  }
});

test('allows a rematch rather than leaving a round unpaired', () => {
  const pairings = pairSwiss(entrants([3, 0]), history([['p0', 'p1']]), seededRandom(5));
  assert.deepEqual(pairings, [{ p1: 'p0', p2: 'p1' }]);
});

test('a forty-player field with five rounds of history pairs rematch-free', () => {
  const random = seededRandom(99);
  const field = entrants(Array.from({ length: 40 }, () => 0));
  const played: [string, string][] = [];
  for (let round = 0; round < 5; round += 1) {
    const pairings = pairSwiss(field, history(played), random);
    for (const { p1, p2 } of pairings) {
      assert.ok(p2);
      assert.ok(!played.some(([a, b]) => (a === p1 && b === p2) || (a === p2 && b === p1)));
      played.push([p1, p2]);
      const winner = field.find(entrant => entrant.id === (random() < 0.5 ? p1 : p2));
      if (winner) {
        winner.points += 3;
      }
    }
  }
});

test('a field of thousands pairs everyone, without the walk copying the field at every step', () => {
  const entrants = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, points: 0 }));
  const started = performance.now();
  const pairings = pairSwiss(entrants, noHistory, seededRandom(1));
  assert.ok(performance.now() - started < 1000, 'well inside a request');
  const seated = pairings.flatMap(p => [p.p1, p.p2]).filter(id => id !== null);
  assert.equal(new Set(seated).size, 5001);
  assert.equal(pairings.at(-1)?.p2, null, 'the odd player out has the bye');
});

test('seeds a top cut and advances winners in bracket order', () => {
  const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  assert.deepEqual(pairTopCut(seeds), [
    { p1: 's1', p2: 's8' },
    { p1: 's4', p2: 's5' },
    { p1: 's2', p2: 's7' },
    { p1: 's3', p2: 's6' }
  ]);
  assert.deepEqual(pairNextElimination(['s1', 's5', 's2', 's3']), [
    { p1: 's1', p2: 's5' },
    { p1: 's2', p2: 's3' }
  ]);
});
