/**
 * Reading a pod's rounds: which is current, who has played whom, who is still
 * in, and turning pairings into table-numbered matches.
 */

import type { Pairing, PairingHistory } from './pairing.js';
import { matchPoints, tallySwiss } from './standings.js';
import type { Match, Pod, PodCategory, Round, Tournament } from './types.js';

/** The pod's current round: the last one paired. */
export function latestRound(pod: Pod | undefined): Round | undefined {
  return pod?.rounds.at(-1);
}

/** The pod a player plays in. */
export function podOf(tournament: Tournament, playerId: string): Pod | undefined {
  return tournament.pods.find(pod => pod.playerIds.includes(playerId));
}

/** Whether any round has been paired: before that the event is still taking players. */
export function hasStarted(tournament: Tournament): boolean {
  return tournament.pods.some(pod => pod.rounds.length > 0);
}

export function isReported(match: Match): boolean {
  return match.outcome !== 'pending';
}

/**
 * What names one match across the event. Both players are part of it, so a
 * result or a report sent for a match cannot land on a pairing made since.
 */
export interface MatchKey {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string | null;
}

export function sameMatch(a: MatchKey, b: MatchKey): boolean {
  return a.pod === b.pod && a.round === b.round && a.table === b.table && a.p1 === b.p1 && a.p2 === b.p2;
}

/** The match a key names, with its pod and round; undefined once it is gone (re-paired) or if it never was. */
export function findMatch(tournament: Tournament, key: MatchKey): { pod: Pod; round: Round; match: Match } | undefined {
  const pod = tournament.pods.find(p => p.category === key.pod);
  const round = pod?.rounds.find(r => r.number === key.round);
  const match = round?.matches.find(m => m.table === key.table && m.p1 === key.p1 && m.p2 === key.p2);
  return pod && round && match ? { pod, round, match } : undefined;
}

/** Whether the match a key names is still there and still waiting on a result. */
export function isOpenMatch(tournament: Tournament, key: MatchKey): boolean {
  return findMatch(tournament, key)?.match.outcome === 'pending';
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
 * Pairings as table-numbered matches, in the pairings' own order. A match
 * with a fixed-seat player takes that player's table; the rest fill the
 * tables left, skipping any a kept match already holds. A bye sits at no
 * table and is already decided. A top cut keeps this order, as its next
 * round pairs neighbouring matches' winners; pages sort by table.
 */
export function seatPairings(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
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
  return pairings.map(({ p1, p2 }, i) =>
    p2 === null
      ? { table: 0, p1, p2: null, outcome: 'bye' as const, timestamp: stamp.timestamp }
      : { table: tables[i] ?? nextFree(), p1, p2, outcome: 'pending' as const, timestamp: stamp.timestamp }
  );
}

/** Swiss pairings as table-numbered matches (see seatPairings), best at the lowest table. */
export function toMatches(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
  return sortMatches(seatPairings(pairings, stamp));
}

/** Tables first, the bye and missed-round entries last. */
export function sortMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort((a, b) => (a.table || Infinity) - (b.table || Infinity));
}
