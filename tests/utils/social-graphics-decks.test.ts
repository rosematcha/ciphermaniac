/**
 * The deck graphics' numbers: which decks rank, what beats the field, and
 * which side of a matchup pair a row reads.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deckConversion, matchupGrid, topDecks } from '../../src/pages/socialGraphics/decks.ts';
import { exportFileName } from '../../src/pages/socialGraphics/model.ts';
import type { MatchupPair } from '../../src/lib/data/matchups.ts';
import type { TournamentParticipant } from '../../src/types/index.ts';

function players(deckName: string | null, count: number, day2: number): TournamentParticipant[] {
  return Array.from({ length: count }, (_, i) => ({
    tpId: i,
    name: `${deckName ?? 'unlisted'} ${i}`,
    deckName,
    madePhase2: i < day2
  }));
}

function pair(archetypeA: string, archetypeB: string, matches: number, winsA: number): MatchupPair {
  return { archetypeA, archetypeB, matches, winsA, winsB: matches - winsA } as MatchupPair;
}

const field = [
  ...players('Dragapult', 300, 60),
  ...players('Crustle', 80, 26),
  ...players('Slowking', 120, 18),
  ...players('Other', 400, 40),
  ...players(null, 10, 0)
];

test('ranks the most played decks by conversion, leaving out Other', () => {
  const result = deckConversion(field, 2);
  assert.ok(result);
  assert.deepEqual(
    result.rows.map(r => r.label),
    ['Dragapult', 'Slowking']
  );
  // Other still counts toward the field; unlisted players do not.
  assert.equal(result.fieldRate, (144 / 900) * 100);
});

test('only a deck clear of the field by more than chance beats it', () => {
  const { rows } = deckConversion(field, 3)!;
  assert.deepEqual(
    rows.map(r => [r.label, r.beatsField]),
    [
      ['Crustle', true],
      ['Dragapult', false],
      ['Slowking', false]
    ]
  );
});

test('an event with no Day 2 cut has no conversion graphic', () => {
  assert.equal(deckConversion(players('Dragapult', 10, 0), 10), null);
});

test('topDecks lists the most played decks first', () => {
  assert.deepEqual(topDecks(field, 2), ['Dragapult', 'Slowking']);
});

test('matchupGrid reads each row from its own side of the pair and hides thin pairs', () => {
  const grid = matchupGrid(
    [pair('Crustle', 'Dragapult', 40, 30), pair('Crustle', 'Slowking', 5, 5), pair('Dragapult', 'Slowking', 20, 8)],
    ['Dragapult', 'Slowking', 'Crustle']
  );
  assert.deepEqual(grid.rates, [
    [null, 40, 25],
    [60, null, null],
    [75, null, null]
  ]);
  assert.equal(grid.fewestMatches, 20);
});

test('a deck graphic export is named without a size', () => {
  assert.equal(
    exportFileName({ tournament: '2026-11-20, São Paulo', mode: 'matchups', theme: 'dark' }, 'png'),
    'sao-paulo-matchups-dark.png'
  );
});
