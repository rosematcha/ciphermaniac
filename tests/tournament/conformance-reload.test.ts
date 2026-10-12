import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

test('explicit reload resets preferences and completed stages while lossless reads retain saved stages', () => {
  const ctx = context(41);
  const started = operated(generatedEvent(8, ctx), { type: 'start' }, ctx);
  const viewed = operated(completed(started, ctx), { type: 'viewRecords' }, ctx);
  const finished = completed(operated(viewed, { type: 'pair' }, ctx), ctx);
  const field = {
    ...finished,
    players: finished.players.map((player, i) => ({ ...player, tiebreaker: i === 7 ? 0 : i + 1 }))
  };
  const at = { ...ctx, now: ctx.now + 86400000 };
  const saved = writeTdf(field, { now: at.now });
  assert.equal(writeTdf(parseTdf(saved)), saved);
  const reopened = operated(field, { type: 'reload' }, at);
  assert.deepEqual(
    reopened.players.map(p => p.id),
    field.players.map(p => p.id)
  );
  assert.deepEqual(
    reopened.players.map(p => p.tiebreaker),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  const before = field.pods[0]!.rounds;
  const after = reopened.pods[0]!.rounds;
  assert.deepEqual(
    after.map(r => r.matches),
    before.map(r => r.matches)
  );
  assert.deepEqual(
    after.map(r => r.startTime),
    before.map(r => r.startTime)
  );
  assert.deepEqual(
    after.map(r => r.stage),
    [4, 5]
  );
  const xml = writeTdf(reopened, { now: at.now });
  assert.match(xml, /<round number="1" type="2" stage="4" >/);
  assert.match(xml, /<round number="2" type="2" stage="5" >/);
});

test('reload raises overflow to nine above each pod start plus half its registered roster, ignoring tables', () => {
  const ctx = context(43);
  const at = { ...ctx, now: ctx.now + 86400000 };
  const field = completed(operated(generatedEvent(9, ctx), { type: 'start' }, ctx), ctx);
  field.pods[0]!.rounds[0]!.matches[0]!.table = 20;
  const reopened = (settings: Partial<NonNullable<typeof field.settings>>, pods = field.pods) =>
    operated({ ...field, pods, settings: { ...field.settings!, ...settings } }, { type: 'reload' }, at).settings!
      .overflowTableStart;
  assert.equal(reopened({ overflowTableStart: 0 }), 14);
  assert.equal(reopened({ overflowTableStart: 14 }), 14);
  assert.equal(reopened({ overflowTableStart: 40 }), 40);
  assert.equal(reopened({ overflowTableStart: 0, autoTables: false }), 14);
  assert.equal(reopened({ overflowTableStart: 0 }, [{ ...field.pods[0]!, startingTable: 5 }]), 18);
  assert.equal(reopened({ overflowTableStart: 3 }, []), 3);
});

test('reopening counts a division that had no players at the start from its registered roster', () => {
  const ctx = context(43);
  const base = generatedEvent(12, ctx);
  const players = base.players.map((p, i) => ({ ...p, birthDate: i < 6 ? '02/27/2016' : '02/27/2012' }));
  let t = operated(
    { ...base, players },
    {
      type: 'configure',
      eventType: 2,
      cut: 0,
      flights: 1,
      lessSwiss: false,
      additionalRounds: 0,
      thirdPlace: false,
      manualTables: false,
      blockedRanges: [],
      roundMinutes: 30,
      finalMinutes: 75
    },
    ctx
  );
  t = operated(t, { type: 'start' }, ctx);
  const player = { id: '2000001', firstName: 'Synthetic', lastName: 'Entrant', birthDate: '02/27/1995' };
  t = operated(t, { type: 'late', player, markLate: false, forcedLoss: false, timestamp: ctx.localTime }, ctx);
  const counts = (event: typeof t) => event.pods.find(p => p.category === 'senior-masters')!.divisionCounts!;
  assert.deepEqual([counts(t).senior, counts(t).masters], [6, 0]);
  const reopened = counts(operated(t, { type: 'reload' }, ctx));
  assert.deepEqual([reopened.senior, reopened.masters], [6, 1]);
});

test('V12a: entrants that stay exactly tied keep their entry order during uninterrupted play', () => {
  const ctx = context(109);
  let t = operated(generatedEvent(8, ctx), { type: 'start' }, ctx);
  for (let number = 1; number < 3; number += 1) {
    t = operated(completed(t, ctx), { type: 'pair' }, ctx);
  }
  t = operated(t, { type: 'startRound' }, ctx);
  for (const id of ['2000002', '2000001']) {
    const player = { id, firstName: 'Synthetic', lastName: 'Entrant', birthDate: '02/27/1995' };
    t = operated(t, { type: 'late', player, markLate: false, forcedLoss: false, timestamp: ctx.localTime }, ctx);
    t = operated(t, { type: 'drop', id, disqualified: false, timestamp: ctx.localTime }, ctx);
  }
  // List the later entrant first in the pod, as flight order can, so membership order cannot decide.
  const pod = t.pods[0]!;
  t = { ...t, pods: [{ ...pod, playerIds: ['2000001', ...pod.playerIds.filter(id => id !== '2000001')] }] };
  t = operated(completed(operated(completed(t, ctx), { type: 'pair' }, ctx), ctx), { type: 'finish' }, ctx);
  const places = [...writeTdf(t, { now: ctx.now }).matchAll(/<player id="(\d+)" place="\d+" \/>/g)].map(m => m[1]);
  assert.deepEqual(places.slice(-2), ['2000002', '2000001']);
});
