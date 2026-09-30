/**
 * A new copy of an event laid over the one shown: what did not change is the
 * same object as before, so the pages redraw only what did.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { shared } from '../../src/lib/tournament/share.ts';

const event = () => ({
  version: 4,
  players: [
    { id: '1', name: 'Ash' },
    { id: '2', name: 'Misty' }
  ],
  rounds: [
    { number: 1, matches: [{ table: 1, p1: '1', p2: '2', outcome: 'p1' }] },
    {
      number: 2,
      matches: [
        { table: 1, p1: '1', p2: '2', outcome: 'pending' },
        { table: 2, p1: '3', p2: null, outcome: 'bye' }
      ]
    }
  ],
  decks: { '1': 'Gardevoir' } as Record<string, string>
});

test('a copy that says the same is the copy already shown', () => {
  const before = event();
  assert.equal(shared(before, event()), before);
});

test('one result changes its match and what holds it, and nothing beside it', () => {
  const before = event();
  const after = event();
  after.version = 5;
  (after.rounds[1] as (typeof after.rounds)[number]).matches[0]!.outcome = 'p2';
  const next = shared(before, after);
  assert.deepEqual(next, after);
  assert.notEqual(next, before);
  assert.equal(next.players, before.players);
  assert.equal(next.decks, before.decks);
  assert.equal(next.rounds[0], before.rounds[0], 'a finished round is untouched');
  assert.notEqual(next.rounds[1], before.rounds[1]);
  assert.notEqual(next.rounds[1]?.matches[0], before.rounds[1]?.matches[0]);
  assert.equal(next.rounds[1]?.matches[1], before.rounds[1]?.matches[1], 'the table beside it is the same row');
});

test('a player or a round added keeps everyone and everything before it', () => {
  const before = event();
  const after = event();
  after.players.push({ id: '3', name: 'Brock' });
  after.rounds.push({ number: 3, matches: [] });
  const next = shared(before, after);
  assert.deepEqual(next, after);
  assert.equal(next.players[0], before.players[0]);
  assert.equal(next.players[1], before.players[1]);
  assert.equal(next.rounds[1], before.rounds[1]);
});

test('what was removed or changed kind is taken as the new copy has it', () => {
  const before = event();
  const after = event();
  after.players.pop();
  delete after.decks['1'];
  const next = shared(before, after);
  assert.deepEqual(next, after);
  assert.equal(next.players[0], before.players[0]);
  assert.deepEqual(shared({ a: [1] }, { a: { 0: 1 } }), { a: { 0: 1 } });
  assert.deepEqual(shared(undefined, after), after, 'a first copy is taken whole');
  assert.equal(shared({ a: null }, { a: null }).a, null);
});
