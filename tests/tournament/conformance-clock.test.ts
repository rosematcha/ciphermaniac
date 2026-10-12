import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { writeTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const ctx = context(59);
// The sample is taken on a later day, as TOM's own wall clock would record it.
const at = { ...ctx, now: Date.UTC(2026, 9, 9, 11, 15, 33), localTime: '10/09/2026 11:15:33' };
const clockOf = (t: Tournament) => {
  const xml = writeTdf(t, { now: at.now });
  const rounds = [...xml.matchAll(/<timeleft>(\d+)<\/timeleft>\s*<pairtime>[^<]*<\/pairtime>\s*<starttime>([^<]*)/g)];
  const round = rounds.at(-1)!;
  return { timeLeft: Number(round[1]), startTime: round[2] };
};
const running = (type: 1 | 2 = 2) =>
  operated(operated(generatedEvent(12, ctx, { type }), { type: 'start' }, ctx), { type: 'startRound' }, ctx);
const sample = (t: Tournament, seconds: number) => operated(t, { type: 'sampleClock', seconds }, at);

test('rule 59: a clock sample moves the round start so the saved clock reflects the elapsed seconds', () => {
  const t = running();
  const sampled = sample(t, 125);
  assert.deepEqual(clockOf(sampled), { timeLeft: 1675, startTime: '10/09/2026 11:13:28' });
  assert.deepEqual(
    latestRound(sampled.pods[0]!)!.matches,
    latestRound(t.pods[0]!)!.matches,
    'pairings and results are untouched'
  );
  assert.equal(latestRound(sampled.pods[0]!)!.stage, 4);
  assert.equal(clockOf(sample(t, 1900)).timeLeft, 0, 'an expired round saves zero while matches are pending');
});

test('rule 59: repeated starts and reopenings keep the sampled origin', () => {
  const sampled = sample(running(), 125);
  assert.deepEqual(clockOf(operated(sampled, { type: 'startRound' }, ctx)), clockOf(sampled));
  const done = sample(completed(running(), ctx), 125);
  const reopened = operated(done, { type: 'reopen', table: 1 }, ctx);
  assert.equal(latestRound(reopened.pods[0]!)!.stage, 4);
  assert.deepEqual(clockOf(reopened), clockOf(done));
});

test('rule 59: elimination-only rounds use the regular duration; cuts after Swiss use the finals duration', () => {
  assert.equal(clockOf(sample(running(1), 125)).timeLeft, 1675);
  let t = operated(generatedEvent(12, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  while (latestRound(t.pods[0]!)!.kind === 'swiss') {
    t = completed(t, ctx);
    const swissDone = latestRound(t.pods[0]!)!.number === 4;
    t = operated(t, { type: swissDone ? 'viewStandings' : 'viewRecords' }, ctx);
    t = operated(t, { type: swissDone ? 'topCut' : 'pair' }, ctx);
  }
  t = operated(t, { type: 'startRound' }, ctx);
  assert.equal(clockOf(sample(t, 125)).timeLeft, 4375);
});

test('rule 59: sampling refuses a round that has not started or a negative sample', () => {
  const paired = operated(generatedEvent(12, ctx), { type: 'start' }, ctx);
  assert.equal(applyLifecycleOperation(paired, { type: 'sampleClock', seconds: 125 }, at).ok, false);
  assert.equal(applyLifecycleOperation(running(), { type: 'sampleClock', seconds: -1 }, at).ok, false);
});

test('saved clock edits and repeated starts after reload preserve the sampled origin', () => {
  const sampled = sample(running(), 125);
  for (const seconds of [undefined, 0, 2400]) {
    const reopened = operated(sampled, { type: 'reload', seconds }, at);
    const restarted = operated(reopened, { type: 'startRound' }, at);
    assert.deepEqual(clockOf(reopened), clockOf(sampled));
    assert.deepEqual(clockOf(restarted), clockOf(sampled));
    assert.deepEqual(latestRound(restarted.pods[0]!)!.matches, latestRound(sampled.pods[0]!)!.matches);
  }
  const expired = sample(running(), 1900);
  assert.equal(clockOf(operated(expired, { type: 'reload' }, at)).timeLeft, 0);
});
