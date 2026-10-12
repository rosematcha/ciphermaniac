/**
 * Reading a pod's rounds: which is current, who has played whom, who is still
 * in, and turning pairings into table-numbered matches.
 */

import { divisionLookup } from './divisions.js';
import type { Pairing, PairingHistory } from './pairing.js';
import { matchPoints, tallySwiss } from './standings.js';
import { eventTypeOf, recommendedStructure } from './structure.js';
import {
  type Division,
  DIVISIONS,
  isDivision,
  type Match,
  type Pod,
  type PodCategory,
  type Round,
  type Tournament
} from './types.js';

/** The pod's current round: the last one paired. */
export function latestRound(pod: Pod | undefined): Round | undefined {
  return pod?.rounds.at(-1);
}

/**
 * The pod a player plays in now: their division's top cut once they are in
 * one (see Pod.cutOf), which comes after the pod they played Swiss in.
 */
export function podOf(tournament: Tournament, playerId: string): Pod | undefined {
  for (let i = tournament.pods.length - 1; i >= 0; i -= 1) {
    const pod = tournament.pods[i] as Pod;
    if (pod.playerIds.includes(playerId)) {
      return pod;
    }
  }
  return undefined;
}

/** The pods playing the divisions' top cuts out of `pod`, a pod of several divisions. */
export function cutPodsOf(tournament: Tournament, pod: Pod): Pod[] {
  return DIVISIONS.flatMap(division => {
    const cut = cutPodOf(tournament, pod, division);
    return cut ? [cut] : [];
  });
}

/** A read-only view of one division's bracket in the shared pod. */
export function cutPodOf(tournament: Tournament, pod: Pod, division: Division): Pod | undefined {
  const legacy = tournament.pods.find(p => p.cutOf === pod.category && p.category === division);
  if (legacy) {
    return legacy;
  }
  const cut = pod.divisionCuts?.[division];
  if (!cut) {
    return undefined;
  }
  const of = divisionLookup(tournament);
  const played = pod.rounds
    .filter(r => r.kind === 'elimination')
    .flatMap(r => r.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])));
  const ids = [
    ...new Set([...(cut.playerIds ?? []), ...pod.playerIds.filter(id => played.includes(id) && of(id) === division)])
  ];
  return divisionBracket(pod, division, cut, ids);
}

function divisionBracket(
  pod: Pod,
  division: Division,
  cut: { size: number; playoff3rd4th: boolean },
  ids: string[]
): Pod | undefined {
  const { divisionCuts: _cuts, ...base } = pod;
  const only = new Set(ids);
  const rounds = pod.rounds
    .filter(r => r.kind === 'elimination')
    .map(r => ({ ...r, matches: r.matches.filter(m => only.has(m.p1)) }))
    .filter(r => r.matches.length > 0);
  return rounds.length
    ? {
        ...base,
        category: division,
        cutOf: pod.category,
        cut: cut.size,
        playoff3rd4th: cut.playoff3rd4th,
        playerIds: ids,
        rounds
      }
    : undefined;
}

/** Division views using persisted membership, also usable after public IDs replace POP IDs. */
export function divisionBrackets(pod: Pod): Pod[] {
  return DIVISIONS.flatMap(d => {
    const cut = pod.divisionCuts?.[d];
    const view = cut?.playerIds && divisionBracket(pod, d, cut, cut.playerIds);
    return view ? [view] : [];
  });
}

export function livePods(tournament: Tournament): Pod[] {
  return tournament.pods.filter(pod => !tournament.pods.some(p => p.cutOf === pod.category));
}

/** Fold old site documents into TOM's one-pod, one-round-list representation. */
export function normalizeCutPods(tournament: Tournament): Tournament {
  if (!tournament.pods.some(p => p.cutOf)) {
    return tournament;
  }
  const pods = tournament.pods
    .filter(p => !p.cutOf)
    .map(pod =>
      mergeCutPods(
        pod,
        tournament.pods.filter(p => p.cutOf === pod.category)
      )
    );
  return { ...tournament, pods };
}

