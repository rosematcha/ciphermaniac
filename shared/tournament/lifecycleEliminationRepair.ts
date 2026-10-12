/**
 * PAIRING V18-10: repairs of elimination rounds. An opening round keeps its matches once complete and draws a new
 * bracket after them; a later round is emptied and paired again from its players.
 */

import { divisionLookup } from './divisions.js';
import {
  type Bracket,
  bracketPairings,
  bracketPlayers,
  nextBracket,
  playoffCandidates
} from './lifecycleElimination.js';
import { playoffPlayers, survivorList, twoSeatLosers } from './lifecycleSurvivors.js';
import { createdStage, finishedAtRepair, momentRange, repairedStage, repairStamp } from './lifecyclePairing.js';
import type { LifecycleContext } from './lifecycleTypes.js';
import { replacePods, selectedPods } from './lifecycleWorkflow.js';
import { type Pairing, PairingError, pairTopCut } from './pairing.js';
import { shuffled } from './random.js';
import { countsComplete, latestRound, seatPairings } from './rounds.js';
import {
  DIVISIONS,
  type Match,
  type Player,
  type Pod,
  type PodCategory,
  type Round,
  type Tournament
} from './types.js';

interface Repaired {
  pod: Pod;
  players: Player[];
}

const seatsOf = (pairings: readonly Pairing[]) => pairings.flatMap(p => (p.p2 === null ? [p.p1] : [p.p1, p.p2]));

/** V16-3: a terminal repair attempt is refused at stages 4 and 5, the ordinary repair once the round started. */
function checkedRepair(round: Round | undefined, ctx: LifecycleContext): Round {
  const stage = round?.stage ?? 4;
  if (!round || (ctx.terminalPairing ? [4, 5].includes(stage) : stage >= 4)) {
    throw new PairingError('Only a paired, not-started elimination round can be repaired');
  }
  return round;
}

/** A recorded draw replaces the computed order when it seats the same players (V18-10's recorded choices). */
function recordedOrder(pod: Pod, computed: Pairing[], ctx: LifecycleContext, kept: readonly Match[]): Pairing[] {
  const recorded = ctx.recorded?.pairings?.[pod.category];
  if (!recorded) {
    return computed;
  }
  const retained = recorded.slice(0, kept.length);
  if (kept.some((m, i) => m.p1 !== retained[i]?.p1 || m.p2 !== retained[i]?.p2)) {
    throw new PairingError('Recorded opening repairs must keep their retained matches first');
  }
  const fresh = recorded.slice(kept.length);
  const expected = seatsOf(computed).sort();
  const seats = seatsOf(fresh).sort();
  if (seats.length !== expected.length || seats.some((id, i) => id !== expected[i])) {
    throw new PairingError('Recorded elimination seats must cover the repaired field exactly once');
  }
  return [...fresh];
}

function divisionLists(t: Tournament, ids: readonly string[]): string[][] {
  const of = divisionLookup(t);
  return [...DIVISIONS].reverse().map(division => ids.filter(id => of(id) === division));
}

/** The opening draw: the whole list of an elimination-only pod, or each division's survivors by seed. */
function openingDraw(t: Tournament, pod: Pod, ctx: LifecycleContext): Pairing[][] {
  const survivors = survivorList(t, pod);
  if (t.settings?.type === 1) {
    return survivors.length >= 2 ? [pairTopCut(shuffled(survivors, ctx.random))] : [];
  }
  const seed = new Map(t.players.map(p => [p.id, p.seed ?? 0]));
  return divisionLists(t, survivors)
    .map(ids => [...ids].sort((a, b) => (seed.get(a) ?? 0) - (seed.get(b) ?? 0)))
    .filter(ids => ids.length >= 2)
    .map(ids => pairTopCut(ids));
}

