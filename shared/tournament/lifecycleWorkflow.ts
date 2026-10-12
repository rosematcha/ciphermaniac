import { divisionLookup } from './divisions.js';
import { enteredResults, playoffPaired, survivorList } from './lifecycleSurvivors.js';
import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { checkedStage, countsComplete, fullRoundSeconds, latestRound, regularRounds } from './rounds.js';
import { DIVISIONS, type Match, type Pod, type Round, type Tournament } from './types.js';

export function selectedPods(t: Tournament, category: Pod['category'] | undefined): Pod[] {
  const pods = t.pods.filter(p => category === undefined || p.category === category);
  if (!pods.length) {
    throw new Error('There is no pod to change');
  }
  return pods;
}

export function replacePods(t: Tournament, pods: Pod[]): Tournament {
  const changed = new Map(pods.map(p => [p.category, p]));
  return { ...t, pods: t.pods.map(p => changed.get(p.category) ?? p) };
}

/** V18-5: TOM's view action advances only a paired round; the scenario operation steps from any stage. */
function pairingViewStage(pod: Pod, step: boolean): number {
  const stage = latestRound(pod)?.stage ?? 2;
  return step ? Math.min(8, stage + 1) : stage === 2 ? 3 : stage;
}

function stageFor(pod: Pod, op: WorkflowOperation): number {
  if (op.type === 'viewPairings') {
    return pairingViewStage(pod, op.step ?? false);
  }
  if (op.type === 'startRound') {
    return Math.max(4, latestRound(pod)?.stage ?? 2);
  }
  if (op.type === 'playAnotherRound') {
    return 7;
  }
  // The recorded report acknowledgment chooses the stage, never the round's position.
  return op.type === 'viewStandings' ? 8 : 6;
}

type WorkflowOperation = Extract<
  LifecycleOperation,
  { type: 'viewPairings' | 'startRound' | 'viewRecords' | 'viewStandings' | 'playAnotherRound' }
>;

export function finalPodRound(t: Tournament, pod: Pod, round: Round): boolean {
  return countsComplete(round) && scheduledFinal(t, pod, round);
}

/** The pod's last scheduled round, its cut finished, whatever its results: completion then finishes the pod. */
export function scheduledFinal(t: Tournament, pod: Pod, round: Round): boolean {
  if (round.kind === 'elimination') {
    return finalCut(t, pod, round);
  }
  return round.number >= regularRounds(t, pod) && (t.settings?.type !== 3 || pod.cut === 0);
}

function finalCut(t: Tournament, pod: Pod, round: Round): boolean {
  return requiredCutRounds(t, pod, round) && (t.settings?.type === 1 || finishedDivisions(t, pod));
}

/** V18-11: a cut is finished once each division keeps one surviving player, or two after its playoff. */
function finishedDivisions(t: Tournament, pod: Pod): boolean {
  const of = divisionLookup(t);
  const survivors = survivorList(t, pod);
  return DIVISIONS.every(division => {
    const count = survivors.filter(id => of(id) === division).length;
    return count <= (playoffPaired(pod, division) ? 2 : 1);
  });
}

function requiredCutRounds(t: Tournament, pod: Pod, round: Round): boolean {
  const swissRounds = pod.rounds.filter(r => r.kind === 'swiss').length;
  const size = t.settings?.type === 1 ? t.players.length : pod.cut;
  return round.kind === 'elimination' && round.number - swissRounds >= Math.ceil(Math.log2(size));
}

// The Prerelease acknowledgment writes 7 whatever the round's results, like the records and standings ones.
function checkedCompletedView(t: Tournament, operation: string): void {
  if (operation === 'playAnotherRound' && t.settings?.mode !== 'PRERELEASE') {
    throw new Error('Only Prerelease events can play another optional round');
  }
}

