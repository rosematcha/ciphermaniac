import { configureEvent, createEvent, registerPlayers, setFlights, startEvent } from './lifecycleConfiguration.js';
import { reloadEvent } from './lifecycleReload.js';
import { sampleClock } from './lifecycleClock.js';
import { bracketPlayers, initializeCuts, nextElimination, startEliminationOnly } from './lifecycleElimination.js';
import { repairElimination } from './lifecycleEliminationRepair.js';
import { pairFreshSwiss, RetriedRound, UnpairedRound } from './lifecycleAttempts.js';
import { pairSwissPods } from './lifecyclePairing.js';
import { dropEntrant, lateEntrant, reenterEntrant } from './lifecyclePlayers.js';
import { packRepairTables, packTables, prepareTables } from './lifecycleTables.js';
import type { LifecycleContext, LifecycleOperation, LifecycleResult } from './lifecycleTypes.js';
import { reopenResult } from './lifecycleReopen.js';
import { checkedSurvivors, confirmedSurvivors } from './lifecycleSurvivors.js';
import { finalPodRound, recordResults, replacePods, selectedPods, workflow } from './lifecycleWorkflow.js';
import { writeTdf } from './tdf.js';
import { countsComplete, latestRound, regularRounds, savedStages, wasFinalized } from './rounds.js';
import type { Match, Round, Tournament } from './types.js';

/** V18-12: the cut follows the last Swiss round once that round counts as complete. */
const completedSwiss = (pod: Tournament['pods'][number]) => countsComplete(latestRound(pod));

function pair(t: Tournament, op: Extract<LifecycleOperation, { type: 'pair' }>, ctx: LifecycleContext): Tournament {
  if (op.repair && ctx.recorded?.repairError) {
    throw new Error('The repair aborted and its save could not complete; retain the last successful save');
  }
  const context = { ...ctx, terminalPairing: op.terminal };
  if (op.terminal) {
    return terminalPair(t, op, context);
  }
  const prepared = prepareTables(op.repair ? packRepairTables(t, op.pod) : t, op.pod);
  const paired = terminalPair(prepared, op, context);
  return op.repair ? paired : packTables(paired, op.pod);
}

function terminalPair(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'pair' }>,
  ctx: LifecycleContext
): Tournament {
  const pods = selectedPods(t, op.pod);
  // A pod in its cut stays there after a Swiss round V16-2 appends during it.
  if (t.settings?.type === 1 || pods.some(p => p.rounds.some(r => r.kind === 'elimination'))) {
    return eliminationPair(t, op, ctx);
  }
  const atCut =
    !op.repair &&
    t.settings?.type === 3 &&
    pods.every(p => p.cut > 0 && completedSwiss(p) && latestRound(p)!.number >= regularRounds(t, p));
  if (atCut) {
    return initializeCuts(t, op.pod, ctx);
  }
  return op.repair ? pairSwissPods(t, op.pod, ctx, true) : pairFreshSwiss(t, op.pod, ctx);
}

/** V16-2 and V18-12: an elimination round that does not count as complete is followed by a Swiss round. */
function eliminationPair(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'pair' }>,
  ctx: LifecycleContext
): Tournament {
  if (op.repair) {
    return repairElimination(t, op.pod, ctx);
  }
  if (t.settings?.type === 1) {
    return nextElimination(t, op.pod, ctx);
  }
  // V24-2: a cut pairing request checks the pod's list first; one that appends a Swiss round does not.
  const pods = selectedPods(t, op.pod);
  return pods.every(completedSwiss)
    ? nextElimination(
        replacePods(
          t,
          pods.map(pod => confirmedSurvivors(t, pod))
        ),
        op.pod,
        ctx
      )
    : pairFreshSwiss(t, op.pod, ctx);
}

function startedCut(
  t: Tournament,
  category: Extract<LifecycleOperation, { type: 'topCut' }>['pod'],
  ctx: LifecycleContext
): Tournament {
  // V22-2: starting the top cut is a pairing request, so a pod already in its cut pairs its next cut round.
  if (selectedPods(t, category).every(pod => pod.rounds.some(round => round.kind === 'elimination'))) {
    return pair(t, { type: 'pair', pod: category }, ctx);
  }
  const cut = initializeCuts(prepareTables(t, category), category, ctx);
  return cut.pods.some(p => p.rounds.length > t.pods.find(old => old.category === p.category)!.rounds.length)
    ? packTables(cut, category)
    : cut;
}

/** Reopening discards uninterrupted preferences, so a reload never takes a recorded order. */
function recordedDisqualifiedOrder(t: Tournament, op: LifecycleOperation, ctx: LifecycleContext): Tournament {
  const lists = ctx.recorded?.disqualifiedNameOrder;
  if (!lists || op.type === 'reload') {
    return t;
  }
  const order = new Map(lists.flatMap(ids => ids.map((id, i) => [id, i + 1] as const)));
  return { ...t, players: t.players.map(p => (order.has(p.id) ? { ...p, disqualifiedOrder: order.get(p.id)! } : p)) };
}

