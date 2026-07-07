/**
 * Tests for the N×N matrix assembler (buildMatchupMatrix in src/lib/matchups.ts):
 * indexing normalized rows into a square grid keyed by archetype, dropping
 * opponents outside the supplied set and preserving the mirror on the diagonal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchupMatrix, type MatchupRowCore } from '../../src/lib/matchups.ts';
import { normalizeArchetypeKey } from '../../src/lib/data.ts';

function row(opponentLabel: string, winRate: number, matches: number, isMirror = false): MatchupRowCore {
  return { opponentLabel, isMirror, wins: 0, losses: 0, ties: 0, doubleLosses: 0, matches, winRate };
}

const key = normalizeArchetypeKey;

test('assembles a square matrix keyed by normalized archetype', () => {
  const entries = [
    {
      key: key('Dragapult'),
      rows: [row('Gholdengo', 60, 100), row('Dragapult', 50, 40, true), row('Fringe Deck', 90, 3)]
    },
    { key: key('Gholdengo'), rows: [row('Dragapult', 40, 100), row('Gholdengo', 50, 30, true)] }
  ];
  const m = buildMatchupMatrix(entries);

  // Opponent outside the supplied set is dropped (keeps the grid square).
  assert.equal(m.get(key('Dragapult'))!.has(key('Fringe Deck')), false);

  const cell = m.get(key('Dragapult'))!.get(key('Gholdengo'))!;
  assert.equal(cell.winRate, 60);
  assert.equal(cell.matches, 100);
  assert.equal(cell.isMirror, false);

  // The reciprocal cell reads the opponent's own row.
  assert.equal(m.get(key('Gholdengo'))!.get(key('Dragapult'))!.winRate, 40);
});

test('mirror lands on the diagonal and is flagged', () => {
  const entries = [{ key: key('Dragapult'), rows: [row('Dragapult', 50, 40, true)] }];
  const m = buildMatchupMatrix(entries);
  const diag = m.get(key('Dragapult'))!.get(key('Dragapult'))!;
  assert.equal(diag.isMirror, true);
  assert.equal(diag.winRate, 50);
});

test('missing pairs are simply absent (rendered as no data by the caller)', () => {
  const entries = [
    { key: key('A'), rows: [] },
    { key: key('B'), rows: [] }
  ];
  const m = buildMatchupMatrix(entries);
  assert.equal(m.get(key('A'))!.get(key('B')), undefined);
});
