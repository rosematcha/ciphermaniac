import assert from 'node:assert/strict';
import test from 'node:test';

import { TOP_PLAYERS_COUNT, topPlayers } from '../../shared/onlineMeta/playerTop.ts';
import { comparePlayers } from '../../src/utils/playerSort.ts';
import type { PlayerIndexEntry } from '../../shared/playerTypes.ts';

test('the published first page is the players page default ranking, first 50', () => {
  const names = ['Ash', 'ash', 'Ánna', 'Brock', 'Misty', 'Zed', 'émile', 'Gary'];
  const index: PlayerIndexEntry[] = Array.from({ length: 400 }, (_, i) => ({
    playerId: String(i),
    name: `${names[i % names.length]} ${i % 7}`,
    eventCount: (i * 7919) % 13,
    wins: i % 11,
    losses: i % 5,
    day2s: (i * 104729) % 6,
    topCuts: i % 3,
    tournamentWins: 0,
    lastEventDate: '2026-11-01'
  }));
  const page = [...index].sort(comparePlayers('day2s', 'desc')).slice(0, TOP_PLAYERS_COUNT);
  assert.deepEqual(
    topPlayers(index).map(entry => entry.playerId),
    page.map(entry => entry.playerId)
  );
});

test('everyone tied with the 50th comes along, so a page sorting names its own way picks its own 50th', () => {
  const entry = (playerId: string, name: string, day2s: number): PlayerIndexEntry => ({
    playerId,
    name,
    eventCount: 5,
    wins: 0,
    losses: 0,
    day2s,
    topCuts: 0,
    tournamentWins: 0,
    lastEventDate: '2026-11-01'
  });
  const index = [
    ...Array.from({ length: 49 }, (_, i) => entry(`hi${i}`, `High ${i}`, 9)),
    entry('a', 'Äsa', 1),
    entry('z', 'Zed', 1),
    entry('low', 'Low', 0)
  ];
  const top = topPlayers(index);
  assert.equal(top.length, 51);
  assert.deepEqual(
    top
      .slice(49)
      .map(row => row.playerId)
      .sort(),
    ['a', 'z']
  );
});