function start(t: Tournament, ctx: LifecycleContext): LifecycleResult {
  const started = startEvent(t, ctx);
  if (!started.players.length) {
    return { ok: true, tournament: started };
  }
  if (started.settings?.type === 1) {
    return attemptedStart(() => startEliminationOnly(started, ctx), started);
  }
  return attemptedStart(() => pairFreshSwiss(started, undefined, ctx), started);
}

/** V18-2: a start whose later attempt pairs still starts, at stage 1; failed attempts keep their used awards. */
function attemptedStart(paired: () => Tournament, aborted: Tournament): LifecycleResult {
  try {
    return { ok: true, tournament: savedStages(paired()) };
  } catch (error) {
    if (error instanceof RetriedRound) {
      return { ok: true, tournament: savedStages(error.tournament) };
    }
    return refused(error instanceof UnpairedRound ? withUnsavedAttempts(aborted, error.tournament) : aborted, error);
  }
}

function refused(tournament: Tournament, error: unknown): LifecycleResult {
  return { ok: false, tournament, error: error instanceof Error ? error.message : 'The operation could not complete' };
}

type Handlers = {
  [K in LifecycleOperation['type']]: (
    t: Tournament,
    op: Extract<LifecycleOperation, { type: K }>,
    ctx: LifecycleContext
  ) => Tournament;
};

function completedPod(t: Tournament, pod: Tournament['pods'][number]): boolean {
  const last = latestRound(pod);
  return Boolean(last && (last.stage ?? 0) >= 5 && (t.settings?.mode === 'PRERELEASE' || finalPodRound(t, pod, last)));
}

const handlers: Handlers = {
  create: (_t, op) => createEvent(op),
  register: (t, op, ctx) => registerPlayers(t, op, ctx),
  configure: (t, op, ctx) => configureEvent(t, op, ctx),
  setFlights: (t, op) => setFlights(t, op),
  start: (t, _op, ctx) => startEvent(t, ctx),
  pair: (t, op, ctx) => pair(t, op, ctx),
  viewPairings: (t, op, ctx) => workflow(t, op, ctx),
  startRound: (t, op, ctx) => workflow(t, op, ctx),
  viewRecords: (t, op, ctx) => workflow(t, op, ctx),
  viewStandings: (t, op, ctx) => workflow(t, op, ctx),
  playAnotherRound: (t, op, ctx) => workflow(t, op, ctx),
  reopen: (t, op, ctx) => reopenResult(t, op, ctx),
  sampleClock: (t, op, ctx) => sampleClock(t, op, ctx),
  reload: (t, op, ctx) => reloadEvent(t, ctx, op),
  results: (t, op) => recordResults(t, op),
  drop: (t, op, ctx) => dropEntrant(t, op, ctx),
  reenter: (t, op, ctx) => reenterEntrant(t, op, ctx),
  late: (t, op, ctx) => lateEntrant(t, op, ctx),
  topCut: (t, op, ctx) => startedCut(t, op.pod, ctx),
  finish: t => {
    if (!t.settings || t.pods.some(p => !completedPod(t, p))) {
      throw new Error('Report every result before finishing');
    }
    return { ...t, settings: { ...t.settings, stage: 5 } };
  }
};

/** An elimination tie order is a checkpoint choice: each save applies only the one recorded with it. */
function withRecordedOrders(t: Tournament, ctx: LifecycleContext): Tournament {
  const { eliminationTieOrder: _stale, thirdPlaceOrder: _saved, ...rest } = t;
  const ties = ctx.recorded?.eliminationTieOrder;
  const finished = ctx.recorded?.thirdPlaceOrder;
  return {
    ...rest,
    ...(ties ? { eliminationTieOrder: ties } : {}),
    ...(finished ? { thirdPlaceOrder: finished } : {})
  };
}

function completedOperation(t: Tournament, ctx: LifecycleContext): LifecycleResult {
  const recorded = ctx.recorded?.headToHeadOrder ? { ...t, headToHeadOrder: ctx.recorded.headToHeadOrder } : t;
  const tournament = savedStages(recorded);
  if (wasFinalized(tournament)) {
    writeTdf(tournament, { now: ctx.now });
  }
  return { ok: true, tournament };
}

/** A refusal persists what TOM keeps: awards used by failed attempts, and a round saved by a retry (V18-2). */
function failedOperation(t: Tournament, error: unknown, ctx: LifecycleContext): LifecycleResult {
  const kept =
    error instanceof RetriedRound
      ? savedStages(error.tournament)
      : error instanceof UnpairedRound
        ? withUnsavedAttempts(t, error.tournament)
        : t;
  return {
    ...refused(kept, error),
    ...(ctx.recorded?.repairError ? { saveFailed: true } : {}),
    ...(error instanceof RetriedRound ? { retried: true } : {})
  };
}

