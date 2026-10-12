import { divisionFor } from './divisions.js';
import { addToFlight } from './flights.js';
import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { awardedDeparture, departed as hasDeparted, rejoined } from './lifecycleSurvivors.js';
import { replacePods } from './lifecycleWorkflow.js';
import { divisionsOf } from './podding.js';
import { checkedStage, latestRound, regularRounds } from './rounds.js';
import type { Match, Player, Pod, Round, Tournament } from './types.js';

type DropOperation = Extract<LifecycleOperation, { type: 'drop' }>;

function playerPod(t: Tournament, id: string): Pod {
  const pod = t.pods.find(p => p.playerIds.includes(id));
  if (!pod) {
    throw new Error('The player has no pod');
  }
  return pod;
}

/** An ordinary drop is refused once the player's elimination opponent has departed; a disqualification is not. */
function checkedDropMatch(t: Tournament, last: Round | undefined, op: Pick<DropOperation, 'id' | 'disqualified'>) {
  const match = last?.matches.find(m => m.p1 === op.id || m.p2 === op.id);
  const opponent = match?.p1 === op.id ? match.p2 : match?.p1;
  if (last?.kind === 'elimination' && !op.disqualified && hasDeparted(t, opponent)) {
    throw new Error('The elimination opponent has already dropped');
  }
  return match;
}

function departed(
  player: Player,
  op: Extract<LifecycleOperation, { type: 'drop' }>,
  round: number,
  forfeited: boolean
): Player {
  return {
    ...player,
    droppedAfter: round,
    droppedAt: op.timestamp,
    ...(op.disqualified ? { disqualified: true as const } : {}),
    ...(forfeited ? { forfeitedByes: (player.forfeitedByes ?? 0) + 1 } : {})
  };
}

/** The departing player's current match: removed before a Swiss start, conceded in elimination. */
function roundAfterDrop(
  last: Round,
  match: Match,
  id: string,
  departure: { timestamp: string; opponentDeparted: boolean }
): Round {
  const beforeStart = (last.stage ?? 4) < 4;
  const matches = last.matches.flatMap(m => {
    if (m !== match) {
      return [m];
    }
    if (beforeStart && last.kind === 'swiss') {
      return [];
    }
    return last.kind === 'elimination' && !departure.opponentDeparted
      ? [{ ...m, outcome: m.p1 === id ? ('p2' as const) : ('p1' as const), timestamp: departure.timestamp }]
      : [m];
  });
  const complete = matches.length > 0 && matches.every(m => m.outcome !== 'pending');
  const changed: Round = { ...last, matches, status: complete ? 'finished' : last.status };
  // V18-6: only an awarded result sets an outcome; a removed or untouched match leaves the stage.
  const awarded = last.kind === 'elimination' && matches.some(m => !last.matches.includes(m));
  return awarded ? checkedStage(changed) : changed;
}

function droppedRound(t: Tournament, round: Round, match: Match, departure: { id: string; timestamp: string }): Round {
  const { id, timestamp } = departure;
  const opponent = match.p1 === id ? match.p2 : match.p1;
  return roundAfterDrop(round, match, id, {
    timestamp,
    opponentDeparted: Boolean(opponent && t.players.find(p => p.id === opponent)?.droppedAfter !== null)
  });
}

function unstartedSwiss(round: Round | undefined): boolean {
  return round?.kind === 'swiss' && (round.stage ?? 4) < 4;
}

/** V20-1: an unsaved match from a restarted search can be the one taken away, leaving the round as saved. */
function departingMatch(t: Tournament, last: Round | undefined, op: DropOperation, ctx: LifecycleContext) {
  const match = checkedDropMatch(t, last, op);
  return ctx.recorded?.keptDepartureMatch && last?.kind === 'swiss' ? undefined : match;
}

export function dropEntrant(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'drop' }>,
  ctx: LifecycleContext
): Tournament {
  const pod = playerPod(t, op.id);
  const last = latestRound(pod);
  const match = departingMatch(t, last, op, ctx);
  if (t.players.find(p => p.id === op.id)?.droppedAfter !== null) {
    return repeatedDeparture(t, pod, match, { id: op.id, timestamp: ctx.localTime });
  }
  // Removing an assigned bye before its round starts does not refund the award.
  const forfeited = unstartedSwiss(last) && match?.outcome === 'assigned-bye';
  const players = t.players.map(p => (p.id === op.id ? departed(p, op, last?.number ?? 0, forfeited) : p));
  if (!last || !match) {
    return { ...t, players };
  }
  return {
    ...replacePods(t, [changedDropPod(t, pod, match, { id: op.id, timestamp: ctx.localTime, players })]),
    players
  };
}

