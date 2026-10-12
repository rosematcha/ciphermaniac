import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const ctx = context(17);
const stages = (t: Tournament) => t.pods[0]!.rounds.map(r => r.stage);

function lastSwiss(acknowledge: 'viewRecords' | 'viewStandings'): Tournament {
  let t = operated(generatedEvent(12, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (;;) {
    t = completed(t, ctx);
    if (latestRound(t.pods[0]!)!.number === 4) {
      return operated(t, { type: acknowledge }, ctx);
    }
    t = operated(t, { type: 'viewRecords' }, ctx);
    t = operated(t, { type: 'pair' }, ctx);
  }
}

test('SPEC 3.6: the recorded report acknowledgment, not the round position, sets the stage', () => {
  assert.deepEqual(stages(lastSwiss('viewRecords')), [6, 6, 6, 6]);
  assert.deepEqual(stages(lastSwiss('viewStandings')), [6, 6, 6, 8]);
});

test('SPEC 3.6: starting the cut and finishing preserve the last Swiss acknowledgment', () => {
  let t = operated(lastSwiss('viewRecords'), { type: 'topCut' }, ctx);
  assert.deepEqual(stages(t), [6, 6, 6, 6, 2]);
  for (const _round of [1, 2]) {
    t = operated(completed(t, ctx), { type: 'viewRecords' }, ctx);
    t = latestRound(t.pods[0]!)!.number === 6 ? t : operated(t, { type: 'pair' }, ctx);
  }
  t = operated(t, { type: 'finish' }, ctx);
  assert.deepEqual(stages(t), [6, 6, 6, 6, 6, 6]);
});

test('SPEC 3.6: a reopened last Swiss round returns to 5, then standings writes 8 and the cut still starts', () => {
  const reopened = operated(lastSwiss('viewRecords'), { type: 'reload' }, ctx);
  assert.deepEqual(stages(reopened), [4, 4, 4, 5]);
  const cut = operated(operated(reopened, { type: 'viewStandings' }, ctx), { type: 'topCut' }, ctx);
  assert.deepEqual(stages(cut), [4, 4, 4, 8, 2]);
  assert.equal(latestRound(cut.pods[0]!)!.matches.length, 2);
});

test('V14b: repairing a completed even round after either acknowledgment succeeds without change', () => {
  for (const acknowledge of ['viewRecords', 'viewStandings'] as const) {
    const t = operated(
      completed(operated(generatedEvent(16, ctx, { type: 2 }), { type: 'start' }, ctx), ctx),
      { type: acknowledge },
      ctx
    );
    const result = applyLifecycleOperation(t, { type: 'pair', repair: true }, ctx);
    assert.ok(result.ok, result.error ?? 'Acknowledged completed repair should succeed');
    assert.deepEqual(result.tournament.pods, t.pods);
  }
  const unacknowledged = completed(operated(generatedEvent(16, ctx, { type: 2 }), { type: 'start' }, ctx), ctx);
  assert.equal(applyLifecycleOperation(unacknowledged, { type: 'pair', repair: true }, ctx).ok, false);
});

test('SPEC 3.6 and V16-2: an explicit acknowledgment keeps pending seats and cannot finish the pod', () => {
  const t = operated(generatedEvent(12, ctx, { type: 2 }), { type: 'start' }, ctx);
  for (const type of ['viewRecords', 'viewStandings'] as const) {
    const viewed = operated(t, { type }, ctx);
    assert.equal(latestRound(viewed.pods[0]!)!.stage, type === 'viewRecords' ? 6 : 8);
    assert.deepEqual(latestRound(viewed.pods[0]!)!.matches, latestRound(t.pods[0]!)!.matches);
    assert.equal(applyLifecycleOperation(viewed, { type: 'finish' }, ctx).ok, false);
  }
});

test('V16-3: an ordinary unstarted repair keeps an odd round’s bye and seats for every random draw', () => {
  const t = operated(
    operated(generatedEvent(13, ctx, { type: 2 }), { type: 'start' }, ctx),
    { type: 'viewPairings' },
    ctx
  );
  const before = latestRound(t.pods[0]!)!;
  for (const seed of [1, 2, 3, 4, 5]) {
    const repaired = operated(t, { type: 'pair', repair: true }, context(seed));
    assert.equal(latestRound(repaired.pods[0]!)!.stage, 2);
    assert.deepEqual(latestRound(repaired.pods[0]!)!.matches, before.matches);
  }
});
