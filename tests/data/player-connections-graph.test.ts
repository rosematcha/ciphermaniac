import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlayerConnectionsGraph,
  type BuildPlayerConnectionsGraphOptions,
  findConnectionPath
} from '../../src/tools/playerConnectionsGraph.ts';
import type { CanonicalMatchRecord, TournamentParticipant } from '../../src/types/index.ts';

interface TournamentMockData {
  index?: { tournamentId?: string | number | null; labsCode?: string | number | null } | null;
  participants?: TournamentParticipant[];
  matches?: CanonicalMatchRecord[];
}

function makeOptions(
  tournaments: string[],
  fixtures: Record<string, TournamentMockData>,
  trackers?: {
    participantCalls?: string[];
    matchCalls?: string[];
  }
): BuildPlayerConnectionsGraphOptions {
  return {
    tournaments,
    fetchTournamentIndex: async tournament => fixtures[tournament]?.index || null,
    fetchParticipants: async tournament => {
      trackers?.participantCalls?.push(tournament);
      return fixtures[tournament]?.participants || [];
    },
    fetchMatches: async tournament => {
      trackers?.matchCalls?.push(tournament);
      return fixtures[tournament]?.matches || [];
    },
    concurrency: 1
  };
}

function participant(tpId: number, name: string, playerId: string | null): TournamentParticipant {
  return {
    tpId,
    name,
    playerId
  };
}

function match(
  id: string,
  player1Id: number | null,
  player2Id: number | null,
  winnerCode: number | null,
  round = 1
): CanonicalMatchRecord {
  return {
    id,
    key: id,
    round,
    player1Id,
    player2Id,
    winnerCode,
    winner: winnerCode,
    player1Result: winnerCode === player1Id ? 'win' : winnerCode === player2Id ? 'loss' : 'tie',
    player2Result: winnerCode === player2Id ? 'win' : winnerCode === player1Id ? 'loss' : 'tie',
    outcomeType: winnerCode === 0 ? 'tie' : 'decided'
  };
}

test('graph identity resolution uses playerId first and name fallback second', async () => {
  const tournament = '2026-01-01, Test Regional';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '1001' },
      participants: [participant(1, 'Chris Doe', '42'), participant(2, 'Chris Doe', null)],
      matches: [match('m1', 1, 2, 1)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);

  assert.ok(graph.identities.has('pid:42'));
  assert.ok(graph.identities.has('name:chris doe'));
  assert.equal(graph.identities.size, 2);

  const path = findConnectionPath(graph, 'pid:42', 'name:chris doe');
  assert.equal(path.status, 'connected');
  assert.equal(path.degree, 1);
});

test('graph dedupes tournament aliases by tournamentId and prefers dated folder name', async () => {
  const undated = 'Regional Championship Seattle';
  const dated = '2026-02-27, Regional Championship Seattle';
  const participantCalls: string[] = [];
  const matchCalls: string[] = [];

  const options = makeOptions(
    [undated, dated],
    {
      [undated]: {
        index: { tournamentId: '500' },
        participants: [participant(1, 'Alice', '1')],
        matches: []
      },
      [dated]: {
        index: { tournamentId: '500' },
        participants: [participant(1, 'Alice', '1')],
        matches: []
      }
    },
    { participantCalls, matchCalls }
  );

  const graph = await buildPlayerConnectionsGraph(options);

  assert.deepEqual(graph.tournaments, [dated]);
  assert.deepEqual(participantCalls, [dated]);
  assert.deepEqual(matchCalls, [dated]);
});

test('findConnectionPath returns shortest BFS path when multiple paths exist', async () => {
  const tournament = '2026-01-01, Graph Test';

  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '300' },
      participants: [
        participant(1, 'Alice', '1'),
        participant(2, 'Bob', '2'),
        participant(3, 'Cara', '3'),
        participant(4, 'Dan', '4')
      ],
      matches: [match('ab', 1, 2, 1), match('bd', 2, 4, 2), match('ac', 1, 3, 1), match('cd', 3, 4, 3)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const path = findConnectionPath(graph, 'pid:1', 'pid:4');

  assert.equal(path.status, 'connected');
  assert.equal(path.degree, 2);
  assert.equal(path.hops.length, 2);
  assert.equal(path.identities[0]?.key, 'pid:1');
  assert.equal(path.identities[path.identities.length - 1]?.key, 'pid:4');
});

test('findConnectionPath returns degree 0 for same player identity', async () => {
  const tournament = '2026-01-01, Same Player Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '901' },
      participants: [participant(1, 'Solo', '99')],
      matches: []
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const path = findConnectionPath(graph, 'pid:99', 'pid:99');

  assert.equal(path.status, 'same');
  assert.equal(path.degree, 0);
});

test('findConnectionPath returns disconnected when no path exists', async () => {
  const tournament = '2026-01-01, No Path Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '902' },
      participants: [participant(1, 'Alpha', '101'), participant(2, 'Beta', '102'), participant(3, 'Gamma', '103')],
      matches: [match('ab', 1, 2, 1)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const path = findConnectionPath(graph, 'pid:101', 'pid:103');

  assert.equal(path.status, 'disconnected');
  assert.equal(path.degree, null);
});

test('byes and unpaired rows (missing player2Id) do not create edges', async () => {
  const tournament = '2026-01-01, Bye Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '903' },
      participants: [participant(1, 'Alpha', '201'), participant(2, 'Beta', '202')],
      matches: [
        {
          id: 'bye',
          key: 'bye',
          round: 1,
          player1Id: 1,
          player2Id: null,
          winnerCode: 1,
          winner: 1,
          outcomeType: 'bye',
          player1Result: 'bye',
          player2Result: null
        }
      ]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);

  assert.equal(graph.stats.edgesAdded, 0);
  const path = findConnectionPath(graph, 'pid:201', 'pid:202');
  assert.equal(path.status, 'disconnected');
});
