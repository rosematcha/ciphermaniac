import assert from 'node:assert/strict';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import type { LifecycleContext, LifecycleOperation } from '../../shared/tournament/lifecycleTypes.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Tournament } from '../../shared/tournament/types.ts';

export function context(seed: number): LifecycleContext {
  return { now: Date.UTC(2026, 9, 1, 12), localTime: '10/01/2026 12:00:00', season: 2027, random: seededRandom(seed) };
}

export function operated(t: Tournament, op: LifecycleOperation, ctx: LifecycleContext): Tournament {
  const result = applyLifecycleOperation(t, op, ctx);
  assert.ok(result.ok, `${op.type}: ${result.error}`);
  return result.tournament;
}

export function generatedEvent(
  count: number,
  ctx: LifecycleContext,
  options: {
    mixed?: boolean;
    flights?: number;
    type?: 1 | 2 | 3;
    cut?: number;
    byes?: number;
    thirdPlace?: boolean;
    additionalRounds?: number;
  } = {}
): Tournament {
  const type = options.type ?? 2;
  let t = operated(
    emptyTournament({ name: 'Generated' }),
    {
      type: 'create',
      info: emptyTournament({ name: 'Generated', startDate: '10/01/2026' }).info,
      settings: { type, mode: 'CUSTOM' }
    },
    ctx
  );
  t = operated(
    t,
    {
      type: 'register',
      players: Array.from({ length: count }, (_, i) => ({
        id: String(i + 1),
        firstName: 'Generated',
        lastName: String(i + 1),
        birthDate: options.mixed ? `02/27/${[2016, 2012, 1995][i % 3]}` : '02/27/1995',
        ...(i === 0 && options.byes ? { byes: options.byes } : {})
      }))
    },
    ctx
  );
  return operated(
    t,
    {
      type: 'configure',
      eventType: type,
      cut: options.cut ?? 0,
      flights: options.flights ?? 1,
      lessSwiss: false,
      additionalRounds: options.additionalRounds ?? 1,
      thirdPlace: options.thirdPlace ?? false,
      manualTables: false,
      blockedRanges: [],
      roundMinutes: 30,
      finalMinutes: 75
    },
    ctx
  );
}

export function completed(t: Tournament, ctx: LifecycleContext): Tournament {
  let next = t;
  for (const pod of t.pods) {
    const last = pod.rounds.at(-1)!;
    next = operated(next, { type: 'startRound', pod: pod.category }, ctx);
    const results = last.matches
      .filter(m => m.p2 !== null && m.outcome === 'pending')
      .map(m => ({ ...m, outcome: ctx.random() < 0.5 ? ('p1' as const) : ('p2' as const) }));
    next = operated(next, { type: 'results', pod: pod.category, results }, ctx);
  }
  return next;
}
