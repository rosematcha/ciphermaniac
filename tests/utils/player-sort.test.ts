import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerIndexSlimEntry } from '../../shared/playerTypes.ts';
import { comparePlayers, DAY2_RATE_MIN_EVENTS, day2Rate, sortValue } from '../../src/utils/playerSort.ts';

let nextId = 0;
function player(over: Partial<PlayerIndexSlimEntry>): PlayerIndexSlimEntry {
  nextId += 1;
  return {
    playerId: String(nextId),
    name: `Player ${nextId}`,
    eventCount: 0,
    day2s: 0,
    topCuts: 0,
    tournamentWins: 0,
    ...over
  };
}

test('day2Rate is day2s over events, 0 when unplayed', () => {
  assert.equal(day2Rate(player({ eventCount: 4, day2s: 3 })), 0.75);
  assert.equal(day2Rate(player({ eventCount: 0, day2s: 0 })), 0);
});

test('sortValue maps each key to its column', () => {
  const p = player({ eventCount: 10, day2s: 7, topCuts: 3, tournamentWins: 2 });
  assert.equal(sortValue(p, 'events'), 10);
  assert.equal(sortValue(p, 'day2s'), 7);
  assert.equal(sortValue(p, 'topCuts'), 3);
  assert.equal(sortValue(p, 'titles'), 2);
  assert.equal(sortValue(p, 'day2Rate'), 0.7);
});

test('count sorts order by value in both directions', () => {
  const low = player({ day2s: 2 });
  const high = player({ day2s: 9 });
  assert.deepEqual([low, high].sort(comparePlayers('day2s', 'desc')), [high, low]);
  assert.deepEqual([high, low].sort(comparePlayers('day2s', 'asc')), [low, high]);
});

test('day2Rate sort ranks small samples below qualified players', () => {
  // 100% over 2 events must not outrank 83% over 42 events.
  const smallPerfect = player({ eventCount: DAY2_RATE_MIN_EVENTS - 3, day2s: DAY2_RATE_MIN_EVENTS - 3 });
  const seasoned = player({ eventCount: 42, day2s: 35 });
  const sorted = [smallPerfect, seasoned].sort(comparePlayers('day2Rate', 'desc'));
  assert.deepEqual(sorted, [seasoned, smallPerfect]);
});

test('day2Rate sort keeps the small-sample partition in ascending order too', () => {
  const smallZero = player({ eventCount: 2, day2s: 0 });
  const seasonedLow = player({ eventCount: 20, day2s: 1 });
  const sorted = [smallZero, seasonedLow].sort(comparePlayers('day2Rate', 'asc'));
  assert.deepEqual(sorted, [seasonedLow, smallZero]);
});

test('day2Rate sort orders by rate within each partition', () => {
  const a = player({ eventCount: 10, day2s: 9 });
  const b = player({ eventCount: 10, day2s: 5 });
  const c = player({ eventCount: 3, day2s: 3 });
  const d = player({ eventCount: 3, day2s: 1 });
  const sorted = [d, b, c, a].sort(comparePlayers('day2Rate', 'desc'));
  assert.deepEqual(sorted, [a, b, c, d]);
});
