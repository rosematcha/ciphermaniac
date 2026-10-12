import { isTomDateTime, shiftTomDateTime } from './divisions.js';
import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { replacePods, selectedPods } from './lifecycleWorkflow.js';
import { latestRound } from './rounds.js';
import type { Round, Tournament } from './types.js';

/**
 * Moves the current rounds' clock origin so `seconds` have elapsed at `ctx.now`.
 * Pairings, results and stages stay as they are; later restarts and reopenings keep the new origin.
 */
export function sampleClock(
  t: Tournament,
  op: Extract<LifecycleOperation, { type: 'sampleClock' }>,
  ctx: LifecycleContext
): Tournament {
  if (!Number.isSafeInteger(op.seconds) || op.seconds < 0 || !isTomDateTime(ctx.localTime)) {
    throw new Error('A clock sample needs a nonnegative number of elapsed seconds');
  }
  // A round completed by departures has passed its start although it was never started (PAIRING 43).
  const pods = selectedPods(t, op.pod).filter(pod => {
    const round = latestRound(pod);
    return round && (round.startTime || (round.stage ?? 4) >= 4);
  });
  if (!pods.length) {
    throw new Error('Start the round before sampling its clock');
  }
  return replacePods(
    t,
    pods.map(pod => {
      const round = latestRound(pod)!;
      const startedAt = ctx.now - op.seconds * 1000;
      const sampled: Round = {
        ...round,
        startTime: shiftTomDateTime(ctx.localTime, -op.seconds),
        startedAt,
        ...(typeof round.clockStartedAt === 'number' ? { clockStartedAt: startedAt } : {})
      };
      return { ...pod, rounds: pod.rounds.map(r => (r === round ? sampled : r)) };
    })
  );
}
