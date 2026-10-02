import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.ts';
import { filterSortedPlayers } from '../../src/utils/playerSearch.ts';
import { comparePlayers } from '../../src/utils/playerSort.ts';
import { foldSearch } from '../../src/utils/searchFold.ts';

function player(name: string, eventCount: number): PlayerIndexSlimEntry {
  return { playerId: name, name, eventCount, day2s: 0, topCuts: 0, tournamentWins: 0, wins: 0, losses: 0 };
}

test('search partitions a pre-sorted base without re-reading names for sorting or folding', t => {
  const rows = [
    player('Joanna', 40),
    player('Ánna Zed', 10),
    player('Anna Abe', 10),
    player('Hannah', 20),
    player('Annabelle', 30),
    player('Other', 50)
  ];
  const nameReads = rows.map(row => {
    const { name } = row;
    const get = t.mock.fn(() => name);
    Object.defineProperty(row, 'name', { get, enumerable: true });
    return get;
  });
  const original = [...rows];
  const folded = new Map(rows.map(row => [row, foldSearch(row.name)]));
  const sortedBase = [...rows].sort(comparePlayers('events', 'desc'));
  const readsBeforeSearch = nameReads.map(get => get.mock.callCount());

  assert.deepEqual(filterSortedPlayers(sortedBase, folded, 'ann'), [rows[4], rows[2], rows[1], rows[0], rows[3]]);
  assert.deepEqual(filterSortedPlayers(sortedBase, folded, 'anna'), [rows[4], rows[2], rows[1], rows[0], rows[3]]);
  assert.deepEqual(filterSortedPlayers(sortedBase, folded, 'annab'), [rows[4]]);
  assert.deepEqual(filterSortedPlayers(sortedBase, folded, 'missing'), []);
  assert.equal(filterSortedPlayers(sortedBase, folded, ''), sortedBase);
  assert.deepEqual(
    nameReads.map(get => get.mock.callCount()),
    readsBeforeSearch
  );
  assert.deepEqual(rows, original);
});

test('search preserves the selected ranking in each match partition', () => {
  const rows = [player('Joanna', 40), player('Anna', 10), player('Annabelle', 30), player('Hannah', 20)];
  rows[0].day2s = 1;
  rows[1].day2s = 9;
  rows[2].day2s = 4;
  rows[3].day2s = 2;
  const folded = new Map(rows.map(row => [row, foldSearch(row.name)]));
  const sortedBase = [...rows].sort(comparePlayers('day2s', 'asc'));
  assert.deepEqual(filterSortedPlayers(sortedBase, folded, 'ann'), [rows[2], rows[1], rows[0], rows[3]]);
});
