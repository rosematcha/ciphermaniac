/**
 * The history index's side of a change to an event: which player IDs it
 * indexes, what a change adds and removes, which players it takes off the
 * list, and how the IDs are split for D1's cap on bound values.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunks, IDS_PER_STATEMENT, indexedIds, rosterDiff } from '../../shared/tournament/history.ts';
import type { Player } from '../../shared/tournament/types.ts';
import { DEFAULT_SETTINGS, type TournamentMode } from '../../shared/tournament/view.ts';

/** An event with players under `ids`, sanctioned or not. */
function event(ids: string[], sanctioned = true, mode: TournamentMode = 'swiss') {
  const players = ids.map(id => ({ id }) as Player);
  return { mode, settings: { ...DEFAULT_SETTINGS, sanctioned }, tournament: { players } };
}

test('a sanctioned event indexes every player, an unsanctioned one none, and a TOM event always counts', () => {
  assert.deepEqual([...indexedIds(event(['1', '2']))], ['1', '2']);
  assert.deepEqual([...indexedIds(event(['1', '2'], false))], []);
  assert.deepEqual([...indexedIds(event(['1'], false, 'tom'))], ['1'], 'TOM events are sanctioned');
});

test('adding and removing players at a sanctioned event adds and removes them in the index', () => {
  assert.deepEqual(rosterDiff(event(['1']), event(['1', '2'])), { add: ['2'], remove: [], gone: [] });
  assert.deepEqual(rosterDiff(event(['1', '2']), event(['2'])), { add: [], remove: ['1'], gone: ['1'] });
  assert.deepEqual(rosterDiff(event(['1', '2']), event(['1', '2'])), { add: [], remove: [], gone: [] });
});

test('an unsanctioned event indexes nothing, but a player taken off its list is still gone', () => {
  assert.deepEqual(rosterDiff(event(['1'], false), event(['1', '2'], false)), { add: [], remove: [], gone: [] });
  assert.deepEqual(rosterDiff(event(['1', '2'], false), event(['2'], false)), { add: [], remove: [], gone: ['1'] });
});

test('turning sanctioned off removes every player from the index, and on again restores them', () => {
  assert.deepEqual(rosterDiff(event(['1', '2']), event(['1', '2'], false)), {
    add: [],
    remove: ['1', '2'],
    gone: []
  });
  assert.deepEqual(rosterDiff(event(['1', '2'], false), event(['1', '2'])), {
    add: ['1', '2'],
    remove: [],
    gone: []
  });
});

test('an ID TOM changed is a removal and an addition, and the old ID is gone', () => {
  const before = event(['1', '2'], false, 'tom');
  const after = event(['1', '3'], false, 'tom');
  assert.deepEqual(rosterDiff(before, after), { add: ['3'], remove: ['2'], gone: ['2'] });
});

test('IDs split into runs of at most 98, in order', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i));
  assert.equal(IDS_PER_STATEMENT, 98);
  assert.deepEqual(chunks([]), []);
  assert.deepEqual(chunks(ids(1)), [['0']]);
  assert.deepEqual(
    chunks(ids(98)).map(run => run.length),
    [98]
  );
  const split = chunks(ids(99));
  assert.deepEqual(
    split.map(run => run.length),
    [98, 1]
  );
  assert.deepEqual(split.flat(), ids(99));
  assert.deepEqual(
    chunks(ids(700)).map(run => run.length),
    [98, 98, 98, 98, 98, 98, 98, 14]
  );
  assert.deepEqual(chunks(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
});
