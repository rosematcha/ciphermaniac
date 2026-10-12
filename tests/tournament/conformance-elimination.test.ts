import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { writeTdf } from '../../shared/tournament/tdf.ts';
import { publicTournament } from '../../shared/tournament/view.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

test('an unpaired elimination entrant advances without an order and receives the first odd-survivor bye', () => {
  const ctx = context(83);
  let t = operated(generatedEvent(8, ctx, { type: 1, additionalRounds: 0 }), { type: 'start' }, ctx);
  t = operated(
    t,
    {
      type: 'late',
      player: { id: 'entrant', firstName: 'Synthetic', lastName: 'Entrant', birthDate: '02/27/1995' },
      markLate: false,
      forcedLoss: false,
      timestamp: ctx.localTime
    },
    ctx
  );
  assert.equal(t.players.find(p => p.id === 'entrant')!.order, undefined);
  for (let number = 2; number <= 4; number += 1) {
    t = operated(completed(t, ctx), { type: 'pair' }, ctx);
    const round = latestRound(t.pods[0]!)!;
    assert.equal(round.number, number);
    assert.equal(round.matches[0]!.p1, 'entrant');
    assert.equal(round.matches[0]!.p2 === null, number < 4);
  }
  t = operated(completed(t, ctx), { type: 'finish' }, ctx);
  assert.equal(t.settings!.stage, 5);
});