function mergeCutPods(pod: Pod, cuts: Pod[]): Pod {
  if (!cuts.length) {
    return pod;
  }
  const divisionCuts = { ...pod.divisionCuts };
  const rounds = new Map(pod.rounds.map(r => [r.number, r]));
  for (const cut of [...cuts].sort(
    (a, b) => DIVISIONS.indexOf(b.category as Division) - DIVISIONS.indexOf(a.category as Division)
  )) {
    if (isDivision(cut.category)) {
      divisionCuts[cut.category] = { size: cut.cut, playoff3rd4th: cut.playoff3rd4th, playerIds: cut.playerIds };
    }
    for (const round of cut.rounds) {
      const kept = rounds.get(round.number);
      const matches = [...(kept?.matches ?? []), ...round.matches];
      rounds.set(round.number, { ...round, matches, status: matches.every(isReported) ? 'finished' : 'paired' });
    }
  }
  return { ...pod, divisionCuts, rounds: [...rounds.values()].sort((a, b) => a.number - b.number) };
}

/**
 * A division's top cut with the Swiss rounds that seeded it ahead of its own,
 * so records and seeds read from it as from a pod of one division; any other
 * pod as it is.
 */
export function withSwiss(tournament: Tournament, pod: Pod): Pod {
  const swiss = pod.cutOf && tournament.pods.find(p => p.category === pod.cutOf);
  return swiss ? { ...pod, rounds: [...swiss.rounds.filter(r => r.kind === 'swiss'), ...pod.rounds] } : pod;
}

/**
 * Every round a player has played, as one pod: the pod they played Swiss in,
 * with the rounds of the top cut they went on to after its own. Their record,
 * history and final place all read from it.
 */
export function playerPod(tournament: Tournament, playerId: string): Pod | undefined {
  const theirs = tournament.pods.filter(pod => pod.playerIds.includes(playerId));
  const swiss = theirs.find(pod => !pod.cutOf);
  const cut = theirs.find(pod => pod.cutOf);
  if (swiss?.divisionCuts && !isDivision(swiss.category)) {
    const view = cutPodsOf(tournament, swiss).find(p => p.playerIds.includes(playerId));
    return view ? withSwiss(tournament, view) : { ...swiss, rounds: swiss.rounds.filter(r => r.kind === 'swiss') };
  }
  return swiss && cut ? { ...swiss, rounds: [...swiss.rounds, ...cut.rounds] } : (swiss ?? cut);
}

/** Whether TOM had finalized the file this came from: its root stage is 5. */
export function wasFinalized(tournament: Tournament): boolean {
  return (
    tournament.settings?.stage === 5 ||
    (tournament.passthrough?.rootAttrs.some(([key, value]) => key === 'stage' && value === '5') ?? false)
  );
}

