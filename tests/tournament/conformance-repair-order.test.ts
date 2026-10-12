import assert from 'node:assert/strict';
import test from 'node:test';

import { repairedEliminationGroups, swissStandings } from '../../shared/tournament/standings.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { publicTournament } from '../../shared/tournament/view.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

test('V25-2 repair choices preserve IDs in application state and end when a new opponent is seated or read', () => {
  const ctx = context(251);
  let t = operated(generatedEvent(8, ctx, { type: 1, additionalRounds: 0, thirdPlace: true }), { type: 'start' }, ctx);
  t = completed(t, ctx);
  const pod = t.pods[0]!;
  const match = pod.rounds[0]!.matches[0]!;
  const id = match.outcome === 'p1' ? match.p2! : match.p1;
  const marked = {
    ...pod,
    dissolvedOpponents: [{ playerId: id, opponentId: match.p1 === id ? match.p2! : match.p1, round: 2 }]
  };
  t = { ...t, pods: [marked] };
  const rows = swissStandings(marked, t.players);
  assert.ok(repairedEliminationGroups(marked, rows).some(group => group.includes(id)));
  assert.deepEqual(readTournament(t), t);
  assert.deepEqual(publicTournament(t, { [id]: 'public-id' }).pods[0]!.dissolvedOpponents, [
    { playerId: 'public-id', opponentId: match.p1 === id ? match.p2! : match.p1, round: 2 }
  ]);
  assert.deepEqual(repairedEliminationGroups({ ...marked, playoff3rd4th: false }, rows), []);
  const seated = { ...marked, rounds: [...marked.rounds, { ...marked.rounds[0]!, number: 2 }] };
  assert.deepEqual(repairedEliminationGroups(seated, swissStandings(seated, t.players)), []);
  const reopened = operated(t, { type: 'reload' }, ctx);
  assert.equal(reopened.pods[0]!.dissolvedOpponents, undefined);
  assert.deepEqual(repairedEliminationGroups(reopened.pods[0]!, rows), []);
});
