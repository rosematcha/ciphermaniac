import assert from 'node:assert/strict';
import test from 'node:test';

import { latestRound } from '../../shared/tournament/rounds.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const holder = '1';
const ctx = context(52);
const assignedIn = (t: Tournament) =>
  latestRound(t.pods[0]!)!.matches.some(m => m.p1 === holder && m.outcome === 'assigned-bye');
const drop = (t: Tournament) =>
  operated(t, { type: 'drop', id: holder, disqualified: false, timestamp: ctx.localTime }, ctx);
const held = (t: Tournament) => t.players.find(p => p.id === holder)!;
const next = (t: Tournament) => operated(completed(t, ctx), { type: 'pair' }, ctx);

test('rule 52: an absence defers an unused assigned bye, and the repair after returning does not award it', () => {
  let t = operated(generatedEvent(12, ctx, { byes: 2 }), { type: 'start' }, ctx);
  assert.ok(assignedIn(t));
  t = operated(drop(completed(t, ctx)), { type: 'pair' }, ctx);
  t = operated(operated(t, { type: 'reenter', id: holder }, ctx), { type: 'pair', repair: true }, ctx);
  const repaired = latestRound(t.pods[0]!)!.matches.find(m => m.p1 === holder || m.p2 === holder)!;
  assert.notEqual(repaired.p2, null, 'the returning holder plays an ordinary match');
  t = next(t);
  assert.ok(assignedIn(t), 'the remaining award applies to the next freshly paired round');
  t = next(t);
  assert.ok(!assignedIn(t), 'an award of two is consumed after two assigned byes');
  assert.equal(held(t).byes, 2, 'the saved award never counts down');
});

test('rule 52: removing an assigned bye before start consumes the award without a refund', () => {
  let t = drop(operated(generatedEvent(12, ctx, { byes: 2 }), { type: 'start' }, ctx));
  assert.ok(!latestRound(t.pods[0]!)!.matches.some(m => m.p1 === holder));
  assert.equal(held(t).forfeitedByes, 1);
  assert.equal(held(readTournament(JSON.parse(JSON.stringify(t)))!).forfeitedByes, 1);
  t = operated(operated(t, { type: 'reenter', id: holder }, ctx), { type: 'pair', repair: true }, ctx);
  assert.ok(!assignedIn(t));
  t = next(t);
  assert.ok(assignedIn(t));
  t = next(t);
  assert.ok(!assignedIn(t), 'the forfeited bye still counts toward the award');
});

test('rule 53: a repeated departure keeps the first status, round and time', () => {
  let t = completed(operated(generatedEvent(12, ctx), { type: 'start' }, ctx), ctx);
  t = operated(t, { type: 'drop', id: '2', disqualified: false, timestamp: '10/01/2026 12:05:00' }, ctx);
  t = operated(t, { type: 'pair' }, ctx);
  const repeated = operated(t, { type: 'drop', id: '2', disqualified: true, timestamp: '10/01/2026 12:45:00' }, ctx);
  assert.deepEqual(repeated, t);
});
