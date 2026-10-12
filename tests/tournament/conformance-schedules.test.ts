import assert from 'node:assert/strict';
import test from 'node:test';

import { regularRounds } from '../../shared/tournament/rounds.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import { publicTournament } from '../../shared/tournament/view.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

test('single-division flights round up while combined pods use the largest current division without dividing', () => {
  const ctx = context(71);
  const single = generatedEvent(65, ctx, { flights: 2, additionalRounds: 0 });
  assert.equal(regularRounds(single, single.pods[0]!), 6);
  const combined = {
    ...single,
    players: single.players.map((p, i) => ({ ...p, birthDate: i < 5 ? '02/27/2012' : p.birthDate })),
    pods: single.pods.map(p => ({
      ...p,
      category: 'senior-masters' as const,
      divisionCounts: { senior: 5, masters: 60 }
    }))
  };
  assert.equal(regularRounds(combined, combined.pods[0]!), 6);
});

test('membership changes select a frozen division count while player schedules change only on reopening', () => {
  const ctx = context(73);
  const configured = generatedEvent(14, ctx, { additionalRounds: 0 });
  const mixed = {
    ...configured,
    players: configured.players.map((p, i) => ({
      ...p,
      birthDate: i < 9 ? '02/27/1995' : i < 12 ? '02/27/2012' : '02/27/2016'
    })),
    pods: configured.pods.map(p => ({
      ...p,
      category: 'mixed' as const,
      divisionCounts: { junior: 2, senior: 3, masters: 9 }
    }))
  };
  let t = operated(mixed, { type: 'start' }, ctx);
  assert.equal(regularRounds(t, t.pods[0]!), 4);
  for (let i = 0; i < 7; i += 1) {
    t = operated(
      t,
      {
        type: 'late',
        player: { id: `late-${i}`, firstName: 'Synthetic', lastName: 'Entrant', birthDate: '02/27/2012' },
        markLate: false,
        forcedLoss: false,
        timestamp: ctx.localTime
      },
      ctx
    );
  }
  assert.equal(regularRounds(t, t.pods[0]!), 3);
  assert.ok(t.players.filter(p => p.starter).every(p => p.scheduledSwissRounds === 4));
  assert.ok(t.players.filter(p => !p.starter).every(p => p.scheduledSwissRounds === 0));
  assert.deepEqual(readTournament(t), t);
  const publicCopy = publicTournament(t, {});
  assert.deepEqual(
    publicCopy.players.map(p => p.scheduledSwissRounds),
    t.players.map(p => p.scheduledSwissRounds)
  );
  const reopened = operated(t, { type: 'reload' }, ctx);
  assert.ok(reopened.players.every(p => p.scheduledSwissRounds === 3));
});

test('a departed opponent is capped by their own schedule, including an uncapped uninterrupted entrant', () => {
  const ctx = context(79);
  const t = generatedEvent(2, ctx, { additionalRounds: 0 });
  const pod = {
    ...t.pods[0]!,
    rounds: Array.from({ length: 3 }, (_, i) => ({
      number: i + 1,
      kind: 'swiss' as const,
      status: 'finished' as const,
      timeLeft: 0,
      pairTime: ctx.localTime,
      startTime: ctx.localTime,
      matches: [{ p1: '1', p2: '2', outcome: 'p1' as const, table: 1, timestamp: ctx.localTime }]
    }))
  };
  for (const [schedule, expected] of [
    [4, 0.75],
    [3, 1],
    [0, 1]
  ]) {
    const players = t.players.map(p => (p.id === '1' ? { ...p, droppedAfter: 3, scheduledSwissRounds: schedule } : p));
    assert.equal(swissStandings(pod, players, { regularRounds: 4 }).find(r => r.playerId === '2')!.owp, expected);
  }
});
