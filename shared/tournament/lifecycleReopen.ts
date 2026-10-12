import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { replacePods, selectedPods } from './lifecycleWorkflow.js';
import { fullRoundSeconds, latestRound } from './rounds.js';
import type { Match, Pod, Round, Tournament } from './types.js';

function checkedMatch(t: Tournament, round: Round, op: Extract<LifecycleOperation, { type: 'reopen' }>): Match {
  if (op.round !== undefined && op.round !== round.number) {
    throw new Error('Only the current round can be reopened');
  }
  // A round completed by departures counts as started although it has no start time (PAIRING 43, 48).
  if ((round.stage ?? 4) < 4) {
    throw new Error('Start the round before reopening a result');
  }
  const match = round.matches.find(m =>
    op.player === undefined ? m.table === op.table : m.p1 === op.player || m.p2 === op.player
  );
  if (!match || match.p2 === null) {
    throw new Error('Only a two-seat match can be reopened');
  }
  if (match.outcome === 'pending') {
    throw new Error('The match is already pending');
  }
  if (
    match.outcome === 'deleted' &&
    [match.p1, match.p2].every(id => t.players.find(p => p.id === id)?.droppedAfter !== null)
  ) {
    throw new Error('Both players in the deleted match have dropped');
  }
  return match;
}

function targetPod(t: Tournament, op: Extract<LifecycleOperation, { type: 'reopen' }>): Pod {
  const pods = selectedPods(t, op.pod);
  if (op.pod !== undefined) {
    return pods[0]!;
  }
  const matches = pods.filter(pod =>
    latestRound(pod)?.matches.some(m =>
      op.player === undefined ? m.table === op.table : m.p1 === op.player || m.p2 === op.player
    )
  );
  if (matches.length !== 1) {
    throw new Error('Specify one pod and a match in its current round to reopen');
  }
  return matches[0]!;
}

/** The clock is not restarted (PAIRING 47); a round that never started keeps its unstarted clock. */
function reopenedClock(t: Tournament, round: Round, ctx: LifecycleContext): Partial<Round> {
  if (!round.startTime) {
    return {};
  }
  const startedAt = round.startedAt ?? Date.parse(round.startTime.replace(/^(\d{2})\/(\d{2})\/(\d{4}) /, '$3-$1-$2T'));
  return {
    startedAt,
    clockStartedAt: null,
    timeLeft: Math.max(0, fullRoundSeconds(t, round.kind) - Math.trunc((ctx.now - startedAt) / 1000))
  };
}

/** Explicit result editing; lossless document imports retain their saved stages. */
export function reopenResult(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'reopen' }>,
  ctx: LifecycleContext
): Tournament {
  const pods = [targetPod(t, op)].map(pod => {
    const round = latestRound(pod);
    if (!round) {
      throw new Error('There is no current round to reopen');
    }
    const match = checkedMatch(t, round, op);
    const changed: Round = {
      ...round,
      ...reopenedClock(t, round, ctx),
      stage: 4,
      status: 'started',
      matches: round.matches.map(m => (m === match ? { ...m, outcome: 'pending', timestamp: ctx.localTime } : m))
    };
    return { ...pod, rounds: pod.rounds.map(r => (r === round ? changed : r)) };
  });
  return replacePods(t, pods);
}
