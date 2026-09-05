import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.ts';
import { comparePlayers, RATE_MIN_EVENTS, sortValue, winPct } from '../../src/utils/playerSort.ts';

let nextId = 0;
function player(over: Partial<PlayerIndexSlimEntry>): PlayerIndexSlimEntry {
  nextId += 1;
  return {
    playerId: String(nextId),
    name: `Player ${nextId}`,
    eventCount: 0,
    wins: 0,
    losses: 0,
    day2s: 0,
    topCuts: 0,
    tournamentWins: 0,
    ...over
  };
}

test('winPct is wins over decided games, 0 when unplayed', () => {
  assert.equal(winPct(player({ wins: 3, losses: 1 })), 0.75);
  assert.equal(winPct(player({ wins: 0, losses: 0 })), 0);
});

test('sortValue maps each key to its column', () => {
  const p = player({ eventCount: 10, day2s: 7, topCuts: 4, tournamentWins: 2, wins: 30, losses: 10 });
  assert.equal(sortValue(p, 'events'), 10);
  assert.equal(sortValue(p, 'day2s'), 7);
  assert.equal(sortValue(p, 'topCuts'), 4);
  assert.equal(sortValue(p, 'titles'), 2);
  assert.equal(sortValue(p, 'winPct'), 0.75);
});

test('top cuts and titles sort by value and tiebreak on events, then name', () => {
  const many = player({ name: 'Amy', topCuts: 9, tournamentWins: 1, eventCount: 20 });
  const few = player({ name: 'Bo', topCuts: 2, tournamentWins: 1, eventCount: 30 });
  assert.deepEqual([few, many].sort(comparePlayers('topCuts', 'desc')), [many, few]);
  assert.deepEqual([many, few].sort(comparePlayers('topCuts', 'asc')), [few, many]);
  // Equal titles: the busier career comes first in both directions.
  assert.deepEqual([many, few].sort(comparePlayers('titles', 'desc')), [few, many]);
  assert.deepEqual([many, few].sort(comparePlayers('titles', 'asc')), [few, many]);
});

test('count sorts order by value in both directions', () => {
  const low = player({ day2s: 2 });
  const high = player({ day2s: 9 });
  assert.deepEqual([low, high].sort(comparePlayers('day2s', 'desc')), [high, low]);
  assert.deepEqual([high, low].sort(comparePlayers('day2s', 'asc')), [low, high]);
});

test('win rate sort ranks small samples below qualified players', () => {
  // 6-0 over two events must not outrank 326-123 over forty-two.
  const smallPerfect = player({ eventCount: RATE_MIN_EVENTS - 3, wins: 6, losses: 0 });
  const seasoned = player({ eventCount: 42, wins: 326, losses: 123 });
  const sorted = [smallPerfect, seasoned].sort(comparePlayers('winPct', 'desc'));
  assert.deepEqual(sorted, [seasoned, smallPerfect]);
});

test('win rate sort keeps the small-sample partition in ascending order too', () => {
  const smallZero = player({ eventCount: 2, wins: 0, losses: 6 });
  const seasonedLow = player({ eventCount: 20, wins: 40, losses: 80 });
  const sorted = [smallZero, seasonedLow].sort(comparePlayers('winPct', 'asc'));
  assert.deepEqual(sorted, [seasonedLow, smallZero]);
});

test('win rate sort orders by rate within each partition', () => {
  const a = player({ eventCount: 10, wins: 9, losses: 1 });
  const b = player({ eventCount: 10, wins: 5, losses: 5 });
  const c = player({ eventCount: 3, wins: 3, losses: 0 });
  const d = player({ eventCount: 3, wins: 1, losses: 2 });
  assert.deepEqual([d, c, b, a].sort(comparePlayers('winPct', 'desc')), [a, b, c, d]);
});

test('equal values break on event count, then name — never on index order', () => {
  const few = player({ name: 'Zoe', day2s: 4, eventCount: 6 });
  const many = player({ name: 'Adam', day2s: 4, eventCount: 20 });
  assert.deepEqual([few, many].sort(comparePlayers('day2s', 'desc')), [many, few]);
  assert.deepEqual([few, many].sort(comparePlayers('day2s', 'asc')), [many, few]);

  const zed = player({ name: 'Zed', day2s: 4, eventCount: 6 });
  const abe = player({ name: 'Abe', day2s: 4, eventCount: 6 });
  assert.deepEqual([zed, abe].sort(comparePlayers('day2s', 'desc')), [abe, zed]);
});

test('sorting by events breaks its own ties on name', () => {
  const zed = player({ name: 'Zed', eventCount: 9 });
  const abe = player({ name: 'Abe', eventCount: 9 });
  assert.deepEqual([zed, abe].sort(comparePlayers('events', 'desc')), [abe, zed]);
});
