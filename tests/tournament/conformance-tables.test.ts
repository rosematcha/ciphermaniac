import assert from 'node:assert/strict';
import test from 'node:test';

import { packRepairTables, packTables, prepareTables } from '../../shared/tournament/lifecycleTables.ts';
import { latestRound, seatPairings } from '../../shared/tournament/rounds.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

test('rule 58: duplicate static seats share their table instead of resolving the conflict', () => {
  const matches = seatPairings(
    [
      { p1: 'a', p2: 'x' },
      { p1: 'y', p2: 'z' },
      { p1: 'b', p2: 'w' }
    ],
    {
      firstTable: 1,
      timestamp: '',
      fixed: new Map([
        ['a', 5],
        ['b', 5]
      ])
    }
  );
  assert.deepEqual(
    matches.map(m => m.table),
    [5, 1, 5]
  );
});

const ctx = context(58);
const juniorPod = (t: Tournament): Pod => t.pods.find(p => p.category === 'junior')!;

/** Six players per division; three late Juniors outgrow the Junior pod's three tables. */
function grownJuniors(startSeniors: boolean): Tournament {
  let t = operated(generatedEvent(18, ctx, { mixed: true, additionalRounds: 0 }), { type: 'start' }, ctx);
  if (startSeniors) {
    t = operated(t, { type: 'startRound', pod: 'senior' }, ctx);
  }
  for (const id of ['late-1', 'late-2', 'late-3']) {
    const player = { id, firstName: 'Generated', lastName: id, birthDate: '02/27/2016' };
    t = operated(t, { type: 'late', player, markLate: false, forcedLoss: false, timestamp: ctx.localTime }, ctx);
  }
  return operated(t, { type: 'pair', pod: 'junior', repair: true }, ctx);
}

test('rule 58: a repair that passes the next pod’s start keeps its overflow table and the neighbour’s tables', () => {
  for (const startSeniors of [true, false]) {
    const t = grownJuniors(startSeniors);
    const tables = latestRound(juniorPod(t))!
      .matches.filter(m => m.p2 !== null)
      .map(m => m.table)
      .sort((a, b) => a - b);
    assert.deepEqual(tables, [1, 2, 3, t.settings!.overflowTableStart]);
    const seniors = t.pods.find(p => p.category === 'senior')!;
    assert.equal(seniors.startingTable, 4);
    assert.deepEqual(
      latestRound(seniors)!.matches.map(m => m.table),
      [4, 5, 6]
    );
  }
});

function finishedPod(t: Tournament, category: Pod['category']): Tournament {
  let next = t;
  for (let round = 1; round <= 3; round += 1) {
    next = operated(next, { type: 'startRound', pod: category }, ctx);
    const last = latestRound(next.pods.find(p => p.category === category)!)!;
    const results = last.matches.filter(m => m.p2 !== null).map(m => ({ ...m, outcome: 'p1' as const }));
    next = operated(next, { type: 'results', pod: category, results }, ctx);
    next = operated(next, { type: round < 3 ? 'pair' : 'viewStandings', pod: category }, ctx);
  }
  return next;
}

test('rule 21b: a repair keeps the stored start of a pod whose pairings were viewed', () => {
  let t = operated(generatedEvent(18, ctx, { mixed: true, additionalRounds: 0 }), { type: 'start' }, ctx);
  t = finishedPod(finishedPod(t, 'junior'), 'senior');
  t = operated(t, { type: 'viewPairings', pod: 'masters' }, ctx);
  const dropped = latestRound(t.pods.find(p => p.category === 'masters')!)!.matches[0]!.p1;
  t = operated(t, { type: 'drop', id: dropped, disqualified: false, timestamp: ctx.localTime }, ctx);
  t = operated(t, { type: 'pair', pod: 'masters', repair: true }, ctx);
  const masters = t.pods.find(p => p.category === 'masters')!;
  assert.equal(masters.startingTable, 7);
  assert.ok(latestRound(masters)!.matches.every(m => m.p2 === null || m.table >= 7));
});

/** Three ten-player divisions play Swiss, semifinals, and a final with a playoff. */
function cutFinals(): Tournament {
  let t = operated(
    generatedEvent(30, ctx, { mixed: true, type: 3, cut: 4, thirdPlace: true, additionalRounds: 0 }),
    { type: 'start' },
    ctx
  );
  for (let round = 1; round <= 4; round += 1) {
    t = completed(t, ctx);
    if (round < 4) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  t = operated(t, { type: 'topCut' }, ctx);
  return operated(completed(t, ctx), { type: 'pair' }, ctx);
}

test('V16-11: reopened pending finals reserve a championship and playoff table per pod', () => {
  const reopened = operated(cutFinals(), { type: 'reload' }, ctx);
  const packed = prepareTables(reopened);
  assert.deepEqual(
    packed.pods.map(p => p.startingTable),
    [1, 3, 5]
  );
  assert.ok(packed.pods.every(p => latestRound(p)!.matches.length === 2));
  assert.ok(packed.pods.every(p => latestRound(p)!.matches.every(m => m.outcome === 'pending')));
});

test('V16-11: a reopened decided playoff retains its table beside a restored pending championship', () => {
  const finals = cutFinals();
  const junior = juniorPod(finals);
  const playoff = latestRound(junior)!.matches[1]!;
  const entered = operated(finals, { type: 'results', pod: 'junior', results: [{ ...playoff, outcome: 'p1' }] }, ctx);
  const reopened = operated(entered, { type: 'reload' }, ctx);
  const packed = prepareTables(reopened);
  assert.deepEqual(
    packed.pods.map(p => p.startingTable),
    [1, 2, 4]
  );
  assert.equal(latestRound(juniorPod(packed))!.matches[0]!.outcome, 'pending');
  assert.equal(latestRound(juniorPod(packed))!.matches[1]!.outcome, 'p1');
});

test('V23-2: packing leaves table zero untouched while moving a positive table outside the range', () => {
  const started = operated(generatedEvent(18, context(23), { mixed: true }), { type: 'start' }, context(23));
  const pods = started.pods.map(pod => ({
    ...pod,
    rounds: pod.rounds.map(round => ({
      ...round,
      matches: round.matches.map((match, i) => ({
        ...match,
        table: pod.category === 'junior' ? [0, 1, 9][i]! : pod.category === 'senior' ? i + 2 : 0
      }))
    }))
  }));
  const t = { ...started, settings: { ...started.settings!, overflowTableStart: 7 }, pods };
  const packed = packTables(t, 'junior');
  assert.deepEqual(
    latestRound(juniorPod(packed))!.matches.map(m => m.table),
    [0, 1, 2]
  );
  assert.deepEqual(packed.pods.slice(1), pods.slice(1));
});

test('V23-4: packing before an ordinary repair leaves a started round’s tables intact', () => {
  const started = operated(generatedEvent(6, context(24)), { type: 'start' }, context(24));
  const pods = started.pods.map(pod => ({
    ...pod,
    rounds: pod.rounds.map(round => ({
      ...round,
      stage: 4,
      matches: round.matches.map(match => ({ ...match, table: match.table + 10 }))
    }))
  }));
  const t = { ...started, pods };
  assert.deepEqual(packRepairTables(t), t);
});
