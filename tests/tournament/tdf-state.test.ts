import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { bracketOrder } from '../../shared/tournament/pairing.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { cutPodOf, latestRound, swissAttendance } from '../../shared/tournament/rounds.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { assignKeys, publicTournament } from '../../shared/tournament/view.ts';
import { readTournament } from '../../shared/tournament/validate.ts';

const ctx = { now: Date.UTC(2026, 9, 4), localTime: '10/04/2026 10:00:00', season: 2027, random: seededRandom(42) };
function run(t: Tournament, c: Command): Tournament {
  const result = applyCommand(t, c, ctx);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.tournament;
}
function field(years: string[]): Tournament {
  return years.reduce(
    (t, year, i) =>
      run(t, {
        type: 'addPlayer',
        player: { id: String(100 + i), firstName: 'Sky', lastName: `Lark${i}`, birthDate: `05/10/${year}` }
      }),
    emptyTournament({ name: 'Synthetic Cup', startDate: '10/04/2026' })
  );
}
function complete(t: Tournament): Tournament {
  let result = t;
  for (const pod of t.pods) {
    const round = latestRound(pod)!;
    for (const m of round.matches.filter(m => m.outcome === 'pending')) {
      result = run(result, { type: 'reportResult', pod: pod.category, round: round.number, ...m, outcome: 'p1' });
    }
  }
  return result;
}

test('gap 10: roster shuffled once at start, ties and written order use that permutation', () => {
  const registered = field(Array<string>(8).fill('1990'));
  const started = run(registered, { type: 'pairRound', pod: 'masters' });
  assert.notDeepEqual(
    started.players.map(p => p.id),
    registered.players.map(p => p.id)
  );
  const ties = swissStandings({ ...started.pods[0]!, rounds: [] }, started.players);
  assert.deepEqual(
    ties.map(p => p.playerId),
    started.players.map(p => p.id)
  );
  const next = run(complete(started), { type: 'pairRound', pod: 'masters' });
  assert.deepEqual(next.players, started.players);
  assert.deepEqual(
    parseTdf(writeTdf(next)).players.map(p => p.id),
    started.players.map(p => p.id)
  );
});

test('gaps 12, 13: earned bye first, random bye next, division then points ordering and table numbering', () => {
  let t = field(['1990', '1990', '1990', '1990', '2016', '2016', '2016', '2016']);
  t.players[0]!.byes = 1;
  t = run(t, { type: 'pairRound', pod: 'mixed' });
  const { matches } = t.pods[0]!.rounds[0]!;
  assert.equal(matches[0]!.outcome, 'assigned-bye');
  assert.equal(matches[0]!.p1, '100');
  assert.equal(matches[1]!.outcome, 'bye');
  assert.deepEqual(
    matches.slice(2).map(m => m.table),
    [1, 2, 3]
  );
  const rows = swissStandings(t.pods[0]!, t.players);
  assert.equal(rows.find(r => r.playerId === '100')!.owp, 1);
  assert.ok(writeTdf(t).includes('<byes>1</byes>'));
});

