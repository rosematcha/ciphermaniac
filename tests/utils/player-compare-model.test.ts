import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerTournamentEntry } from '../../src/types/index.ts';
import { finishCmp, headToHead, sharedEvents } from '../../src/pages/playerCompare/model.ts';

function entry(over: Partial<PlayerTournamentEntry> & { tournamentId: string }): PlayerTournamentEntry {
  return {
    tournamentDate: '2026-01-01',
    totalPlayers: 100,
    placement: 10,
    wins: 6,
    losses: 2,
    ties: 1,
    madePhase2: false,
    madeTopCut: false,
    archetype: null,
    deckId: null,
    ...over
  };
}

function profile(tournaments: PlayerTournamentEntry[]): { tournaments: PlayerTournamentEntry[] } {
  return { tournaments };
}

test('shared events are the intersection by tournament, newest first', () => {
  const a = profile([
    entry({ tournamentId: 'x', tournamentDate: '2026-03-01' }),
    entry({ tournamentId: 'y', tournamentDate: '2026-05-01' }),
    entry({ tournamentId: 'only-a', tournamentDate: '2026-04-01' })
  ]);
  const b = profile([
    entry({ tournamentId: 'y', tournamentDate: '2026-05-01' }),
    entry({ tournamentId: 'x', tournamentDate: '2026-03-01' }),
    entry({ tournamentId: 'only-b', tournamentDate: '2026-06-01' })
  ]);

  assert.deepEqual(
    sharedEvents(a, b).map(e => e.tournamentId),
    ['y', 'x']
  );
});

test('the lower placement finished higher', () => {
  assert.equal(finishCmp(entry({ tournamentId: 'x', placement: 3 }), entry({ tournamentId: 'x', placement: 40 })), -1);
  assert.equal(finishCmp(entry({ tournamentId: 'x', placement: 40 }), entry({ tournamentId: 'x', placement: 3 })), 1);
  assert.equal(finishCmp(entry({ tournamentId: 'x', placement: 8 }), entry({ tournamentId: 'x', placement: 8 })), 0);
});

test('an unpublished finish is not a draw', () => {
  assert.equal(
    finishCmp(entry({ tournamentId: 'x', placement: null }), entry({ tournamentId: 'x', placement: 3 })),
    null
  );
  assert.equal(
    finishCmp(entry({ tournamentId: 'x', placement: 3 }), entry({ tournamentId: 'x', placement: null })),
    null
  );
  assert.equal(
    finishCmp(entry({ tournamentId: 'x', placement: null }), entry({ tournamentId: 'x', placement: null })),
    null
  );
});

test('head-to-head counts wins and genuine draws, and sets missing finishes aside', () => {
  const a = profile([
    entry({ tournamentId: 'w', placement: 1 }),
    entry({ tournamentId: 'l', placement: 90 }),
    entry({ tournamentId: 'd', placement: 12 }),
    entry({ tournamentId: 'u', placement: null })
  ]);
  const b = profile([
    entry({ tournamentId: 'w', placement: 50 }),
    entry({ tournamentId: 'l', placement: 2 }),
    entry({ tournamentId: 'd', placement: 12 }),
    entry({ tournamentId: 'u', placement: 4 })
  ]);

  assert.deepEqual(headToHead(sharedEvents(a, b)), { aWins: 1, bWins: 1, ties: 1, unscored: 1 });
});
