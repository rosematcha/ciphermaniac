import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlayerConnectionsGraph,
  type BuildPlayerConnectionsGraphOptions,
  computeGraphInterestingStats,
  findConnectionPath,
  findFurthestConnectionFrom,
  sanitizeParticipantName
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

test('findConnectionPath can return an alternate shortest route when neighbor order is randomized', async () => {
  const tournament = '2026-01-01, Randomized BFS Test';

  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '301' },
      participants: [
        participant(1, 'Alice', '1'),
        participant(2, 'Bob', '2'),
        participant(3, 'Cara', '3'),
        participant(4, 'Dan', '4')
      ],
      matches: [match('ab', 1, 2, 1), match('ac', 1, 3, 1), match('bd', 2, 4, 2), match('cd', 3, 4, 3)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const randomized = findConnectionPath(graph, 'pid:1', 'pid:4', {
    randomizeNeighbors: true,
    rng: () => 0
  });

  assert.equal(randomized.status, 'connected');
  assert.equal(randomized.degree, 2);
  assert.deepEqual(
    randomized.identities.map(identity => identity.key),
    ['pid:1', 'pid:3', 'pid:4']
  );
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

test('sanitizeParticipantName removes known standings artifacts', () => {
  assert.equal(sanitizeParticipantName('>10 TABLE Noah schuler'), 'Noah schuler');
  assert.equal(sanitizeParticipantName('>ST6>Amy Wosley'), 'Amy Wosley');
  assert.equal(sanitizeParticipantName('153 TABLE noah schuler'), 'noah schuler');
});

test('name fallback identities use sanitized participant names', async () => {
  const tournament = '2026-01-01, Name Repair Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '905' },
      participants: [
        participant(1, '>10 TABLE Noah schuler', null),
        participant(2, 'Noah schuler', null),
        participant(3, 'Taylor', null)
      ],
      matches: [match('n1', 1, 3, 1), match('n2', 2, 3, 2)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);

  assert.ok(graph.identities.has('name:noah schuler'));
  assert.equal(graph.identities.size, 2);
  assert.equal(graph.identities.get('name:noah schuler')?.name, 'Noah schuler');
});

test('graph build stats include connected component coverage', async () => {
  const tournament = '2026-01-01, Component Stats Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '906' },
      participants: [participant(1, 'Alpha', '1'), participant(2, 'Beta', '2'), participant(3, 'Gamma', '3')],
      matches: [match('ab', 1, 2, 1)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);

  assert.equal(graph.stats.connectedComponents, 2);
  assert.equal(graph.stats.largestComponentSize, 2);
  assert.equal(graph.stats.largestComponentShare, 2 / 3);
});

test('computeGraphInterestingStats returns meaningful graph-level stats', async () => {
  const tournament = '2026-01-01, Interesting Stats Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: '907' },
      participants: [participant(1, 'A', '1'), participant(2, 'B', '2'), participant(3, 'C', '3')],
      matches: [match('ab', 1, 2, 1), match('bc', 2, 3, 2)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const insights = computeGraphInterestingStats(graph);

  assert.equal(insights.mostConnectedKey, 'pid:2');
  assert.equal(insights.mostConnectedDegree, 2);
  assert.equal(insights.averageOpponents, (graph.stats.edgesAdded * 2) / graph.stats.identities);
  assert.equal(insights.longestRouteEstimate, 2);
  assert.equal(insights.mostActivePlayerKey, 'pid:2');
  assert.equal(insights.mostActivePlayerMatches, 2);
  assert.equal(insights.mostFrequentPairing?.leftKey, 'pid:1');
  assert.equal(insights.mostFrequentPairing?.rightKey, 'pid:2');
  assert.equal(insights.mostFrequentPairing?.matches, 1);
});

test('player ID and name synonym bridges merge known aliases', async () => {
  const atlanta = '2025-04-11, Regional Championship Atlanta';
  const seattle = '2026-02-27, Regional Championship Seattle';

  const options = makeOptions([atlanta, seattle], {
    [atlanta]: {
      index: { tournamentId: 'atl' },
      participants: [
        participant(1, 'Prin Basser', '21'),
        participant(2, 'Drew Cate', '6208'),
        participant(3, 'Annie Haberstroh', '474')
      ],
      matches: [match('pd', 1, 2, 2), match('ad', 3, 2, 2)]
    },
    [seattle]: {
      index: { tournamentId: 'sea' },
      participants: [participant(11, 'Princess Basser', '20186'), participant(12, 'Drew Cate', '6208')],
      matches: [match('pd2', 11, 12, 12)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);

  assert.ok(graph.identities.has('pid:20186'));
  assert.ok(!graph.identities.has('pid:21'));

  const path = findConnectionPath(graph, 'pid:474', 'pid:20186');
  assert.equal(path.status, 'connected');
  assert.equal(path.degree, 2);
});

test('name synonym canonicalizes Reese Ferguson to Reese Lundquist', async () => {
  const tournament = '2026-03-01, Name Canonical Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'canon-1' },
      participants: [participant(1, 'Reese Ferguson', '17712')]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  assert.equal(graph.identities.get('pid:17712')?.name, 'Reese Lundquist');
});

test('name synonym canonicalizes Nick Alvarez to Alex Alvarez', async () => {
  const tournament = '2026-03-01, Alex Nick Canonical Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'canon-2' },
      participants: [participant(1, 'Nick Alvarez', '9038')]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  assert.equal(graph.identities.get('pid:9038')?.name, 'Alex Alvarez');
});

test('findFurthestConnectionFrom returns farthest reachable player with shortest path', async () => {
  const tournament = '2026-03-02, Furthest Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'furthest-1' },
      participants: [
        participant(1, 'Annie Haberstroh', '474'),
        participant(2, 'Drew Cate', '6208'),
        participant(3, 'Princess Basser', '20186'),
        participant(4, 'Far Player', '9999'),
        participant(5, 'Near Player', '8888')
      ],
      matches: [match('ab', 1, 2, 2), match('bc', 2, 3, 2), match('cf', 3, 4, 3), match('an', 1, 5, 1)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const result = findFurthestConnectionFrom(graph, 'pid:474');

  assert.equal(result.status, 'connected');
  assert.equal(result.degree, 3);
  assert.equal(result.identities[0]?.key, 'pid:474');
  assert.equal(result.identities[result.identities.length - 1]?.key, 'pid:9999');
  assert.deepEqual(
    result.identities.map(identity => identity.key),
    ['pid:474', 'pid:6208', 'pid:20186', 'pid:9999']
  );
  assert.equal(result.reachableCount, 5);
});

test('findFurthestConnectionFrom returns same for isolated player', async () => {
  const tournament = '2026-03-03, Furthest Isolated Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'furthest-2' },
      participants: [participant(1, 'Solo', '777')]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const result = findFurthestConnectionFrom(graph, 'pid:777');

  assert.equal(result.status, 'same');
  assert.equal(result.degree, 0);
  assert.deepEqual(
    result.identities.map(identity => identity.key),
    ['pid:777']
  );
  assert.equal(result.reachableCount, 1);
});

test('findFurthestConnectionFrom returns not_found for unknown player', async () => {
  const tournament = '2026-03-04, Furthest Missing Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'furthest-3' },
      participants: [participant(1, 'Known', '100')]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const result = findFurthestConnectionFrom(graph, 'pid:404');

  assert.equal(result.status, 'not_found');
  assert.equal(result.degree, null);
  assert.equal(result.reachableCount, 0);
});

test('findFurthestConnectionFrom can randomize ties between equally far players', async () => {
  const tournament = '2026-03-05, Furthest Tie Test';
  const options = makeOptions([tournament], {
    [tournament]: {
      index: { tournamentId: 'furthest-4' },
      participants: [
        participant(1, 'Source', '1'),
        participant(2, 'Left 1', '2'),
        participant(3, 'Left 2', '3'),
        participant(4, 'Right 1', '4'),
        participant(5, 'Right 2', '5')
      ],
      matches: [match('a-b', 1, 2, 1), match('b-c', 2, 3, 2), match('a-d', 1, 4, 1), match('d-e', 4, 5, 4)]
    }
  });

  const graph = await buildPlayerConnectionsGraph(options);
  const randomized = findFurthestConnectionFrom(graph, 'pid:1', {
    randomizeFarthestTie: true,
    rng: () => 0.99
  });

  assert.equal(randomized.status, 'connected');
  assert.equal(randomized.degree, 2);
  assert.equal(randomized.identities[randomized.identities.length - 1]?.key, 'pid:5');
});
