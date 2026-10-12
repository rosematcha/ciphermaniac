import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand } from '../../shared/tournament/commands.ts';
import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

/** Nine players who each hold two assigned-bye awards: three attempts, the first two emptied by byes. */
function allHolders(seed: number): Tournament {
  const ctx = context(seed);
  const t = generatedEvent(9, ctx, { type: 2, additionalRounds: 0 });
  return { ...t, players: t.players.map(p => ({ ...p, byes: 2 })) };
}

test('V18-2: a start paired only by its third attempt saves round one at stage 1 without assigned byes', () => {
  const ctx = context(201);
  const result = applyLifecycleOperation(allHolders(201), { type: 'start' }, ctx);
  assert.equal(result.ok, true);
  const pod = result.tournament.pods[0]!;
  const round = latestRound(pod)!;
  assert.equal(round.stage, 1);
  assert.ok(!round.matches.some(m => m.outcome === 'assigned-bye'));
  // Each failed attempt handed every holder an unsaved assigned bye, using one award each time.
  assert.equal(pod.unsavedByes?.length, 18);
  assert.ok(result.tournament.players.every(p => p.forfeitedByes === 2));
  assert.deepEqual(readTournament(result.tournament), result.tournament);
  const standings = swissStandings(pod, result.tournament.players);
  assert.ok(standings.every(row => row.points >= 6));
});

test('V18-2: reopening discards unsaved byes and restores the awards, so the next request retries again', () => {
  const ctx = context(203);
  let t = operated(allHolders(203), { type: 'start' }, ctx);
  t = operated(completed(t, ctx), { type: 'viewRecords' }, ctx);
  t = operated(t, { type: 'reload' }, ctx);
  assert.equal(t.pods[0]!.unsavedByes, undefined);
  assert.ok(t.players.every(p => !p.forfeitedByes));
  const lifecycle = applyLifecycleOperation(t, { type: 'pair' }, ctx);
  assert.equal(lifecycle.ok, false);
  assert.equal(lifecycle.retried, true);
  assert.equal(latestRound(lifecycle.tournament.pods[0]!)!.number, 2);
  assert.equal(latestRound(lifecycle.tournament.pods[0]!)!.stage, 1);
  // The site reports the round TOM saved, although TOM itself reports that no round was paired.
  const command = applyCommand(t, { type: 'pairRound', pod: t.pods[0]!.category }, ctx);
  assert.equal(command.ok, true);
  assert.equal(latestRound(command.ok ? command.tournament.pods[0] : undefined)!.number, 2);
});

test('V18-2: a player whose only matches went unsaved cannot return', () => {
  const ctx = context(205);
  // Four holders allow one attempt, which fails once all four receive assigned byes.
  const nine = allHolders(205);
  const t = {
    ...nine,
    players: nine.players.slice(0, 4),
    pods: nine.pods.map(p => ({ ...p, playerIds: p.playerIds.slice(0, 4) }))
  };
  const started = applyLifecycleOperation(t, { type: 'start' }, ctx);
  assert.equal(started.ok, false);
  assert.equal(started.tournament.pods[0]!.rounds.length, 0);
  const holder = started.tournament.players[0]!.id;
  assert.ok(started.tournament.pods[0]!.unsavedPlayers?.includes(holder));
  const dropped = operated(
    started.tournament,
    { type: 'drop', id: holder, disqualified: false, timestamp: ctx.localTime },
    ctx
  );
  const returned = applyLifecycleOperation(dropped, { type: 'reenter', id: holder }, ctx);
  assert.equal(returned.ok, false);
  assert.equal(returned.tournament, dropped);
});
