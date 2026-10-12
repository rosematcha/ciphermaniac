import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { publicTournament } from '../../shared/tournament/view.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

test('V19-5: a partial repair keeps untabled matches and hides omitted players until reopening', () => {
  const ctx = context(211);
  const configured = generatedEvent(6, ctx, { type: 2 });
  const started = operated(
    { ...configured, settings: { ...configured.settings!, autoTables: false } },
    { type: 'start' },
    ctx
  );
  const pod = started.pods[0]!;
  const original = latestRound(pod)!;
  const retained = original.matches[0]!;
  const partial = original.matches.slice(0, 2).map((m, i) => ({ ...m, table: i === 0 ? m.table : 0 }));
  const recorded = {
    retainedTables: [retained.table],
    retainedPairings: [retained],
    partialRepair: { [pod.category]: partial }
  };
  const repaired = operated(started, { type: 'pair', repair: true }, { ...ctx, recorded });
  assert.deepEqual(latestRound(repaired.pods[0]!)!.matches, partial);
  assert.equal(repaired.pods[0]!.repairOmittedPlayers!.length, 2);
  assert.deepEqual(readTournament(repaired), repaired);
  const keys = Object.fromEntries(repaired.players.map(p => [p.id, `public-${p.id}`]));
  assert.deepEqual(
    publicTournament(repaired, keys).pods[0]!.repairOmittedPlayers,
    repaired.pods[0]!.repairOmittedPlayers!.map(id => keys[id])
  );
  const again = operated(repaired, { type: 'pair', repair: true }, ctx);
  assert.deepEqual(latestRound(again.pods[0]!)!.matches, partial);
  const reopened = operated(again, { type: 'reload' }, ctx);
  assert.equal(reopened.pods[0]!.repairOmittedPlayers, undefined);
  const placed = operated(reopened, { type: 'pair', repair: true }, ctx);
  assert.equal(latestRound(placed.pods[0]!)!.matches.length, 3);
});

test('V19-5: a partial repair cannot change a retained result or assign a new table', () => {
  const ctx = context(213);
  const configured = generatedEvent(6, ctx, { type: 2 });
  const started = operated(
    { ...configured, settings: { ...configured.settings!, autoTables: false } },
    { type: 'start' },
    ctx
  );
  const pod = started.pods[0]!;
  const retained = latestRound(pod)!.matches[0]!;
  for (const change of [
    { ...retained, outcome: 'p1' as const },
    { ...retained, table: retained.table + 1 }
  ]) {
    const result = applyLifecycleOperation(
      started,
      { type: 'pair', repair: true },
      {
        ...ctx,
        recorded: {
          retainedTables: [retained.table],
          retainedPairings: [retained],
          partialRepair: { [pod.category]: [change] }
        }
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.tournament, started);
  }
});