/** Whether any round has been paired: before that the event is still taking players. */
export function hasStarted(tournament: Tournament): boolean {
  return (
    tournament.startedAt !== undefined ||
    (tournament.settings?.stage ?? 0) >= 4 ||
    tournament.pods.some(pod => pod.rounds.length > 0) ||
    (tournament.passthrough?.rootAttrs.some(([key, value]) => key === 'stage' && Number(value) >= 4) ?? false)
  );
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

/** A full round's clock, in seconds: Swiss rounds and top cut rounds each run their own length. */
export function fullRoundSeconds(tournament: Tournament, kind: Round['kind']): number {
  const onlyElimination =
    tournament.settings?.type === 1 || tournament.passthrough?.rootAttrs.some(([k, v]) => k === 'type' && v === '1');
  return (kind === 'swiss' || onlyElimination ? tournament.info.roundTime : tournament.info.finalsRoundTime) * 60;
}

export function roundComplete(round: Round): boolean {
  return round.matches.length > 0 && round.matches.every(isReported);
}

/** V18-12: a round at stage 5 or later counts as complete for pairing, finishing and tables, pending or not. */
export function countsComplete(round: Round | undefined): boolean {
  return Boolean(round && ((round.stage ?? 0) >= 5 || roundComplete(round)));
}

/** V18-6: setting an outcome returns a round at 5 or later with a pending match, or no match, to 4. */
export function checkedStage(round: Round): Round {
  if ((round.stage ?? 0) < 5 || roundComplete(round)) {
    return round;
  }
  return { ...round, stage: 4, status: 'started' };
}

/** V18-6: every save writes each pod's latest round at 5 once it has a match and nothing pending. */
export function savedStages(t: Tournament): Tournament {
  if (!t.settings) {
    return t;
  }
  return {
    ...t,
    pods: t.pods.map(pod => {
      const last = latestRound(pod);
      if (!last || (last.stage ?? 0) >= 5 || !roundComplete(last)) {
        return pod;
      }
      const promoted: Round = { ...last, stage: 5, status: 'finished' };
      return { ...pod, rounds: pod.rounds.map(r => (r === last ? promoted : r)) };
    })
  };
}

/** Opponents and byes from every Swiss round except `skipRound`. */
export function pairingHistory(pod: Pod, skipRound?: number): PairingHistory {
  const opponents = new Map<string, Set<string>>();
  const byes = new Set<string>();
  const meet = (a: string, b: string) => opponents.set(a, (opponents.get(a) ?? new Set()).add(b));
  for (const round of pod.rounds) {
    if (round.number === skipRound) {
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
  // V22-4: a failed attempt's random bye stays in its holder's record until the file is reopened.
  pod.unsavedRandomByes?.forEach(id => byes.add(id));
  const previous = pod.rounds.filter(r => r.number < (skipRound ?? Infinity)).at(-1);
  const seated = new Set(previous?.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])) ?? []);
  // V22-1: a player a departure left without a record counts as having no history, as statement 12's loss does.
  const missingPrevious = new Set([
    ...(previous ? pod.playerIds.filter(id => !seated.has(id)) : []),
    ...(pod.lostRecords ?? [])
  ]);
  return { opponents, byes, missingPrevious };
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

/** Whether a player joined the pod after a round was paired: they have a round they missed, recorded as a loss. */
export function joinedLate(pod: Pod | undefined, id: string): boolean {
  return (pod?.rounds ?? []).some(round =>
    round.matches.some(match => match.p1 === id && match.p2 === null && match.outcome === 'loss')
  );
}

/**
 * The players a pod's structure is planned on: those its first round seated
 * (a bye included), or before then everyone in it. Players added after round
 * 1 was paired do not count toward the rounds or the cut (Tournament Rules
 * Handbook §5.5.6).
 */
export function attendees(pod: Pod): string[] {
  if (pod.startingPlayerIds) {
    return pod.startingPlayerIds;
  }
  const first = pod.rounds.find(round => round.kind === 'swiss');
  if (!first) {
    return pod.playerIds;
  }
  return first.matches
    .filter(match => match.outcome !== 'loss' || match.p2 !== null)
    .flatMap(match => (match.p2 === null ? [match.p1] : [match.p1, match.p2]));
}

/** How many players a pod's Swiss rounds are planned on (see attendees). */
export function swissAttendance(pod: Pod): number {
  const counts = Object.values(pod.divisionCounts ?? {});
  return counts.length ? Math.max(...counts) : attendees(pod).length;
}

/**
 * The Swiss rounds TOM plans a pod on: Play! Pokémon's number for its
 * attendance. A player who dropped having played fewer has their win
 * percentage capped (see winRate). A site round cap is not part of it: TOM
 * reads the plan from the attendance in the file, and standings must agree
 * with TOM's.
 */
export function regularRounds(tournament: Tournament, pod: Pod): number {
  const { settings } = tournament;
  const count = scheduledAttendance(tournament, pod);
  const type = settings?.type === 2 ? 'challenge' : eventTypeOf(tournament);
  const { rounds } = recommendedStructure(count, type);
  // One less Swiss round is a type 3 setting; a type 2 event saves it but plays every round.
  const fewer = settings?.lessSwiss && settings.type === 3 && rounds >= 4 ? 1 : 0;
  // V22-2: the two Prerelease rounds belong to the type 2 column only.
  const prerelease = settings?.mode === 'PRERELEASE' && settings.type !== 3 ? 2 : 0;
  return rounds - fewer + prerelease + (pod.additionalRounds ?? 0);
}

/** Combined pods select by current membership, then use that division's frozen count. */
function scheduledAttendance(t: Tournament, pod: Pod): number {
  if (isDivision(pod.category)) {
    const count = pod.divisionCounts?.[pod.category] ?? attendees(pod).length;
    return Math.ceil(count / (pod.subgroupCount ?? 1));
  }
  const of = divisionLookup(t);
  const counts = new Map(DIVISIONS.map(d => [d, pod.playerIds.filter(id => of(id) === d).length]));
  const division = [...DIVISIONS].sort((a, b) => counts.get(b)! - counts.get(a)!)[0]!;
  return Math.max(4, pod.divisionCounts?.[division] ?? counts.get(division)!);
}

/** Each player keeps the schedule assigned at start, or receives the current one on reopening. */
export function schedulePlayers(t: Tournament): Tournament {
  const schedules = new Map(
    t.pods.flatMap(p => {
      const rounds = regularRounds(t, p);
      return p.playerIds.map(id => [id, rounds] as const);
    })
  );
  return { ...t, players: t.players.map(p => ({ ...p, scheduledSwissRounds: schedules.get(p.id) ?? 0 })) };
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
  blocked?: readonly { start: number; end: number }[];
  ignoreFixed?: boolean;
  ceiling?: number;
  overflow?: number;
}

/** Each player's fixed table, for the players who have one. */
export function fixedTables(tournament: Tournament): Map<string, number> {
  return new Map(tournament.players.flatMap(p => (p.fixedTable ? [[p.id, p.fixedTable] as const] : [])));
}

/** The fixed table a pairing claims: player one's, else player two's, even when another match shares it. */
function claimed(pairing: Pairing, stamp: MatchStamp): number | undefined {
  return stamp.fixed?.get(pairing.p1) ?? (pairing.p2 === null ? undefined : stamp.fixed?.get(pairing.p2));
}

/**
 * Pairings as table-numbered matches, in the pairings' own order. A match
 * with a fixed-seat player takes that player's table; the rest fill the
 * tables left, skipping any a kept match already holds. A bye sits at no
 * table and is already decided. A top cut keeps this order, as its next
 * round pairs neighbouring matches' winners; pages sort by table.
 */
function availableTable(
  stamp: MatchStamp,
  reserved: ReadonlySet<number>,
  from: number,
  inOverflow: boolean
): { table: number; inOverflow: boolean } {
  const blocked = (number: number) => (stamp.blocked ?? []).some(range => number >= range.start && number <= range.end);
  let table = from;
  let overflow = inOverflow;
  const advance = () => {
    if (!overflow && stamp.ceiling !== undefined && table > stamp.ceiling && stamp.overflow !== undefined) {
      table = stamp.overflow;
      overflow = true;
    }
  };
  advance();
  while (reserved.has(table) || blocked(table)) {
    table += 1;
    advance();
  }
  return { table, inOverflow: overflow };
}

export function seatPairings(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
  const used = new Set(stamp.taken ?? []);
  const tables = pairings.map(pairing => {
    const table = pairing.p2 === null ? 0 : stamp.ignoreFixed ? undefined : claimed(pairing, stamp);
    if (table) {
      used.add(table);
    }
    return table;
  });
  const reserved = new Set([...used, ...(stamp.fixed?.values() ?? [])]);
  let next = stamp.firstTable;
  let inOverflow = false;
  const nextFree = () => {
    const available = availableTable(stamp, reserved, next, inOverflow);
    const { table } = available;
    ({ inOverflow } = available);
    reserved.add(table);
    next = table + 1;
    return table;
  };
  return pairings.map(({ p1, p2 }, i) =>
    p2 === null
      ? { table: 0, p1, p2: null, outcome: 'bye' as const, timestamp: stamp.timestamp }
      : { table: tables[i] ?? nextFree(), p1, p2, outcome: 'pending' as const, timestamp: stamp.timestamp }
  );
}

/** Swiss pairings as table-numbered matches (see seatPairings), best at the lowest table. */
export function toMatches(pairings: readonly Pairing[], stamp: MatchStamp): Match[] {
  return seatPairings(pairings, stamp);
}

/** Tables first, the bye and missed-round entries last. */
export function sortMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort((a, b) => (a.table || Infinity) - (b.table || Infinity));
}
