import assert from 'node:assert/strict';
import test from 'node:test';

import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

const ctx = context(15);
const pod = 'senior-masters' as const;

/** Six Juniors and six Seniors pod as 0 and 9; a marked Master entrant takes a forced loss in round one. */
function withForcedLoss(entrants: { id: string; year: number }[]): Tournament {
  const base = generatedEvent(12, ctx);
  const players = base.players.map((p, i) => ({ ...p, birthDate: i < 6 ? '02/27/2016' : '02/27/2012' }));
  let t = operated({ ...base, players }, configureOf(), ctx);
  t = operated(t, { type: 'start' }, ctx);
  t = operated(t, lateOf('2000001', 1995, true), ctx);
  for (const entrant of entrants) {
    t = operated(t, lateOf(entrant.id, entrant.year, false), ctx);
  }
  return operated(t, { type: 'pair', pod, repair: true }, ctx);
}

function configureOf() {
  return {
    type: 'configure' as const,
    eventType: 2 as const,
    cut: 0,
    flights: 1,
    lessSwiss: false,
    additionalRounds: 0,
    thirdPlace: false,
    manualTables: false,
    blockedRanges: [],
    roundMinutes: 30,
    finalMinutes: 75
  };
}

function lateOf(id: string, year: number, forcedLoss: boolean) {
  return {
    type: 'late' as const,
    player: { id, firstName: 'Synthetic', lastName: id, birthDate: `02/27/${year}` },
    markLate: forcedLoss,
    forcedLoss,
    timestamp: ctx.localTime
  };
}

const repaired = (t: Tournament) => latestRound(t.pods.find(p => p.category === pod)!)!.matches;
const forcedLossOf = (t: Tournament, id: string) => repaired(t).some(m => m.p1 === id && m.outcome === 'loss');

test('a repair dissolves a forced loss when fewer than three pool players share its total and division', () => {
  const t = withForcedLoss([{ id: '2000002', year: 1995 }]);
  assert.ok(!forcedLossOf(t, '2000001'));
  assert.ok(repaired(t).some(m => [m.p1, m.p2].includes('2000001') && [m.p1, m.p2].includes('2000002')));
  assert.equal(t.players.find(p => p.id === '2000001')!.lateData?.forcedLoss, true);
});

test('a repair keeps a forced loss when three pool players share its total and division', () => {
  const entrants = ['2000002', '2000003', '2000004'].map(id => ({ id, year: 1995 }));
  assert.ok(forcedLossOf(withForcedLoss(entrants), '2000001'));
});

test('a repair for a lower-division entrant never reaches a Master forced loss', () => {
  assert.ok(forcedLossOf(withForcedLoss([{ id: '2000002', year: 2012 }]), '2000001'));
});
