import assert from 'node:assert/strict';
import test from 'node:test';

import { orderHeadToHeadGroups, type Standing } from '../../shared/tournament/standings.ts';

const row = (playerId: string, place: number, points = 3): Standing => ({
  playerId,
  place,
  points,
  record: { wins: 1, losses: 2, ties: 0 },
  owp: 0.5,
  oowp: 0.5,
  late: false,
  dropped: false
});

test('recorded cyclic head-to-head groups occupy only their computed places', () => {
  const rows = [row('1', 1, 9), row('2', 2), row('3', 3), row('4', 4), row('5', 5, 0)];
  const ordered = orderHeadToHeadGroups(rows, [['4', '2', '3']]);
  assert.deepEqual(
    ordered.map(r => [r.playerId, r.place]),
    [
      ['1', 1],
      ['4', 2],
      ['2', 3],
      ['3', 4],
      ['5', 5]
    ]
  );
  assert.deepEqual(
    rows.map(r => r.playerId),
    ['1', '2', '3', '4', '5']
  );
  assert.deepEqual(ordered[1]!.record, rows[3]!.record);
});

test('recorded cyclic order cannot replace earlier comparisons or nonconsecutive places', () => {
  const rows = [row('1', 1), row('2', 2), row('3', 3), row('4', 4)];
  assert.throws(() => orderHeadToHeadGroups(rows, [['1', '3', '4']]), /consecutive/);
  assert.throws(() => orderHeadToHeadGroups(rows, [['1', '1', '2']]), /distinct/);
  assert.throws(() => orderHeadToHeadGroups(rows, [['1', '2', '9']]), /distinct/);
  assert.throws(
    () => orderHeadToHeadGroups([{ ...rows[0]!, points: 6 }, ...rows.slice(1)], [['1', '2', '3']]),
    /earlier/
  );
});

test('recorded elimination orders preserve whole equal-win groups and reject earlier comparisons', async () => {
  const { orderEliminationGroups } = await import('../../shared/tournament/standings.ts');
  const pod = {
    category: 'mixed' as const,
    playerIds: ['1', '2', '3', '4'],
    cut: 0,
    playoff3rd4th: true,
    startingTable: 1,
    rounds: [
      {
        number: 1,
        kind: 'elimination' as const,
        status: 'finished' as const,
        timeLeft: 0,
        pairTime: '',
        startTime: '',
        matches: [
          { p1: '1', p2: '2', outcome: 'p1' as const, table: 1, timestamp: '' },
          { p1: '3', p2: '4', outcome: 'p1' as const, table: 2, timestamp: '' }
        ]
      }
    ]
  };
  const rows = [row('1', 1), row('3', 2), row('2', 3), row('4', 4)];
  assert.deepEqual(
    orderEliminationGroups(pod, rows, [['4', '2']]).map(r => [r.playerId, r.place]),
    [
      ['1', 1],
      ['3', 2],
      ['4', 3],
      ['2', 4]
    ]
  );
  assert.throws(() => orderEliminationGroups(pod, rows, [['1', '2']]), /whole equal-win/);
  assert.throws(() => orderEliminationGroups(pod, rows, [['2', '2']]), /distinct/);
  assert.throws(
    () => orderEliminationGroups({ ...pod, playoff3rd4th: false }, rows, [['4', '2']]),
    /third-place setting/
  );
});
