/**
 * A TOM-run event's round clocks are the site's own. TOM writes its timer
 * into the .tdf only when it saves, so a file read mid-round holds a time that
 * stood still at the last save, and most organizers never run TOM's timer at
 * all. Whatever clock a synced file carries is set aside: a round the site
 * already holds keeps the clock it has, and a round new from TOM starts
 * unstarted with its full time, for staff to run from the console.
 */

import { fullRoundSeconds } from './rounds.js';
import type { Pod, Round, Tournament } from './types.js';

const roundKey = (pod: Pod, round: Round) => `${pod.category}|${round.number}`;

function heldClocks(held: Tournament | null): Map<string, Round> {
  return new Map(held?.pods.flatMap(pod => pod.rounds.map(round => [roundKey(pod, round), round] as const)) ?? []);
}

/** `file` as TOM wrote it, with each round's clock the one `held` has for it, or a fresh one. */
export function withSiteClocks(file: Tournament, held: Tournament | null): Tournament {
  const clocks = heldClocks(held);
  const timed = (pod: Pod, round: Round): Round => {
    const kept = clocks.get(roundKey(pod, round));
    return {
      ...round,
      timeLeft: kept?.timeLeft ?? fullRoundSeconds(file, round.kind),
      startTime: kept?.startTime ?? '',
      clockStartedAt: kept?.clockStartedAt ?? null
    };
  };
  return { ...file, pods: file.pods.map(pod => ({ ...pod, rounds: pod.rounds.map(round => timed(pod, round)) })) };
}

type BareRound = Omit<Round, 'timeLeft' | 'startTime' | 'clockStartedAt'>;
type Unclocked = Omit<Tournament, 'pods'> & { pods: (Omit<Pod, 'rounds'> & { rounds: BareRound[] })[] };

/** The event without its clocks: what a TOM file and the site's copy are compared on. */
export function withoutClocks(tournament: Tournament): Unclocked {
  const bare = ({ timeLeft: _left, startTime: _start, clockStartedAt: _at, ...round }: Round): BareRound => round;
  return { ...tournament, pods: tournament.pods.map(pod => ({ ...pod, rounds: pod.rounds.map(bare) })) };
}