test('a departure before a cut result prevents completion until the saved file is reopened', () => {
  const ctx = context(89);
  let t = operated(generatedEvent(10, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (let number = 1; number <= 4; number += 1) {
    t = completed(t, ctx);
    if (number < 4) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  t = operated(t, { type: 'topCut' }, ctx);
  const id = latestRound(t.pods[0]!)!.matches[0]!.p1;
  t = operated(t, { type: 'drop', id, disqualified: true, timestamp: ctx.localTime }, ctx);
  // V18-8: a departure before the result leaves the departed player among the surviving cut players.
  assert.ok(t.pods[0]!.survivors!.includes(id));
  assert.deepEqual(readTournament(t), t);
  const keys = Object.fromEntries(t.players.map(p => [p.id, `public-${p.id}`]));
  assert.deepEqual(
    publicTournament(t, keys).pods[0]!.survivors,
    t.pods[0]!.survivors!.map(s => keys[s])
  );
  t = operated(completed(t, ctx), { type: 'pair' }, ctx);
  t = operated(completed(t, ctx), { type: 'viewRecords' }, ctx);
  assert.equal(latestRound(t.pods[0]!)!.stage, 6);
  for (const type of ['finish', 'pair'] as const) {
    const refused = applyLifecycleOperation(t, { type }, ctx);
    assert.equal(refused.ok, false);
    assert.ok(refused.error);
    assert.equal(refused.tournament, t);
  }
  assert.ok(!writeTdf(t).includes('<standings>'));
  const reopened = operated(t, { type: 'reload' }, ctx);
  assert.equal(latestRound(reopened.pods[0]!)!.stage, 5);
  const finished = operated(reopened, { type: 'finish' }, ctx);
  assert.equal(finished.settings!.stage, 5);
  assert.ok(writeTdf(finished).includes('<standings>'));
});

test('an opening elimination repair seats an unpaired entrant once and refuses after start', () => {
  const ctx = context(97);
  const paired = operated(generatedEvent(12, ctx, { type: 1 }), { type: 'start' }, ctx);
  const joined = operated(
    paired,
    {
      type: 'late',
      player: { id: '13', firstName: 'Generated', lastName: '13', birthDate: '02/27/1995' },
      markLate: false,
      forcedLoss: false,
      timestamp: ctx.localTime
    },
    ctx
  );
  const repaired = operated(joined, { type: 'pair', repair: true }, ctx);
  const { rounds } = repaired.pods[0]!;
  assert.equal(rounds.length, 1);
  const ids = rounds[0]!.matches.flatMap(match => (match.p2 === null ? [match.p1] : [match.p1, match.p2]));
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, 13);
  assert.equal(rounds[0]!.stage, 2);
  const running = operated(repaired, { type: 'startRound' }, ctx);
  const refused = applyLifecycleOperation(running, { type: 'pair', repair: true }, ctx);
  assert.equal(refused.ok, false);
  assert.match(refused.error!, /not-started elimination round/);
  assert.deepEqual(refused.tournament, running);
});

test('a refused departed cut winner still eliminates the opponent and persists that survivor change', () => {
  const ctx = context(101);
  let t = operated(generatedEvent(10, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (let number = 1; number <= 4; number += 1) {
    t = completed(t, ctx);
    if (number < 4) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  t = operated(t, { type: 'topCut' }, ctx);
  t = operated(t, { type: 'startRound' }, ctx);
  const first = latestRound(t.pods[0]!)!.matches[0]!;
  t = operated(t, { type: 'drop', id: first.p1, disqualified: true, timestamp: ctx.localTime }, ctx);
  const awarded = latestRound(t.pods[0]!)!.matches[0]!;
  t = operated(t, { type: 'results', results: [{ ...awarded, outcome: 'p1' }] }, ctx);
  assert.deepEqual(latestRound(t.pods[0]!)!.matches[0], awarded);
  // V18-8: the refused entry still removes the loser it names; the departed winner keeps counting.
  assert.ok(!t.pods[0]!.survivors!.includes(first.p2!));
  assert.ok(t.pods[0]!.survivors!.includes(first.p1));
  assert.deepEqual(readTournament(t), t);
  const keys = Object.fromEntries(t.players.map(p => [p.id, `public-${p.id}`]));
  assert.deepEqual(
    publicTournament(t, keys).pods[0]!.survivors,
    t.pods[0]!.survivors!.map(s => keys[s])
  );
  t = completed(t, ctx);
  const refused = applyLifecycleOperation(t, { type: 'pair' }, ctx);
  assert.equal(refused.ok, false);
  assert.equal(refused.tournament, t);
});

test('a terminal repair of an acknowledged odd final Swiss round preserves results and releases its table range', () => {
  const ctx = context(103);
  let t = operated(generatedEvent(7, ctx, { type: 2, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (let number = 1; number <= 3; number += 1) {
    t = completed(t, ctx);
    if (number < 3) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  t = operated(t, { type: 'viewRecords' }, ctx);
  const prior = latestRound(t.pods[0]!)!;
  const recorded = {
    pairings: { masters: prior.matches.map(({ p1, p2 }) => ({ p1, p2 })) },
    retainedTables: prior.matches.filter(m => m.p2 !== null).map(m => m.table)
  };
  const repaired = operated(t, { type: 'pair', repair: true, terminal: true }, { ...ctx, recorded });
  const after = latestRound(repaired.pods[0]!)!;
  assert.equal(after.stage, prior.stage);
  assert.deepEqual(
    after.matches.map(({ table: _table, ...m }) => m),
    prior.matches.map(({ table: _table, ...m }) => m)
  );
  assert.deepEqual(
    after.matches.filter(m => m.p2 !== null).map(m => m.table),
    [13, 14, 15]
  );
});

test('a pending cut departure after reopening keeps the other pending semifinal contenders', () => {
  const ctx = context(113);
  let t = operated(generatedEvent(10, ctx, { type: 3, cut: 4, additionalRounds: 0 }), { type: 'start' }, ctx);
  for (let number = 1; number <= 4; number += 1) {
    t = completed(t, ctx);
    if (number < 4) {
      t = operated(t, { type: 'pair' }, ctx);
    }
  }
  t = operated(operated(t, { type: 'topCut' }, ctx), { type: 'reload' }, ctx);
  const semifinals = latestRound(t.pods[0]!)!.matches;
  t = operated(t, { type: 'drop', id: semifinals[0]!.p1, disqualified: true, timestamp: ctx.localTime }, ctx);
  const contenders = semifinals.flatMap(m => [m.p1, m.p2!]);
  assert.deepEqual([...t.pods[0]!.survivors!].sort(), contenders.sort());
});

test('PAIRING 28: a departed elimination opponent refuses an ordinary drop but accepts a disqualification', () => {
  const ctx = context(107);
  let t = operated(generatedEvent(8, ctx, { type: 1, additionalRounds: 0 }), { type: 'start' }, ctx);
  const { p1, p2 } = latestRound(t.pods[0]!)!.matches[0]!;
  t = operated(t, { type: 'drop', id: p1, disqualified: false, timestamp: ctx.localTime }, ctx);
  const awarded = latestRound(t.pods[0]!)!.matches[0]!;
  assert.equal(awarded.outcome, 'p2');
  const refused = applyLifecycleOperation(
    t,
    { type: 'drop', id: p2!, disqualified: false, timestamp: ctx.localTime },
    ctx
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.tournament, t);
  t = operated(t, { type: 'drop', id: p2!, disqualified: true, timestamp: ctx.localTime }, ctx);
  assert.deepEqual(latestRound(t.pods[0]!)!.matches[0], awarded);
  assert.equal(t.players.find(p => p.id === p2)!.disqualified, true);
});
