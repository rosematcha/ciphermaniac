import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Match, Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

function running(): { tournament: Tournament; ctx: ReturnType<typeof context> } {
  const ctx = context(17);
  const tournament = completed(operated(generatedEvent(8, ctx), { type: 'start' }, ctx), ctx);
  return { tournament, ctx };
}

test('reopening stages 5–8 changes only the selected result, preserves the original clock and removes its points', () => {
  for (const stage of [5, 6, 7, 8]) {
    const { tournament, ctx } = running();
    const pod = tournament.pods[0]!;
    const prior = { ...latestRound(pod)!, stage };
    const t = { ...tournament, pods: [{ ...pod, rounds: [prior] }] };
    const at = { ...ctx, now: ctx.now + 65_999, localTime: '10/01/2026 12:01:05' };
    const reopened = operated(t, { type: 'reopen', table: prior.matches[0]!.table }, at);
    const round = latestRound(reopened.pods[0]!)!;
    assert.deepEqual(round, {
      ...prior,
      stage: 4,
      status: 'started',
      timeLeft: 1735,
      clockStartedAt: null,
      matches: prior.matches.map((m, index) =>
        index === 0 ? { ...m, outcome: 'pending', timestamp: at.localTime } : m
      )
    });
    assert.deepEqual(reopened.players, t.players);
    assert.deepEqual(reopened.settings, t.settings);
    const before = swissStandings(pod, t.players).reduce((total, r) => total + r.points, 0);
    const after = swissStandings(reopened.pods[0]!, t.players).reduce((total, r) => total + r.points, 0);
    assert.equal(before - after, 3);
    const saved = writeTdf(reopened, { now: at.now + 5000 });
    assert.match(saved, /<timeleft>1730<\/timeleft>/);
    const restored = operated(reopened, { type: 'results', results: [{ ...round.matches[0]!, outcome: 'p1' }] }, at);
    assert.equal(latestRound(restored.pods[0]!)!.stage, 5);
  }
});

test('expired clocks remain expired, and reopening a finalized event suppresses standings until results are complete', () => {
  const { tournament, ctx } = running();
  const finalized = { ...tournament, settings: { ...tournament.settings!, stage: 5 as const } };
  const at = { ...ctx, now: ctx.now + 2_000_000 };
  const reopened = operated(finalized, { type: 'reopen', player: latestRound(finalized.pods[0]!)!.matches[0]!.p1 }, at);
  assert.equal(reopened.settings!.stage, 5);
  assert.equal(latestRound(reopened.pods[0]!)!.timeLeft, 0);
  const xml = writeTdf(reopened, { now: at.now });
  assert.match(xml, /stage="5"/);
  assert.ok(!xml.includes('<standings>'));
  assert.equal(writeTdf(parseTdf(xml)), xml, 'lossless import does not apply reopening again');
});

test('reopening refusals retain the complete input state', () => {
  const { tournament, ctx } = running();
  const pod = tournament.pods[0]!;
  const round = latestRound(pod)!;
  const match = round.matches[0]!;
  const withMatch = (changed: Match) => ({
    ...tournament,
    pods: [{ ...pod, rounds: [{ ...round, matches: [changed, ...round.matches.slice(1)] }] }]
  });
  const cases = [
    // An unstarted round, such as one whose decided match a departure awarded before the start.
    { ...tournament, pods: [{ ...pod, rounds: [{ ...round, stage: 3, startTime: '', startedAt: undefined }] }] },
    withMatch({ ...match, outcome: 'pending' }),
    withMatch({ ...match, p2: null, outcome: 'bye' }),
    withMatch({ ...match, p2: null, outcome: 'loss' }),
    {
      ...withMatch({ ...match, outcome: 'deleted' }),
      players: tournament.players.map(p => ([match.p1, match.p2].includes(p.id) ? { ...p, droppedAfter: 1 } : p))
    }
  ];
  for (const t of cases) {
    const before = structuredClone(t);
    const result = applyLifecycleOperation(t, { type: 'reopen', table: match.table }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(result.tournament, t);
    assert.deepEqual(t, before);
  }
  const nextPaired = operated(tournament, { type: 'pair' }, ctx);
  const refused = applyLifecycleOperation(nextPaired, { type: 'reopen', round: 1, table: match.table }, ctx);
  assert.equal(refused.ok, false);
  assert.equal(refused.tournament, nextPaired);
});

test('main-window results refuse a paused reopened round; slip entry and continuing remain available', () => {
  const { tournament, ctx } = running();
  const match = latestRound(tournament.pods[0]!)!.matches[0]!;
  const at = { ...ctx, now: ctx.now + 120_000 };
  const reopened = operated(tournament, { type: 'reopen', table: match.table }, at);
  const results = [{ ...match, outcome: 'p1' as const }];
  const refused = applyLifecycleOperation(reopened, { type: 'results', results, entryMode: 'main' }, at);
  assert.equal(refused.ok, false);
  assert.match(refused.error!, /paused/);
  assert.equal(refused.tournament, reopened);
  const slips = operated(reopened, { type: 'results', results, entryMode: 'slip' }, at);
  assert.equal(latestRound(slips.pods[0]!)!.stage, 5);
  const continued = operated(reopened, { type: 'startRound' }, { ...at, now: at.now + 60_000 });
  const round = latestRound(continued.pods[0]!)!;
  assert.equal(round.startedAt, ctx.now);
  assert.equal(round.startTime, ctx.localTime);
  assert.equal(round.clockStartedAt, at.now + 60_000);
  const saved = writeTdf(continued, { now: at.now + 60_000 });
  assert.match(saved, /<timeleft>1620<\/timeleft>/);
  assert.equal(
    latestRound(operated(continued, { type: 'results', results, entryMode: 'main' }, at).pods[0]!)!.stage,
    5
  );
});

test('reopening resolves one pod and refuses ambiguous shared table numbers', () => {
  const ctx = context(31);
  const t = completed(operated(generatedEvent(18, ctx, { mixed: true }), { type: 'start' }, ctx), ctx);
  assert.equal(t.pods.length, 3);
  const selected = t.pods[1]!;
  const match = latestRound(selected)!.matches[0]!;
  const reopened = operated(t, { type: 'reopen', player: match.p1 }, ctx);
  assert.equal(latestRound(reopened.pods[1]!)!.matches[0]!.outcome, 'pending');
  assert.equal(reopened.pods[0], t.pods[0]);
  assert.equal(reopened.pods[2], t.pods[2]);
  const shared = {
    ...t,
    pods: t.pods.map(p => ({
      ...p,
      rounds: p.rounds.map(r => ({ ...r, matches: r.matches.map((m, i) => (i === 0 ? { ...m, table: 1 } : m)) }))
    }))
  };
  const refused = applyLifecycleOperation(shared, { type: 'reopen', table: 1 }, ctx);
  assert.equal(refused.ok, false);
  assert.match(refused.error!, /one pod/);
  assert.equal(refused.tournament, shared);
  const explicit = operated(shared, { type: 'reopen', pod: selected.category, table: 1 }, ctx);
  assert.equal(latestRound(explicit.pods[1]!)!.matches[0]!.outcome, 'pending');
});
