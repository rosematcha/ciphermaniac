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

test('changed keys with undefined values preserve the new shape', () => {
  const before = { old: undefined };
  const after = { next: undefined };
  const next = shared(before, after);
  assert.notEqual(next, before);
  assert.deepEqual(next, after);
  assert.deepEqual(shared([1], [1, undefined]), [1, undefined]);
});

test('a later change keeps references already compared, including special record keys', () => {
  const before = JSON.parse('{"unchanged":{"value":1},"__proto__":{"value":2},"last":0}');
  const after = JSON.parse('{"unchanged":{"value":1},"__proto__":{"value":2},"last":1}');
  const next = shared(before, after);
  assert.equal(next.unchanged, before.unchanged);
  assert.equal(
    Object.getOwnPropertyDescriptor(next, '__proto__')?.value,
    Object.getOwnPropertyDescriptor(before, '__proto__')?.value
  );
  assert.deepEqual(next, after);
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
});

test("a changed record keeps the new copy's key order and the parts it shares", () => {
  const before: Record<string, unknown> = { a: { value: 1 }, b: 1, c: 1 };
  const after: Record<string, unknown> = { d: 1, a: { value: 1 }, c: 1 };
  const next = shared(before, after);
  assert.deepEqual(Object.keys(next), ['d', 'a', 'c']);
  assert.equal(next.a, before.a);
});

test('a 1500-table round changes only the corrected table and its containers', () => {
  const before = { matches: Array.from({ length: 1500 }, (_, i) => ({ table: i + 1, outcome: 'pending' })) };
  const after = structuredClone(before);
  after.matches[1499]!.outcome = 'p1';
  const next = shared(before, after);
  assert.deepEqual(next, after);
  assert.ok(next.matches.slice(0, 1499).every((match, i) => match === before.matches[i]));
  assert.notEqual(next.matches[1499], before.matches[1499]);
});
