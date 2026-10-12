/**
 * PAIRING V17-8 and V18-2: a Swiss pairing request makes up to k attempts. A failed attempt uses the assigned-bye
 * awards it handed out and leaves unsaved matches that count for their players until the file is reopened.
 */

import { FlightFailure, flightField, swissRound, validateSwissRound } from './lifecyclePairing.js';
import type { LifecycleContext } from './lifecycleTypes.js';
import { replacePods, selectedPods } from './lifecycleWorkflow.js';
import { PairingError } from './pairing.js';
import { latestRound, pairingHistory } from './rounds.js';
import type { Pod, PodCategory, Round, Tournament } from './types.js';

/** Every attempt failed: nothing is appended, but the awards the attempts used stay used. */
export class UnpairedRound extends PairingError {
  constructor(
    message: string,
    readonly tournament: Tournament
  ) {
    super(message);
  }
}

/** A later attempt succeeded: its round is saved at stage 1, yet TOM reports that no round was paired. */
export class RetriedRound extends Error {
  constructor(readonly tournament: Tournament) {
    super('The pairing succeeded only on a retry and reports no round');
  }
}

/** One attempt, plus one for each whole number t of at least 2 below log2 of the pod's registered players. */
export function attemptCount(pod: Pod): number {
  return 1 + Math.max(0, Math.ceil(Math.log2(Math.max(pod.playerIds.length, 1))) - 2);
}

type Flight = NonNullable<Pod['flights']>[number];

const podFlights = (pod: Pod): Flight[] =>
  pod.flights?.length ? pod.flights : [{ number: 1, playerIds: pod.playerIds }];

/** The first flight left with nobody to pair once its holders receive their assigned byes. */
function emptiedFlight(t: Tournament, pod: Pod, number: number, ctx: LifecycleContext): number | undefined {
  const index = podFlights(pod).findIndex(
    flight => !flightField(t, pod, { number, ids: flight.playerIds, kept: [], repair: false }, ctx).entrants.length
  );
  return index < 0 ? undefined : index;
}

/**
 * A failed attempt reached the flights up to `failed`: their holders used an award on an unsaved assigned bye,
 * and the members of the flights before it were paired in unsaved matches.
 */
function failedAttempt(t: Tournament, pod: Pod, failed: number, ctx: LifecycleContext): Tournament {
  const number = (latestRound(pod)?.number ?? 0) + 1;
  const reached = podFlights(pod).slice(0, failed + 1);
  const fields = reached.map(f => flightField(t, pod, { number, ids: f.playerIds, kept: [], repair: false }, ctx));
  const holders = new Set(fields.flatMap(field => field.assigned));
  const paired = fields.slice(0, failed).flatMap(field => field.entrants.map(e => e.id));
  const randomBye = failedRandomBye(pod, fields[failed]?.entrants ?? [], number);
  const changed: Pod = {
    ...pod,
    ...(randomBye ? { unsavedRandomByes: [...(pod.unsavedRandomByes ?? []), randomBye] } : {}),
    unsavedByes: [...(pod.unsavedByes ?? []), ...[...holders].map(playerId => ({ round: number, playerId }))],
    unsavedPlayers: [...new Set([...(pod.unsavedPlayers ?? []), ...holders, ...paired])]
  };
  return {
    ...replacePods(t, [changed]),
    players: t.players.map(p => (holders.has(p.id) ? { ...p, forfeitedByes: (p.forfeitedByes ?? 0) + 1 } : p))
  };
}

/**
 * V22-4: a failed attempt over an odd field leaves its random bye in its holder's record. Only a field with one
 * player still without a random bye names that holder; any other holder is a recorded choice.
 */
function failedRandomBye(pod: Pod, entrants: readonly { id: string }[], number: number): string | undefined {
  if (entrants.length % 2 === 0) {
    return undefined;
  }
  const { byes } = pairingHistory(pod, number);
  const eligible = entrants.filter(e => !byes.has(e.id));
  return eligible.length === 1 ? eligible[0]!.id : undefined;
}

function failedFlight(pod: Pod, error: unknown): number {
  if (!(error instanceof FlightFailure)) {
    throw error;
  }
  const index = podFlights(pod).findIndex(f => f.playerIds.join() === error.flight.join());
  return index < 0 ? podFlights(pod).length - 1 : index;
}

function retriedRound(pod: Pod): Pod {
  const last = latestRound(pod)!;
  const round: Round = { ...last, stage: 1, status: 'paired' };
  return { ...pod, rounds: pod.rounds.map(r => (r === last ? round : r)) };
}

/** Pair one pod's next Swiss round; a recorded search that gives up fails every attempt (V17-8). */
function attemptedPod(
  t: Tournament,
  category: PodCategory,
  ctx: LifecycleContext
): { t: Tournament; retried: boolean } {
  let current = t;
  const attempts = attemptCount(selectedPods(t, category)[0]!);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const pod = selectedPods(current, category)[0]!;
    validateSwissRound(current, pod, false, ctx.terminalPairing ?? false);
    const number = (latestRound(pod)?.number ?? 0) + 1;
    // An emptied flight is known before any search; an earlier flight's search failure is not saved (V17-8).
    const emptied = emptiedFlight(current, pod, number, ctx);
    if (emptied !== undefined || ctx.recorded?.noRound) {
      current = failedAttempt(current, pod, emptied ?? podFlights(pod).length - 1, ctx);
      continue;
    }
    try {
      const paired = swissRound(current, pod, ctx);
      return { t: replacePods(current, [attempt > 1 ? retriedRound(paired) : paired]), retried: attempt > 1 };
    } catch (error) {
      current = failedAttempt(current, pod, failedFlight(pod, error), ctx);
    }
  }
  throw new UnpairedRound('No more rounds can be paired', current);
}

/** Fresh Swiss rounds for the selected pods; any pod that cannot pair stops the request. */
export function pairFreshSwiss(t: Tournament, category: PodCategory | undefined, ctx: LifecycleContext): Tournament {
  let retried = false;
  const paired = selectedPods(t, category).reduce((current, pod) => {
    const result = attemptedPod(current, pod.category, ctx);
    retried ||= result.retried;
    return result.t;
  }, t);
  if (retried) {
    throw new RetriedRound(paired);
  }
  return paired;
}
