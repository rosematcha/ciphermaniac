/**
 * What the big screen shows, by where the event stands: everyone registered
 * before round 1, a round's tables once it is paired, the clock above them
 * once it starts, the results for the room to check once every table has
 * one, and the standings once the event ends.
 */

import type { PendingResult } from '../../../shared/tournament/view';
import type { Pod, Round } from '../../../shared/tournament/types';
import { podProgress } from './present';

export type ScreenPhase = 'roster' | 'paired' | 'clock' | 'results' | 'standings';

/** A round's clock has started once it has a start time, even if it was stopped since. */
const clockStarted = (round: Round): boolean => round.startTime !== '' || round.clockStartedAt != null;

/** The phase for the pods on the screen, each at its latest round. */
export function screenPhase(pods: readonly Pod[], pending: readonly PendingResult[], finished: boolean): ScreenPhase {
  const progress = pods.map(pod => podProgress(pod, pending)).filter(p => p.round !== undefined);
  if (!progress.length) {
    return 'roster';
  }
  if (finished) {
    return 'standings';
  }
  if (progress.every(p => p.tables > 0 && p.open === 0)) {
    return 'results';
  }
  return progress.some(p => clockStarted(p.round as Round)) ? 'clock' : 'paired';
}
