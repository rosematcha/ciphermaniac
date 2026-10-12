import assert from 'node:assert/strict';
import test from 'node:test';

import { regularRounds } from '../../shared/tournament/rounds.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import { fixtureBytes, loadScenarios } from './conformance-fixtures.ts';

// Import models a lossless document read, rather than TOM's reopen action.
// Preserve completed stages and saved clocks when writeTdf receives no `now`.
// Explicit `now` requests clock recomputation; lifecycle reload separately
// models TOM reopening. Plain imports retain the saved stages and standings.
const scenarios = loadScenarios();
for (const scenario of scenarios) {
  test(`TOM lossless round trip: ${scenario.id}`, () => {
    for (const operation of scenario.operations) {
      const bytes = fixtureBytes(scenario, operation);
      assert.deepEqual(
        Buffer.from(writeTdf(parseTdf(bytes.toString('utf8')))),
        bytes,
        `${scenario.id}/${operation.fixture}`
      );
    }
  });
}

test('an imported prestart event gains a subgroup when its opening round is paired', async () => {
  const { applyCommand } = await import('../../shared/tournament/commands.ts');
  const scenario = scenarios.find(s => s.id === 'single-pod')!;
  const tournament = parseTdf(fixtureBytes(scenario, scenario.operations[2]!).toString('utf8'));
  const result = applyCommand(
    tournament,
    { type: 'pairRound', pod: 'masters' },
    {
      now: Date.UTC(2026, 9, 1, 12),
      localTime: '10/01/2026 12:00:00',
      season: 2027,
      random: () => 0.5
    }
  );
  assert.ok(result.ok);
  const imported = parseTdf(writeTdf(result.tournament));
  assert.equal(imported.pods[0]!.flights![0]!.playerIds.length, 12);
});

test('a late entrant in an imported event remains in its exported flight', async () => {
  const { applyCommand } = await import('../../shared/tournament/commands.ts');
  const scenario = scenarios.find(s => s.id === 'single-pod')!;
  const tournament = parseTdf(fixtureBytes(scenario, scenario.operations[3]!).toString('utf8'));
  const result = applyCommand(
    tournament,
    {
      type: 'addPlayer',
      player: {
        id: '2000001',
        firstName: 'Synthetic',
        lastName: 'Late',
        birthDate: '02/27/1995'
      }
    },
    { now: Date.UTC(2026, 9, 1, 12), localTime: '10/01/2026 12:00:00', season: 2027, random: () => 0.5 }
  );
  assert.ok(result.ok);
  const imported = parseTdf(writeTdf(result.tournament));
  assert.ok(imported.pods[0]!.flights![0]!.playerIds.includes('2000001'));
});

test('production start prepares registration imports and keeps pods after configured roster edits', async () => {
  const { applyCommand } = await import('../../shared/tournament/commands.ts');
  const scenario = scenarios.find(s => s.id === 'single-pod')!;
  const ctx = { now: Date.UTC(2026, 9, 1, 12), localTime: '10/01/2026 12:00:00', season: 2027, random: () => 0.5 };
  for (const step of [1, 2]) {
    let t = parseTdf(fixtureBytes(scenario, scenario.operations[step]!).toString('utf8'));
    if (step === 2) {
      const added = applyCommand(
        t,
        {
          type: 'addPlayer',
          player: { id: '2000001', firstName: 'Synthetic', lastName: 'BeforeStart', birthDate: '02/27/1995' }
        },
        ctx
      );
      assert.ok(added.ok);
      t = added.tournament;
      assert.equal(t.pods[0]!.playerIds.length, 13);
    }
    const result = applyCommand(t, { type: 'pairRound', pod: 'masters' }, ctx);
    assert.ok(result.ok, result.ok ? '' : result.error);
    assert.equal(result.tournament.pods[0]!.rounds.length, 1);
    assert.equal(result.tournament.pods[0]!.divisionCounts!.masters, step === 2 ? 13 : 12);
    assert.equal(result.tournament.pods[0]!.startingPlayerIds!.length, step === 2 ? 13 : 12);
  }
});

test('registration imports prepare the correct elimination pod and a Swiss phase that can reach a cut', async () => {
  const { applyCommand } = await import('../../shared/tournament/commands.ts');
  const ctx = {
    now: Date.UTC(2026, 9, 1, 12),
    localTime: '10/01/2026 12:00:00',
    season: 2027,
    random: seededRandom(1)
  };
  const execute = (t: Parameters<typeof applyCommand>[0], command: Parameters<typeof applyCommand>[1]) => {
    const result = applyCommand(t, command, ctx);
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.tournament;
  };
  const imported = (id: string) => {
    const scenario = scenarios.find(s => s.id === id)!;
    return parseTdf(fixtureBytes(scenario, scenario.operations[1]!).toString('utf8'));
  };
  const elimination = execute(imported('elimination-only'), { type: 'pairRound', pod: 'mixed' });
  assert.equal(elimination.pods.length, 1);
  assert.equal(elimination.pods[0]!.category, 'mixed');
  assert.equal(elimination.pods[0]!.stage, 0);
  let cup = execute(imported('league-cup'), { type: 'pairRound', pod: 'masters' });
  assert.equal(cup.pods[0]!.stage, 0);
  for (let round = 1; round <= regularRounds(cup, cup.pods[0]!); round += 1) {
    for (const match of cup.pods[0]!.rounds.at(-1)!.matches.filter(m => m.p2 !== null)) {
      cup = execute(cup, { type: 'reportResult', pod: 'masters', round, ...match, outcome: 'p1' });
    }
    if (round < regularRounds(cup, cup.pods[0]!)) {
      cup = execute(cup, { type: 'pairRound', pod: 'masters' });
    }
  }
  cup = execute(cup, { type: 'startTopCut', pod: 'masters', size: 4 });
  assert.equal(cup.pods[0]!.stage, 1);
  assert.equal(cup.pods[0]!.rounds.at(-1)!.kind, 'elimination');
});

test('configured elimination-only roster edits retain the mixed pod and its options', async () => {
  const { applyCommand } = await import('../../shared/tournament/commands.ts');
  const scenario = scenarios.find(s => s.id === 'elimination-only')!;
  const imported = parseTdf(fixtureBytes(scenario, scenario.operations[2]!).toString('utf8'));
  const ctx = {
    now: Date.UTC(2026, 9, 1, 12),
    localTime: '10/01/2026 12:00:00',
    season: 2027,
    random: seededRandom(2)
  };
  const added = applyCommand(
    imported,
    {
      type: 'addPlayer',
      player: { id: '2000001', firstName: 'Synthetic', lastName: 'BeforeStart', birthDate: '02/27/1995' }
    },
    ctx
  );
  assert.ok(added.ok, added.ok ? '' : added.error);
  assert.equal(added.tournament.pods[0]!.category, 'mixed');
  const started = applyCommand(added.tournament, { type: 'pairRound', pod: 'mixed' }, ctx);
  assert.ok(started.ok, started.ok ? '' : started.error);
  const pod = started.tournament.pods[0]!;
  assert.equal(pod.category, 'mixed');
  assert.equal(pod.startingPlayerIds!.length, imported.players.length + 1);
  assert.equal(pod.playoff3rd4th, imported.pods[0]!.playoff3rd4th);
  assert.equal(pod.startingTable, imported.pods[0]!.startingTable);
});
