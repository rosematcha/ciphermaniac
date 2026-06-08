/**
 * Tests for the card-lens compute (src/lib/cardLens.ts): partition an archetype's
 * decks by a card, tally each subset's matchups, and diff them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLensRows, countInDeck, type DeckLite, partitionByCard, tallyLens, wrOf } from '../../src/lib/cardLens.ts';
import { buildCardId } from '../../src/utils/deckCardId.ts';
import type { DeckCard, PlayerMatchRecord } from '../../src/types/index.ts';

const approx = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);

const CARD = buildCardId('ASC', '076'); // 'ASC~076'

const DECKS: DeckLite[] = [
  { playerId: '1', cards: [{ name: 'X', set: 'ASC', number: '76', count: 1 }] as DeckCard[] }, // raw "76" → ASC~076
  { playerId: '2', cards: [{ name: 'X', set: 'ASC', number: '076', count: 2 }] as DeckCard[] },
  { playerId: '3', cards: [{ name: 'Y', set: 'ASC', number: '010', count: 4 }] as DeckCard[] } // no card
];

function m(
  playerId: number,
  opponentArchetype: string | undefined,
  outcome: PlayerMatchRecord['outcome'],
  completed = true
): PlayerMatchRecord {
  return { id: `${playerId}:r1`, playerId, round: 1, opponentArchetype, outcome, completed };
}

const MATCHES: PlayerMatchRecord[] = [
  m(1, 'Dragapult', 'win'),
  m(1, 'Dragapult', 'loss'),
  m(2, 'Dragapult', 'win'),
  m(3, 'Dragapult', 'loss'),
  m(3, 'Dragapult', 'tie'),
  m(1, 'Unknown', 'win'), // skipped: unknown opponent
  m(2, 'Dragapult', 'win', false), // skipped: incomplete
  m(1, undefined, 'win'), // skipped: bye (no opponent)
  m(99, 'Dragapult', 'win') // skipped: pilot in neither subset
];

test('countInDeck sums copies of the canonical card id, normalizing the number', () => {
  assert.equal(countInDeck(DECKS[0].cards, CARD), 1);
  assert.equal(countInDeck(DECKS[1].cards, CARD), 2);
  assert.equal(countInDeck(DECKS[2].cards, CARD), 0);
});

test('partitionByCard splits decks into runs-≥N vs not', () => {
  const p1 = partitionByCard(DECKS, CARD, 1);
  assert.deepEqual([...p1.withIds].sort(), [1, 2]);
  assert.deepEqual([...p1.withoutIds], [3]);
  assert.equal(p1.withCount, 2);
  assert.equal(p1.withoutCount, 1);

  const p2 = partitionByCard(DECKS, CARD, 2);
  assert.deepEqual([...p2.withIds], [2]);
  assert.deepEqual([...p2.withoutIds].sort(), [1, 3]);
});

test('tallyLens routes completed games by pilot + opponent, skipping byes/incomplete/unknown', () => {
  const part = partitionByCard(DECKS, CARD, 1);
  const t = tallyLens(MATCHES, part);
  assert.deepEqual(t.withBy.get('Dragapult'), { w: 2, l: 1, t: 0, n: 3 });
  assert.deepEqual(t.withoutBy.get('Dragapult'), { w: 0, l: 1, t: 1, n: 2 });
  assert.deepEqual(t.withOverall, { w: 2, l: 1, t: 0, n: 3 });
  assert.deepEqual(t.withoutOverall, { w: 0, l: 1, t: 1, n: 2 });
});

test('buildLensRows computes win rates (tie = 1/3 of a win) and the delta', () => {
  const part = partitionByCard(DECKS, CARD, 1);
  const rows = buildLensRows(tallyLens(MATCHES, part));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.opponent, 'Dragapult');
  approx(r.withWR!, (2 / 3) * 100); // w2,t0 → 66.67
  approx(r.withoutWR!, ((0 + 1 / 3) / 2) * 100); // w0,t1 → 16.67
  approx(r.delta!, (2 / 3) * 100 - ((0 + 1 / 3) / 2) * 100); // ~50.0
});

test('wrOf returns null with no games and scores a tie as 1/3 of a win otherwise', () => {
  assert.equal(wrOf({ w: 0, l: 0, t: 0, n: 0 }), null);
  approx(wrOf({ w: 3, l: 1, t: 2, n: 6 })!, ((3 + 2 / 3) / 6) * 100); // ~61.11
});