function repairedOpening(t: Tournament, pod: Pod, round: Round, ctx: LifecycleContext): Repaired {
  const firstBye = round.matches.find(m => m.outcome === 'bye');
  const remaining = round.matches.filter(m => m !== firstBye);
  const kept = countsComplete({ ...round, matches: remaining }) ? remaining : [];
  const draws = openingDraw(t, pod, ctx);
  const history = { ...pod, rounds: pod.rounds.filter(r => r !== round) };
  const brackets = draws.map(pairings => {
    const [p1, p2] = playoffCandidates(t, history, seatsOf(pairings));
    return { pairings, ...(p1 && p2 ? { playoff: { p1, p2 } } : {}) };
  });
  const computed = brackets.flatMap(bracketPairings);
  const pairings = t.settings?.type === 1 ? recordedOrder(pod, computed, ctx, kept) : computed;
  const ordered = pairings.filter(p => !brackets.some(b => b.playoff?.p1 === p.p1 && b.playoff.p2 === p.p2));
  const groups = t.settings?.type === 1 ? [ordered] : draws;
  const players = groups.reduce((current, group) => bracketPlayers(current, seatsOf(group), group, false), t.players);
  const paired = brackets.reduce((current, bracket) => {
    // V19-3: Swiss opponents can belong to another division; the drawn finalists own the playoff flag.
    const added = playoffPlayers(t, current, bracket.playoff, divisionLookup(t)(bracket.pairings[0]!.p1));
    return bracket.playoff
      ? { ...added, survivors: [...survivorList(t, added), ...seatsOf([bracket.playoff])] }
      : added;
  }, pod);
  const counted = replacePods(t, [paired]);
  const repaired = repairedRound(counted, paired, { round, kept, pairings }, ctx);
  return { pod: { ...repaired, historyOmittedRound: round.number }, players };
}

