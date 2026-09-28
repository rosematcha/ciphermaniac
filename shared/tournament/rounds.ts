/**
 * Reading a pod's rounds: which is current, who has played whom, who is still
 * in, and turning pairings into table-numbered matches.
 */

import type { Pairing, PairingHistory } from './pairing.js';
import { matchPoints, tallySwiss } from './standings.js';
import type { Match, Pod, Round, Tournament } from './types.js';

export function latestRound(pod: Pod): Round | undefined {
  return pod.rounds.at(-1);
}

export function isReported(match: Match): boolean {
  return match.outcome !== 'pending';
}

export function roundComplete(round: Round): boolean {
  return round.matches.every(isReported);
}

/** Opponents and byes from every Swiss round except `skipRound`. */
export function pairingHistory(pod: Pod, skipRound?: number): PairingHistory {
  const opponents = new Map<string, Set<string>>();
  const byes = new Set<string>();
  const meet = (a: string, b: string) => opponents.set(a, (opponents.get(a) ?? new Set()).add(b));
  for (const round of pod.rounds) {
    if (round.kind !== 'swiss' || round.number === skipRound) {
      continue;
    }
    for (const match of round.matches) {
      if (match.outcome === 'bye') {
        byes.add(match.p1);
      }
      if (match.p2 !== null) {
        meet(match.p1, match.p2);
        meet(match.p2, match.p1);
      }
    }
  }
  return { opponents, byes };
}

/** Match points per player over Swiss rounds before `beforeRound`. */
export function pointsBefore(pod: Pod, beforeRound: number): Map<string, number> {
  const tallies = tallySwiss(pod, beforeRound - 1);
  return new Map([...tallies].map(([id, tally]) => [id, matchPoints(tally.record)]));
}

/** Players in the pod who have not dropped. */
export function activeIds(tournament: Tournament, pod: Pod): string[] {
  const dropped = new Set(tournament.players.filter(p => p.droppedAfter !== null).map(p => p.id));
  return pod.playerIds.filter(id => !dropped.has(id));
}

export interface MatchStamp {
  /** First table to hand out. */
  firstTable: number;
  timestamp: string;
}

/**
 * Pairings as matches on consecutive tables. A bye sits at no table and is
 * already decided; so is a Swiss pairing that has no opponent.
 */
export function toMatches(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
  let table = stamp.firstTable;
  return pairings.map(({ p1, p2 }) => {
    if (p2 === null) {
      return { table: 0, p1, p2: null, outcome: 'bye', timestamp: stamp.timestamp };
    }
    const match: Match = { table, p1, p2, outcome: 'pending', timestamp: stamp.timestamp };
    table += 1;
    return match;
  });
}

/** Tables 1..n that no match in `kept` holds, in order, for the matches being re-paired. */
export function freeTables(kept: readonly Match[], count: number): number[] {
  const taken = new Set(kept.map(match => match.table));
  const tables: number[] = [];
  for (let table = 1; tables.length < count; table += 1) {
    if (!taken.has(table)) {
      tables.push(table);
    }
  }
  return tables;
}

/** Tables first, the bye and missed-round entries last. */
export function sortMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort((a, b) => (a.table || Infinity) - (b.table || Infinity));
}
