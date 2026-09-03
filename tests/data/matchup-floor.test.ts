import test from 'node:test';
import assert from 'node:assert';
import { buildMatchupMatrix, MIN_MATCHUP_GAMES } from '../../shared/data/analysis/archetypeTrends.js';

const standing = (player: string, deck: string) => ({ player, deck: { name: deck } });
const pairing = (player1: string, player2: string, winner: string | number) => ({ player1, player2, winner });

test('the default matchup floor matches the frontend readout floor', () => {
  assert.strictEqual(MIN_MATCHUP_GAMES, 20);
});

test('buildMatchupMatrix publishes nothing below the default floor', () => {
  const pairings = Array.from({ length: 19 }, () => pairing('p1', 'p2', 'p1'));
  const sheet = { tournamentId: 't1', standings: [standing('p1', 'TestDeck'), standing('p2', 'Opponent')], pairings };
  assert.deepStrictEqual(buildMatchupMatrix('TestDeck', [sheet]), {});

  pairings.push(pairing('p1', 'p2', 'p2'));
  const result = buildMatchupMatrix('TestDeck', [sheet]);
  assert.strictEqual(result.Opponent.total, 20);
  assert.strictEqual(result.Opponent.winRate, 95);
});

test('buildMatchupMatrix never credits a game against the Other bucket', () => {
  const sheet = {
    tournamentId: 't1',
    standings: [standing('p1', 'TestDeck'), standing('p2', 'Other'), standing('p3', 'Unknown')],
    pairings: [
      ...Array.from({ length: 25 }, () => pairing('p1', 'p2', 'p1')),
      ...Array.from({ length: 25 }, () => pairing('p1', 'p3', 'p1'))
    ]
  };
  assert.deepStrictEqual(buildMatchupMatrix('TestDeck', [sheet], 3), {});
});