/** The players of a later round: waiting survivors, the first bye holder, then every seat of the other matches. */
function laterField(t: Tournament, pod: Pod, round: Round): string[] {
  const order = new Map(t.players.map(p => [p.id, p.order ?? 0]));
  const roster = new Map(t.players.map((p, i) => [p.id, i]));
  const seated = new Set(seatsOf(round.matches));
  const lost = twoSeatLosers(pod);
  const waiting =
    t.settings?.type === 1
      ? survivorList(t, pod)
          .filter(id => !seated.has(id) && !lost.has(id))
          .sort((a, b) => (roster.get(a) ?? 0) - (roster.get(b) ?? 0))
      : [];
  const firstBye = round.matches.find(m => m.outcome === 'bye');
  const previous = pod.rounds.find(r => r.number === round.number - 1);
  const deleted = (previous?.matches ?? []).filter(m => m.outcome === 'deleted').map(m => m.p1);
  // V18-10 lists players: a playoff that repeats the final seats its players once (V19-1).
  const field = new Set([
    ...waiting,
    ...(firstBye ? [firstBye.p1] : []),
    ...seatsOf(round.matches.filter(m => m !== firstBye)),
    ...deleted
  ]);
  return [...field].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * V18-10: a later repair attempts a playoff only for a field of exactly two; a top cut counts it once an odd
 * field's bye holder has left (V24-3). Its finalists' histories keep the dissolved matches but not the random bye
 * the repair removes first.
 */
function repairPlayoff(t: Tournament, pod: Pod, field: readonly string[]): Pod {
  const counted = t.settings?.type === 1 ? field.length : field.length - (field.length % 2);
  return counted === 2 ? pod : { ...pod, playoff3rd4th: false };
}

function dissolvedHistory(pod: Pod, round: Round): Pod {
  const firstBye = round.matches.find(m => m.outcome === 'bye');
  const kept = { ...round, matches: round.matches.filter(m => m !== firstBye) };
  return { ...pod, rounds: pod.rounds.map(r => (r === round ? kept : r)) };
}

function repairedLater(t: Tournament, original: Pod, round: Round, ctx: LifecycleContext): Repaired {
  const field = laterField(t, original, round);
  const pod = dissolvedHistory(original, round);
  const swiss = pod.rounds.filter(r => r.kind === 'swiss').length;
  const brackets: Bracket[] =
    t.settings?.type === 1
      ? [nextBracket(t, repairPlayoff(t, pod, field), field, false)].filter(b => b !== undefined)
      : divisionLists(t, field).flatMap(list => {
          const size = pod.divisionCuts?.[divisionLookup(t)(list[0] ?? '')]?.size ?? pod.cut;
          const bracket = list.length
            ? nextBracket(
                t,
                repairPlayoff(t, pod, list),
                list,
                round.number > swiss + Math.ceil(Math.log2(Math.max(size, 1)))
              )
            : undefined;
          return bracket ? [bracket] : [];
        });
  const computed = brackets.flatMap(bracketPairings);
  const pairings = t.settings?.type === 1 ? recordedOrder(pod, computed, ctx, []) : computed;
  // A playoff the repair pairs counts its players before tables are numbered (V16-11).
  const paired = brackets.reduce((current, bracket) => playoffPlayers(t, current, bracket.playoff), original);
  const counted = replacePods(t, [paired]);
  const repaired = repairedRound(counted, paired, { round, kept: [], pairings }, ctx);
  const dissolved = new Map(
    round.matches
      .filter(m => m.p2 !== null)
      .flatMap(
        m =>
          [
            [m.p1, m.p2!],
            [m.p2!, m.p1]
          ] as [string, string][]
      )
  );
  const affected = [
    ...(original.dissolvedOpponents ?? []).filter(entry => !dissolved.has(entry.playerId)),
    ...[...dissolved].map(([playerId, opponentId]) => ({ playerId, opponentId, round: round.number }))
  ];
  return { pod: { ...repaired, dissolvedOpponents: affected }, players: t.players };
}

/**
 * Number the new matches around the kept ones (V18-9 for a finished pod). A created bye returns a round at 5 or
 * later to 4 (V18-6); otherwise a terminal attempt keeps the stage and the ordinary repair saves 2.
 */
function repairedRound(
  t: Tournament,
  pod: Pod,
  repair: { round: Round; kept: readonly Match[]; pairings: readonly Pairing[] },
  ctx: LifecycleContext
): Pod {
  const { round, kept, pairings } = repair;
  const created = createdStage(round, {
    list: kept,
    fresh: pairings.filter(p => p.p2 === null).map(p => ({ ...p, outcome: 'pending', table: 0, timestamp: '' }))
  });
  const moment = finishedAtRepair(t, pod, created, kept);
  const fresh = seatPairings(pairings, {
    ...repairStamp(t, pod, ctx, new Set(kept.filter(m => m.p2 !== null).map(m => m.table))),
    ignoreFixed: t.settings?.type !== 1,
    ...momentRange(t, pod, { ...round, stage: moment.stage, matches: [...kept] })
  });
  const numbered =
    moment.finished && t.settings?.autoTables ? fresh.map(m => (m.p2 === null ? m : { ...m, table: 0 })) : fresh;
  const matches = [...kept, ...numbered];
  const stage = repairedStage(moment.stage, ctx);
  const repaired: Round = { ...round, matches, stage, status: stage >= 5 ? 'finished' : 'paired' };
  return { ...pod, rounds: pod.rounds.map(r => (r === round ? repaired : r)) };
}

export function repairElimination(t: Tournament, category: PodCategory | undefined, ctx: LifecycleContext): Tournament {
  let { players } = t;
  const pods = selectedPods(t, category).map(pod => {
    const round = checkedRepair(latestRound(pod), ctx);
    const previous = pod.rounds.find(r => r.number === round.number - 1);
    const opening = !previous || previous.kind === 'swiss';
    const current = { ...t, players };
    const repaired = opening ? repairedOpening(current, pod, round, ctx) : repairedLater(current, pod, round, ctx);
    ({ players } = repaired);
    return repaired.pod;
  });
  return { ...replacePods(t, pods), players };
}