export function workflow(
  t: Tournament,
  op: Extract<
    LifecycleOperation,
    { type: 'viewPairings' | 'startRound' | 'viewRecords' | 'viewStandings' | 'playAnotherRound' }
  >,
  ctx: LifecycleContext
): Tournament {
  const pods = selectedPods(t, op.pod).map(pod => {
    const latest = latestRound(pod);
    if (!latest) {
      throw new Error('There is no round to view or start');
    }
    checkedCompletedView(t, op.type);
    const stage = stageFor(pod, op);
    const started =
      op.type === 'startRound' && stage === 4 && (latest.stage ?? 2) < 4
        ? { startTime: ctx.localTime, startedAt: ctx.now, clockStartedAt: ctx.now }
        : op.type === 'startRound' && stage === 4 && latest.clockStartedAt === null
          ? { clockStartedAt: ctx.now }
          : {};
    const round: Round = {
      ...latest,
      ...started,
      stage,
      status: stage >= 5 ? 'finished' : stage === 4 ? 'started' : 'paired'
    };
    return { ...pod, rounds: pod.rounds.map(r => (r === latest ? round : r)) };
  });
  const next = replacePods(t, pods);
  return next;
}

/**
 * V18-6: the operation stores its results one match at a time in list order, so a round still holding a pending
 * two-seat match after any of them returns to 4, even when the last one leaves none.
 */
function pendingBetween(before: readonly Match[], after: readonly Match[]): boolean {
  const changed = after.flatMap((match, i) => (match.outcome === before[i]!.outcome ? [] : [i]));
  return changed.some(index =>
    after.some((match, i) => match.p2 !== null && (i > index ? before[i]! : match).outcome === 'pending')
  );
}

/** A round can hold the same seats twice (V16-2), so a result names its table when the seats repeat. */
function resultFor(results: readonly Match[], match: Match, matches: readonly Match[]): Match | undefined {
  const seats = results.filter(r => r.p1 === match.p1 && r.p2 === match.p2);
  const repeated = matches.some(m => m !== match && m.p1 === match.p1 && m.p2 === match.p2);
  return repeated ? seats.find(r => r.table === match.table) : seats[0];
}

/** The round once the operation's results are stored, one match at a time in list order. */
function reportedRound(round: Round, matches: Match[]): Round {
  // A result entered on the site starts a round below 4; V18-6 governs rounds at 5 or later.
  const started = (round.stage ?? 4) < 4 && matches.some(m => m.outcome === 'pending');
  const reopened = (round.stage ?? 0) >= 5 && pendingBetween(round.matches, matches);
  const stage = started || reopened ? { stage: 4, status: 'started' as const } : {};
  // V18-6 follows only a result TOM stores; a refused attempt leaves the round's stage.
  const stored = matches.some((m, i) => m !== round.matches[i]);
  return stored ? checkedStage({ ...round, matches, ...stage }) : { ...round, matches, ...stage };
}

export function recordResults(t: Tournament, op: Extract<LifecycleOperation, { type: 'results' }>): Tournament {
  return replacePods(
    t,
    selectedPods(t, op.pod).map(pod => {
      const round = latestRound(pod);
      if (!round) {
        throw new Error('There is no round to report');
      }
      if (op.entryMode === 'main' && round.stage === 4 && round.clockStartedAt === null) {
        throw new Error('Continue the paused round before entering results in the main window');
      }
      if (!op.results.some(result => result.p2 !== null)) {
        return pod;
      }
      const matches = round.matches.map(match => {
        const result = resultFor(op.results, match, round.matches);
        if (!result) {
          return match;
        }
        if (round.kind === 'elimination' && result.outcome === 'tie') {
          throw new Error('An elimination match cannot tie');
        }
        const winner = result.outcome === 'p1' ? match.p1 : result.outcome === 'p2' ? match.p2 : undefined;
        if (round.kind === 'elimination' && winner && t.players.find(p => p.id === winner)?.droppedAfter !== null) {
          return match;
        }
        return { ...match, outcome: result.outcome, timestamp: result.timestamp };
      });
      const changed = reportedRound(round, matches);
      return { ...enteredResults(t, pod, op.results), rounds: pod.rounds.map(r => (r === round ? changed : r)) };
    })
  );
}

export function newRound(
  t: Tournament,
  pod: Pod,
  config: { matches: Round['matches']; kind: Round['kind'] },
  ctx: LifecycleContext
): Round {
  const { matches, kind } = config;
  const complete = matches.every(m => m.outcome !== 'pending');
  return {
    number: (latestRound(pod)?.number ?? 0) + 1,
    kind,
    status: complete ? 'finished' : 'paired',
    stage: complete && kind === 'swiss' ? 6 : complete ? 5 : 2,
    timeLeft: fullRoundSeconds(t, kind),
    pairTime: ctx.localTime,
    startTime: '',
    clockStartedAt: null,
    matches
  };
}
