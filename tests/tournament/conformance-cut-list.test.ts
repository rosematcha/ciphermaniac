import assert from 'node:assert/strict';
import test from 'node:test';

import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { publicTournament } from '../../shared/tournament/view.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

function cutStarted(seed: number): { t: Tournament; ctx: ReturnType<typeof context> } {
  const ctx = context(seed);
  let t = operated(generatedEvent(10, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (let number = 1; number <= 4; number += 1) {
    t = completed(t, ctx);
    if (number < 4) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  return { t: operated(t, { type: 'topCut' }, ctx), ctx };
}

const withList = (t: Tournament, survivors: string[]): Tournament => ({
  ...t,
  pods: t.pods.map(pod => ({ ...pod, survivors, survivorsUnconfirmed: true }))
});

test('a reading holds the rebuilt cut list unconfirmed, and the flag survives storage', () => {
  const { t, ctx } = cutStarted(101);
  const reopened = operated(t, { type: 'reload' }, ctx);
  assert.equal(reopened.pods[0]!.survivorsUnconfirmed, true);
  assert.deepEqual(readTournament(reopened)!.pods, reopened.pods);
  assert.equal(publicTournament(reopened, {}).pods[0]!.survivorsUnconfirmed, true);
});

test('V24-2: the first check refills an empty unconfirmed list with every seat of the latest round', () => {
  const { t, ctx } = cutStarted(103);
  // The semifinals are pending, so a save does not check and the empty list stays held.
  const held = operated(withList(t, []), { type: 'viewPairings', step: true }, ctx);
  assert.equal(held.pods[0]!.survivorsUnconfirmed, true);
  assert.deepEqual(held.pods[0]!.survivors, []);
  // Without the round count reached a complete round is not checked either.
  const decided = operated(completed(withList(t, []), ctx), { type: 'viewRecords' }, ctx);
  assert.equal(decided.pods[0]!.survivorsUnconfirmed, true);
  // The cut's pairing request checks before pairing, so the refill pairs both semifinal winners.
  const paired = operated(decided, { type: 'pair' }, ctx);
  const seats = latestRound(decided.pods[0]!)!.matches.flatMap(m => [m.p1, m.p2]);
  assert.equal(paired.pods[0]!.survivorsUnconfirmed, undefined);
  assert.deepEqual(paired.pods[0]!.survivors!.slice(0, seats.length), seats);
  assert.equal(latestRound(paired.pods[0]!)!.matches.filter(m => m.p2 !== null).length, 1);
});

test('V24-2: a confirmed list that is not empty is kept as it is', () => {
  const { t, ctx } = cutStarted(107);
  const [first] = latestRound(t.pods[0]!)!.matches;
  const decided = completed(withList(t, [first!.p1]), ctx);
  const checked = operated(decided, { type: 'pair' }, ctx);
  assert.equal(checked.pods[0]!.survivorsUnconfirmed, undefined);
});
