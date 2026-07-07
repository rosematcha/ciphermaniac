/**
 * Tests for the aggregate event win rate (src/lib/archetypeWinRate.ts) and the
 * typical-list cost estimate (src/lib/deckCost.ts): the two pure functions behind
 * the new archetype hero/index stats.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateEventWinRate } from '../../src/lib/archetypeWinRate.ts';
import { type MatchupRowCore, shrunkWinRate } from '../../src/lib/matchups.ts';
import { estimateDeckCost, modalCopies } from '../../src/lib/deckCost.ts';
import type { CardItem } from '../../src/types/index.ts';

const approx = (actual: number, expected: number, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);

// Win rate with a tie worth 1/3 of a win (win 3, tie 1, loss 0).
const wr3 = (wins: number, ties: number, total: number) => ((wins + ties / 3) / total) * 100;

function row(p: Partial<MatchupRowCore> & Pick<MatchupRowCore, 'opponentLabel'>): MatchupRowCore {
  return {
    isMirror: false,
    wins: 0,
    losses: 0,
    ties: 0,
    doubleLosses: 0,
    matches: 0,
    winRate: 0,
    ...p
  };
}

test('aggregate: sums W/L/T and games, excludes the mirror, ties worth 1/3', () => {
  const rows = [
    row({ opponentLabel: 'A', wins: 60, losses: 30, ties: 10, matches: 100 }),
    row({ opponentLabel: 'B', wins: 20, losses: 25, ties: 5, matches: 50 }),
    // Mirror must be dropped even though it carries games.
    row({ opponentLabel: 'Mirror', isMirror: true, wins: 40, losses: 40, matches: 80, winRate: 50 })
  ];
  const agg = aggregateEventWinRate(rows);
  assert.equal(agg.wins, 80);
  assert.equal(agg.losses, 55);
  assert.equal(agg.ties, 15);
  assert.equal(agg.games, 150);
  approx(agg.winRate!, wr3(80, 15, 150));
});

test('aggregate: double losses stay in the denominator but not W/L/T', () => {
  const rows = [row({ opponentLabel: 'A', wins: 5, losses: 3, ties: 0, doubleLosses: 2, matches: 10 })];
  const agg = aggregateEventWinRate(rows);
  assert.equal(agg.games, 10);
  approx(agg.winRate!, wr3(5, 0, 10)); // 50%: 5 wins over 10 games
});

test('aggregate: no games yields a null win rate (not 0)', () => {
  assert.equal(aggregateEventWinRate([]).winRate, null);
  const mirrorOnly = aggregateEventWinRate([row({ opponentLabel: 'M', isMirror: true, matches: 80 })]);
  assert.equal(mirrorOnly.games, 0);
  assert.equal(mirrorOnly.winRate, null);
});

test('shrunkWinRate pulls small samples toward 0.5 so 2-0 loses to a proven 65%', () => {
  const fringe = shrunkWinRate(2, 0, 2); // raw 100%
  const proven = shrunkWinRate(130, 0, 200); // raw 65%
  assert.ok(proven > fringe, `proven ${proven} should outrank fringe ${fringe}`);
  approx(fringe, (2 + 5) / (2 + 10)); // ~0.583
  approx(proven, (130 + 5) / (200 + 10)); // ~0.643
});

// --- deck cost ---

function card(p: Partial<CardItem> & Pick<CardItem, 'name' | 'set' | 'number' | 'pct'>): CardItem {
  return { found: 0, total: 0, ...p } as CardItem;
}

test('modalCopies picks the copy count run by the most players', () => {
  const c = card({
    name: 'X',
    set: 'SET',
    number: '1',
    pct: 90,
    dist: [
      { copies: 1, players: 5 },
      { copies: 2, players: 40 },
      { copies: 4, players: 12 }
    ]
  });
  assert.equal(modalCopies(c), 2);
  assert.equal(modalCopies(card({ name: 'Y', set: 'SET', number: '2', pct: 90 })), 1); // no dist → 1
});

test('estimateDeckCost sums modal copies × price over cards in ≥50% of lists', () => {
  const items = [
    card({ name: 'Charizard ex', set: 'OBF', number: '125', pct: 95, dist: [{ copies: 2, players: 100 }] }),
    card({ name: 'Pidgeot ex', set: 'OBF', number: '164', pct: 80, dist: [{ copies: 1, players: 90 }] }),
    // Below the inclusion floor — excluded entirely.
    card({ name: 'Tech Card', set: 'SET', number: '9', pct: 20, dist: [{ copies: 1, players: 5 }] })
  ];
  const prices = {
    'Charizard ex::OBF::125': { price: 10 },
    'Pidgeot ex::OBF::164': { price: 4 }
  };
  const est = estimateDeckCost(items, prices)!;
  assert.equal(est.includedCount, 2);
  assert.equal(est.missingCount, 0);
  approx(est.cost, 10 * 2 + 4 * 1); // 24
});

test('estimateDeckCost returns null when >20% of included cards lack a price', () => {
  const items = [
    card({ name: 'Priced', set: 'S', number: '1', pct: 90 }),
    card({ name: 'Basic Fire Energy', set: 'S', number: '2', pct: 90 }),
    card({ name: 'Basic Water Energy', set: 'S', number: '3', pct: 90 })
  ];
  const prices = { 'Priced::S::1': { price: 5 } };
  // 2 of 3 missing → 66% > 20% → skip.
  assert.equal(estimateDeckCost(items, prices), null);
});

test('estimateDeckCost returns null with no cards over the inclusion floor', () => {
  assert.equal(estimateDeckCost([card({ name: 'A', set: 'S', number: '1', pct: 10 })], {}), null);
});
