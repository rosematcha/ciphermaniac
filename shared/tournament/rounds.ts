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

/** Whether a player has sat a match or had a bye in the pod: more than the rounds they missed by joining late. */
export function hasPlayed(pod: Pod | undefined, id: string): boolean {
  return (pod?.rounds ?? []).some(round =>
    round.matches.some(match => (match.p1 === id || match.p2 === id) && match.outcome !== 'loss')
  );
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
  /** Players with a fixed table (see Player.fixedTable). */
  fixed?: ReadonlyMap<string, number>;
  /** Tables already in use this round, by matches a re-pair keeps. */
  taken?: ReadonlySet<number>;
}

/** Each player's fixed table, for the players who have one. */
export function fixedTables(tournament: Tournament): Map<string, number> {
  return new Map(tournament.players.flatMap(p => (p.fixedTable ? [[p.id, p.fixedTable] as const] : [])));
}

/** The fixed table a pairing claims: player one's, else player two's, if still free. */
function claimed(pairing: Pairing, stamp: MatchStamp, used: ReadonlySet<number>): number | undefined {
  const tables = [stamp.fixed?.get(pairing.p1), pairing.p2 === null ? undefined : stamp.fixed?.get(pairing.p2)];
  return tables.find((table): table is number => table !== undefined && !used.has(table));
}

/**
 * Pairings as table-numbered matches, best at the lowest table. A match with
 * a fixed-seat player takes that player's table; the rest fill the tables
 * left, skipping any a kept match already holds. A bye sits at no table and
 * is already decided.
 */
export function toMatches(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
  const used = new Set(stamp.taken ?? []);
  const tables = pairings.map(pairing => {
    const table = pairing.p2 === null ? 0 : claimed(pairing, stamp, used);
    if (table) {
      used.add(table);
    }
    return table;
  });
  const reserved = new Set([...used, ...(stamp.fixed?.values() ?? [])]);
  let next = stamp.firstTable;
  const nextFree = () => {
    while (reserved.has(next)) {
      next += 1;
    }
    next += 1;
    return next - 1;
  };
  const matches: Match[] = pairings.map(({ p1, p2 }, i) =>
    p2 === null
      ? { table: 0, p1, p2: null, outcome: 'bye' as const, timestamp: stamp.timestamp }
      : { table: tables[i] ?? nextFree(), p1, p2, outcome: 'pending' as const, timestamp: stamp.timestamp }
  );
  return sortMatches(matches);
}

/** Tables first, the bye and missed-round entries last. */
export function sortMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort((a, b) => (a.table || Infinity) - (b.table || Infinity));
}