/** V24-2: a repeated departure awards a cut match its opponent already holds again, under V18-8 rule 3. */
function reawarded(t: Tournament, pod: Pod, match: Match, id: string): Tournament {
  const opponent = match.p1 === id ? match.p2 : match.p1;
  return opponent ? replacePods(t, [awardedDeparture(t, pod, id, opponent)]) : t;
}

/**
 * A repeated departure keeps the first one's status, round and time (PAIRING 53), but still concedes an
 * elimination match the player has not lost, such as one that reopening restored to pending (PAIRING 28),
 * and removes an unstarted Swiss match that the first departure kept (V20-1).
 */
function repeatedDeparture(
  t: Tournament,
  pod: Pod,
  match: Match | undefined,
  departure: { id: string; timestamp: string }
): Tournament {
  if (!match) {
    return t;
  }
  const last = latestRound(pod);
  const conceded = match.outcome === (match.p1 === departure.id ? 'p2' : 'p1');
  if (last?.kind === 'elimination' && match.p2) {
    return conceded
      ? reawarded(t, pod, match, departure.id)
      : replacePods(t, [changedDropPod(t, pod, match, { ...departure, players: t.players })]);
  }
  return unstartedSwiss(last)
    ? replacePods(t, [changedDropPod(t, pod, match, { ...departure, players: t.players })])
    : t;
}

function changedDropPod(
  t: Tournament,
  pod: Pod,
  match: Match,
  departure: { id: string; timestamp: string; players: Player[] }
): Pod {
  const last = latestRound(pod)!;
  const round = droppedRound(t, last, match, departure);
  const opponent = match.p1 === departure.id ? match.p2 : match.p1;
  const awarded =
    last.kind === 'elimination'
      ? awardedDeparture({ ...t, players: departure.players }, pod, departure.id, opponent)
      : pod;
  const lostRecords = lostByRemoval(pod, last, round, match);
  return {
    ...awarded,
    ...(lostRecords.length ? { lostRecords: [...new Set([...(pod.lostRecords ?? []), ...lostRecords])] } : {}),
    rounds: pod.rounds.map(r => (r === last ? round : r))
  };
}

/**
 * V22-1: removing a Swiss two-seat match sets both players back to their record after the round before it; a
 * player with no match of any kind there is left with no record.
 */
function lostByRemoval(pod: Pod, last: Round, round: Round, match: Match): string[] {
  if (last.kind !== 'swiss' || match.p2 === null || round.matches.includes(match)) {
    return [];
  }
  const previous = pod.rounds.find(r => r.number === last.number - 1);
  const seated = new Set(previous?.matches.flatMap(m => [m.p1, m.p2]) ?? []);
  return [match.p1, match.p2].filter(id => !seated.has(id));
}

function appendedBye(round: Round, id: string, timestamp: string): Round {
  const match: Match = { p1: id, p2: null, outcome: 'bye', table: 0, timestamp };
  return checkedStage({ ...round, matches: [...round.matches, match] });
}

function lastPlayedRound(pod: Pod, id: string): number {
  return Math.max(0, ...pod.rounds.filter(r => r.matches.some(m => m.p1 === id || m.p2 === id)).map(r => r.number));
}

function pairedAdjustment(round: Round | undefined): number {
  return (round?.stage ?? 4) < 4 ? 1 : 0;
}

function checkReturnHistory(last: Round | undefined, hasHistory: boolean): void {
  if (!hasHistory && (last?.number ?? 0) >= 3) {
    throw new Error('A player without match history cannot return after round two');
  }
}

export function reenterEntrant(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'reenter' }>,
  ctx: LifecycleContext
): Tournament {
  const player = t.players.find(p => p.id === op.id);
  if (!player || player.droppedAfter === null) {
    throw new Error('The player is not dropped');
  }
  const pod = playerPod(t, op.id);
  const last = latestRound(pod);
  const hasHistory = pod.rounds.some(r => r.matches.some(m => m.p1 === op.id || m.p2 === op.id));
  // V18-2: matches of a failed pairing attempt are history although unsaved, so V14b's return is refused.
  if (!hasHistory && pod.unsavedPlayers?.includes(op.id)) {
    throw new Error('A player whose only matches were not saved cannot return');
  }
  checkReturnHistory(last, hasHistory);
  // Absence counts the rounds since the player last played, whichever round the departure saved.
  const played = hasHistory ? lastPlayedRound(pod, op.id) : player.droppedAfter;
  const absent = (last?.number ?? 0) - played - pairedAdjustment(last);
  if (absent > 1) {
    throw new Error('A player cannot return after missing more than one round');
  }
  const rounds = pod.rounds.map(round => {
    if (!hasHistory || round.matches.some(m => m.p1 === op.id || m.p2 === op.id)) {
      return round === last ? restoredReturnMatch(round, op.id, ctx.localTime) : round;
    }
    if (round === last && (round.stage ?? 0) >= 4) {
      return appendedBye(round, op.id, ctx.localTime);
    }
    return absent >= 1 && round.number === played + 1 && round !== last
      ? appendedBye(round, op.id, ctx.localTime)
      : round;
  });
  const players = t.players.map(p => {
    if (p !== player) {
      return p;
    }
    const { disqualified: _dq, droppedAt: _drop, ...rest } = p;
    return { ...rest, droppedAfter: null };
  });
  const returned = rejoined(t, { ...pod, rounds: withAbandonedMatch(rounds, op.id, ctx) }, op.id);
  return { ...replacePods(t, [returned]), players, passthrough: withoutSavedDeparture(t, op.id) };
}