function withUnsavedAttempts(t: Tournament, attempted: Tournament): Tournament {
  return {
    ...t,
    players: attempted.players,
    pods: t.pods.map(pod => {
      const { unsavedByes, unsavedPlayers, unsavedRandomByes } =
        attempted.pods.find(p => p.category === pod.category) ?? pod;
      return {
        ...pod,
        ...(unsavedByes ? { unsavedByes } : {}),
        ...(unsavedPlayers ? { unsavedPlayers } : {}),
        ...(unsavedRandomByes ? { unsavedRandomByes } : {})
      };
    })
  };
}

const matchKey = (round: Round, match: Match) => `${round.number}:${match.p1}:${match.p2 ?? ''}`;

/** V22-1: a new match first restores its players' records from their completed matches. */
function restoredRecords(before: Tournament, after: Tournament): Tournament {
  return {
    ...after,
    pods: after.pods.map(pod => {
      if (!pod.lostRecords?.length) {
        return pod;
      }
      const old = before.pods.find(p => p.category === pod.category);
      const known = new Set(old?.rounds.flatMap(r => r.matches.map(m => matchKey(r, m))) ?? []);
      const seated = new Set(
        pod.rounds.flatMap(r => r.matches.filter(m => !known.has(matchKey(r, m))).flatMap(m => [m.p1, m.p2]))
      );
      const { lostRecords, ...rest } = pod;
      const lost = lostRecords.filter(id => !seated.has(id));
      return lost.length ? { ...rest, lostRecords: lost } : rest;
    })
  };
}

function finishedEvent(t: Tournament): boolean {
  return wasFinalized(t) && t.pods.every(pod => completedPod(t, pod));
}

/** V24-2: pairings, repairs and finish requests check every pod's cut list before acting; every save checks again. */
function handledOperation(t: Tournament, op: LifecycleOperation, ctx: LifecycleContext): Tournament {
  const handler = handlers[op.type] as (t: Tournament, op: LifecycleOperation, ctx: LifecycleContext) => Tournament;
  const checking = ['pair', 'topCut', 'finish'].includes(op.type);
  const handled = handler(checking ? checkedSurvivors(t) : t, op, ctx);
  // A reading's checkpoint is TOM's next save of the reopened event, so it checks too.
  return checkedSurvivors(handled);
}

/** Applies one organizer operation atomically; refusals carry the persisted state. */
export function applyLifecycleOperation(t: Tournament, op: LifecycleOperation, ctx: LifecycleContext): LifecycleResult {
  try {
    if (op.type === 'start') {
      return start(t, ctx);
    }
    const aborted = abortedRepair(t, op, ctx);
    if (aborted) {
      return aborted;
    }
    // A repair still returns an acknowledged complete round unchanged after the finish (PAIRING V14b); a pod that
    // reopening left with a pending match is not finished and still pairs (V16-2, statement 49).
    if (((op.type === 'pair' && !op.repair) || op.type === 'topCut') && finishedEvent(t)) {
      throw new Error('The tournament is complete');
    }
    const tournament = handledOperation(t, op, ctx);
    if (
      (op.type === 'topCut' || (op.type === 'pair' && !op.repair)) &&
      tournament.pods.every(p => p.rounds.length === t.pods.find(old => old.category === p.category)?.rounds.length)
    ) {
      return { ok: false, tournament, error: 'No eligible qualifiers can form another round' };
    }
    const ordered = recordedDisqualifiedOrder(withRecordedOrders(restoredRecords(t, tournament), ctx), op, ctx);
    return completedOperation(ordered, ctx);
  } catch (error) {
    return failedOperation(t, error, ctx);
  }
}

/** V17-6: a recorded random abort persists the completed part of the repair. */
function abortedRepair(t: Tournament, op: LifecycleOperation, ctx: LifecycleContext): LifecycleResult | undefined {
  const recorded = ctx.recorded?.abortedRepair;
  if (op.type !== 'pair' || !op.repair || !recorded) {
    return undefined;
  }
  const pods = t.pods.map(pod => {
    const matches = recorded[pod.category];
    const last = latestRound(pod);
    return matches && last
      ? { ...pod, rounds: pod.rounds.map(r => (r === last ? { ...r, matches: [...matches] } : r)) }
      : pod;
  });
  const order = ctx.recorded?.abortedBracketOrder;
  const pairings = order?.map(p1 => ({ p1, p2: null }));
  const players = order && pairings ? bracketPlayers(t.players, [...order], pairings, false) : t.players;
  return refused({ ...t, pods, players }, new Error('The repair aborted while ordering matches'));
}
