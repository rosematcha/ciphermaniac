import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import type { LifecycleContext } from '../../shared/tournament/lifecycleTypes.ts';
import { writeTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const ctx = context(23);
const named: Record<string, [string, string]> = {
  '1': ['Same', 'Fixture'],
  '2': ['Same', 'Fixture'],
  '3': ['Same', 'Fixture'],
  '4': ['Alpha', 'Fixture']
};

/** Four disqualified after round one, three of them identically named; the rest play to the end. */
function disqualifiedEvent(): Tournament {
  const event = generatedEvent(12, ctx);
  const renamed = {
    ...event,
    players: event.players.map(p => (named[p.id] ? { ...p, firstName: named[p.id]![0], lastName: named[p.id]![1] } : p))
  };
  let t = completed(operated(renamed, { type: 'start' }, ctx), ctx);
  for (const id of ['3', '1', '4', '2']) {
    t = operated(t, { type: 'drop', id, disqualified: true, timestamp: ctx.localTime }, ctx);
  }
  for (;;) {
    const paired = applyLifecycleOperation(operated(t, { type: 'viewRecords' }, ctx), { type: 'pair' }, ctx);
    if (!paired.ok) {
      return t;
    }
    t = completed(paired.tournament, ctx);
  }
}

function disqualifiedList(t: Tournament): string[] {
  const block = /<pod category="2" type="dnf">([\s\S]*?)<\/pod>/.exec(writeTdf(t, { now: ctx.now }))![1]!;
  return [...block.matchAll(/id="(\d+)"/g)].map(m => m[1]!);
}

const rosterOrder = (t: Tournament) => t.players.filter(p => ['1', '2', '3'].includes(p.id)).map(p => p.id);
const finish = (t: Tournament, recorded?: LifecycleContext['recorded']) =>
  operated(t, { type: 'finish' }, { ...ctx, ...(recorded ? { recorded } : {}) });

test('SPEC 3.7: without a recorded choice, identical names keep roster order after the name sort', () => {
  const finished = finish(disqualifiedEvent());
  assert.deepEqual(disqualifiedList(finished), ['4', ...rosterOrder(finished)]);
});

test('SPEC 3.7: a recorded choice orders only identically named players', () => {
  const finished = finish(disqualifiedEvent(), { disqualifiedNameOrder: [['2', '3', '4', '1']] });
  assert.deepEqual(disqualifiedList(finished), ['4', '2', '3', '1']);
  assert.match(writeTdf(finished, { now: ctx.now }), /<pod category="2" type="finished">/);
});

test('SPEC 3.7: reopening drops the recorded choice and ignores one supplied with the reload', () => {
  const finished = finish(disqualifiedEvent(), { disqualifiedNameOrder: [['3', '2', '1', '4']] });
  const reopened = operated(
    finished,
    { type: 'reload' },
    { ...ctx, recorded: { disqualifiedNameOrder: [['2', '1']] } }
  );
  assert.deepEqual(disqualifiedList(reopened), ['4', ...rosterOrder(reopened)]);
});