test('gap 13: TOM bracket seat order and player seed/order fields', () => {
  assert.deepEqual(bracketOrder(8), [1, 8, 5, 4, 3, 6, 7, 2]);
  let t = complete(run(field(Array<string>(9).fill('1990')), { type: 'pairRound', pod: 'masters' }));
  t = run(t, { type: 'startTopCut', pod: 'masters', size: 8 });
  const round = latestRound(t.pods[0])!;
  const seated = round.matches.flatMap(m => [m.p1, m.p2!]);
  assert.deepEqual(
    seated.map(id => t.players.find(p => p.id === id)!.order),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  assert.deepEqual(
    seated.map(id => t.players.find(p => p.id === id)!.seed),
    bracketOrder(8)
  );
});

test('gap 12: re-pairing preserves earned byes ahead of new pairings', () => {
  let t = field(Array<string>(8).fill('1990'));
  t.players[0]!.byes = 1;
  t = run(t, { type: 'pairRound', pod: 'masters' });
  for (const keepReported of [false, true]) {
    const repaired = run(t, { type: 'repairRound', pod: 'masters', keepReported });
    const { matches } = latestRound(repaired.pods[0])!;
    assert.equal(matches[0]!.outcome, 'assigned-bye');
    assert.equal(matches[0]!.p1, '100');
    assert.equal(matches.filter(m => m.p1 === '100' || m.p2 === '100').length, 1);
  }
});

test('gap 12: multiple earned byes follow the frozen subgroup roster', () => {
  let t = field(Array<string>(8).fill('1990'));
  const earned = new Set(t.players.slice(0, 4).map(p => p.id));
  for (const player of t.players.filter(p => earned.has(p.id))) {
    player.byes = 1;
  }
  t = run(t, { type: 'pairRound', pod: 'masters' });
  const pod = t.pods[0]!;
  assert.deepEqual(
    latestRound(pod)!
      .matches.filter(m => m.outcome === 'assigned-bye')
      .map(m => m.p1),
    pod.playerIds.filter(id => earned.has(id))
  );
});

test('gap 14: combined cuts share rounds, Masters first, and every division advances together', () => {
  let t = complete(
    run(field(['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990']), { type: 'pairRound', pod: 'mixed' })
  );
  t = run(t, { type: 'startTopCut', pod: 'mixed', division: 'junior', size: 4 });
  t = run(t, { type: 'startTopCut', pod: 'mixed', division: 'masters', size: 4 });
  assert.equal(t.pods.length, 1);
  const pod = t.pods[0]!;
  assert.equal(pod.rounds.length, 2);
  assert.deepEqual(
    pod.rounds[1]!.matches.map(m => Number(m.p1) >= 104),
    [true, true, false, false]
  );
  assert.equal(cutPodOf(t, pod, 'junior')!.rounds.length, 1);
  t = run(complete(t), { type: 'pairRound', pod: 'mixed' });
  assert.equal(latestRound(t.pods[0])!.matches.length, 2);
  t = complete(t);
  assert.equal(readTournament(JSON.parse(JSON.stringify(t)))!.pods.length, 1);
  assert.equal(parseTdf(writeTdf(t, { finalized: true })).pods.length, 1);
});

test('gap 14: legacy cutOf storage still reads and exports one TOM pod', () => {
  const t = field(['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990']);
  const swiss = complete(run(t, { type: 'pairRound', pod: 'mixed' })).pods[0]!;
  const old: Pod = {
    category: 'junior',
    cutOf: 'mixed',
    cut: 4,
    playerIds: ['100', '101', '102', '103'],
    startingTable: 1,
    playoff3rd4th: false,
    rounds: [
      {
        number: 2,
        kind: 'elimination',
        status: 'paired',
        timeLeft: 4500,
        pairTime: ctx.localTime,
        startTime: '',
        matches: [
          { p1: '100', p2: '103', table: 1, outcome: 'pending', timestamp: ctx.localTime },
          { p1: '102', p2: '101', table: 2, outcome: 'pending', timestamp: ctx.localTime }
        ]
      }
    ]
  };
  const checked = readTournament({ ...t, pods: [swiss, old] });
  assert.ok(checked);
  assert.equal(checked.pods.length, 1);
  assert.equal(parseTdf(writeTdf(checked)).pods.length, 1);
});

test('TOM percentages use HALF_EVEN at four significant figures before ties are broken', () => {
  const t = field(['1990', '1990']);
  const pod = t.pods[0]!;
  pod.rounds = Array.from({ length: 32 }, (_, i) => ({
    number: i + 1,
    kind: 'swiss',
    status: 'finished',
    timeLeft: 0,
    pairTime: '',
    startTime: '',
    matches: [{ table: 1, p1: '100', p2: '101', outcome: i < 13 ? 'p2' : 'p1', timestamp: '' }]
  }));
  const rows = swissStandings(pod, t.players);
  assert.equal(rows.find(r => r.playerId === '100')!.owp, 0.4062);
  assert.equal(rows.find(r => r.playerId === '101')!.owp, 0.5938);
});

test('combined pods plan Swiss from the largest frozen division', () => {
  const t = run(
    field([...Array<string>(5).fill('2016'), ...Array<string>(5).fill('2012'), ...Array<string>(8).fill('1990')]),
    { type: 'pairRound', pod: 'junior-senior' }
  );
  assert.equal(swissAttendance(t.pods[0]!), 5);
  const late = run(t, {
    type: 'addPlayer',
    player: { id: '999', firstName: 'Lee', lastName: 'Spruce', birthDate: '02/27/2016' }
  });
  assert.equal(swissAttendance(late.pods[0]!), 5);
});

test('public combined cuts retain division membership with only public IDs', () => {
  let t = complete(
    run(field(['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990']), { type: 'pairRound', pod: 'mixed' })
  );
  t = run(t, { type: 'startTopCut', pod: 'mixed', division: 'junior', size: 4 });
  const keys = assignKeys(t, {});
  const publicCopy = publicTournament(t, keys);
  assert.deepEqual(
    publicCopy.pods[0]!.divisionCuts!.junior!.playerIds,
    t.pods[0]!.divisionCuts!.junior!.playerIds!.map(id => keys[id])
  );
  assert.ok(!JSON.stringify(publicCopy).includes('"100"'));
  assert.equal(cutPodOf(publicCopy, publicCopy.pods[0]!, 'junior')!.rounds[0]!.matches.length, 2);
});