/**
 * PAIRING V24-7: a return can append an abandoned Swiss search's unsaved match, at table 0 after every other match
 * of the round. The return's checkpoint is the choice: it holds exactly one more match than statements 18 and 19.
 */
function withAbandonedMatch(rounds: Round[], id: string, ctx: LifecycleContext): Round[] {
  const recorded = ctx.recorded?.returnMatch;
  const last = rounds.at(-1);
  if (
    !recorded ||
    last?.kind !== 'swiss' ||
    recorded.matches !== last.matches.length + 1 ||
    recorded.match.table !== 0 ||
    (recorded.match.p1 !== id && recorded.match.p2 !== id)
  ) {
    return rounds;
  }
  return [...rounds.slice(0, -1), { ...last, matches: [...last.matches, { ...recorded.match }] }];
}

/** V18-7: a return clears the saved departure, so a later departure is written afresh. */
function withoutSavedDeparture(t: Tournament, id: string): Tournament['passthrough'] {
  const extras = t.passthrough?.playerExtras[id];
  if (!t.passthrough || !extras) {
    return t.passthrough;
  }
  const playerExtras = { ...t.passthrough.playerExtras, [id]: extras.filter(([name]) => name !== 'dropped') };
  return { ...t.passthrough, playerExtras };
}

function entrantPod(t: Tournament, birthDate: string, ctx: LifecycleContext): Pod {
  const division = divisionFor(birthDate, ctx.season);
  const pod = t.pods.find(p => divisionsOf(p.category).includes(division));
  if (!pod) {
    throw new Error('No existing pod accepts the late entrant');
  }
  const last = latestRound(pod);
  if (pod.stage === 1 || (last && last.number >= regularRounds(t, pod) && (last.stage ?? 4) >= 4)) {
    throw new Error('Registration closed when the last Swiss round started');
  }
  return pod;
}

export function lateEntrant(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'late' }>,
  ctx: LifecycleContext
): Tournament {
  const { player } = op;
  if (!player.id || t.players.some(p => p.id === player.id)) {
    throw new Error('A late entrant needs a new player ID');
  }
  const birthDate = player.birthDate ?? '';
  const pod = entrantPod(t, birthDate, ctx);
  const last = latestRound(pod);
  const entry: Player = {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    birthDate,
    created: ctx.localTime,
    modified: ctx.localTime,
    droppedAfter: null,
    starter: false,
    tiebreaker: 0,
    scheduledSwissRounds: 0,
    ...(op.markLate
      ? {
          late: true,
          lateData: {
            round: last?.number ?? -1,
            timestamp: op.timestamp,
            forcedLoss: op.forcedLoss,
            usedForcedLoss: true
          }
        }
      : {})
  };
  const joined = addToFlight(pod, player.id, ctx.random, ctx.recorded?.flights?.[pod.category]);
  const rounds = joined.rounds.map(round => {
    const currentPaired = round === last && (round.stage ?? 4) < 4;
    if (currentPaired && !(op.markLate && op.forcedLoss)) {
      return round;
    }
    const loss: Match = { p1: player.id!, p2: null, outcome: 'loss', table: 0, timestamp: ctx.localTime };
    return checkedStage({ ...round, matches: [...round.matches, loss] });
  });
  return { ...replacePods(t, [rejoined(t, { ...joined, rounds }, player.id)]), players: [...t.players, entry] };
}

/** V17-7: a return restores a deleted result, or an unstarted elimination win, to pending. */
function restoredReturnMatch(round: Round, id: string, timestamp: string): Round {
  const unstarted = round.kind === 'elimination' && (round.stage ?? 4) < 4;
  const restored = (match: Match) =>
    (match.outcome === 'deleted' || (unstarted && ['p1', 'p2'].includes(match.outcome))) &&
    (match.p1 === id || match.p2 === id);
  if (!round.matches.some(restored)) {
    return round;
  }
  // V18-6: setting the result back to pending returns a round at 5 or later to 4.
  return checkedStage({
    ...round,
    matches: round.matches.map(match => (restored(match) ? { ...match, outcome: 'pending', timestamp } : match))
  });
}
