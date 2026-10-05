/**
 * Records and standings, by the Play! Pokémon Tournament Rules Handbook
 * (Sept 2026, §5.3, §5.5.2, §5.6.1).
 *
 * Players rank by match points (three for a win or a bye, one for a tie). A
 * player TOM tagged late ranks below everyone else on the same points, as TOM
 * ranks them; the site never tags one (see newPlayer in commands.ts). Then
 * opponents' win percentage (OWP), then opponents' opponents' (OOWP, the
 * mean of each opponent's OWP), then head-to-head when exactly two players are
 * still level and met.
 *
 * A win percentage is wins over rounds played, a tie counting half a win,
 * floored at 25% and capped at 100%, or 75% for a player who dropped. A bye is
 * a win on the record but neither a win nor a round in the percentage, and it
 * gives no opponent to average. A round a late entrant missed is a loss.
 *
 * A player who dropped keeps the OWP and OOWP they had when they dropped, as
 * TOM ranks them: replayed over 51 divisions TOM finalized, this is the only
 * reading that places every dropped player where TOM did.
 *
 * Only Swiss rounds count here. A top cut is placed by its own bracket, and
 * `placeFinals` lays those places over the Swiss order.
 */

import type { Match, Outcome, Player, Pod, Round } from './types.js';

export const WIN_POINTS = 3;
export const TIE_POINTS = 1;
export const MIN_WIN_RATE = 0.25;
export const DROPPED_MAX_WIN_RATE = 0.75;

export interface MatchRecord {
  /** Byes included, as the record shows them. */
  wins: number;
  losses: number;
  ties: number;
}

export interface Standing {
  playerId: string;
  place: number;
  record: MatchRecord;
  points: number;
  /** Opponents' win percentage, 0..1. */
  owp: number;
  /** Opponents' opponents' win percentage, 0..1. */
  oowp: number;
  dropped: boolean;
  late: boolean;
}

type Side = 'win' | 'loss' | 'tie' | null;

/** What a finished match meant for the player in seat one or two; null while unreported. */
export function sideResult(outcome: Outcome, seat: 1 | 2): Side {
  switch (outcome) {
    case 'p1':
      return seat === 1 ? 'win' : 'loss';
    case 'p2':
      return seat === 2 ? 'win' : 'loss';
    case 'bye':
      return 'win';
    case 'tie':
      return 'tie';
    case 'double-loss':
    case 'loss':
      return 'loss';
    case 'pending':
    default:
      return null;
  }
}

export interface Tally {
  record: MatchRecord;
  byes: number;
  opponents: string[];
  /** Opponents beaten, for head-to-head. */
  beat: Set<string>;
}

function tallyFor(tallies: Map<string, Tally>, id: string): Tally {
  let tally = tallies.get(id);
  if (!tally) {
    tally = { record: { wins: 0, losses: 0, ties: 0 }, byes: 0, opponents: [], beat: new Set() };
    tallies.set(id, tally);
  }
  return tally;
}

const RECORD_KEY: { [side in Exclude<Side, null>]: keyof MatchRecord } = { win: 'wins', loss: 'losses', tie: 'ties' };

function countSeat(tallies: Map<string, Tally>, match: Match, seat: 1 | 2): void {
  const id = seat === 1 ? match.p1 : match.p2;
  const side = sideResult(match.outcome, seat);
  if (id === null || side === null) {
    return;
  }
  const tally = tallyFor(tallies, id);
  tally.record[RECORD_KEY[side]] += 1;
  tally.byes += match.outcome === 'bye' ? 1 : 0;
  const opponent = seat === 1 ? match.p2 : match.p1;
  if (opponent === null) {
    return;
  }
  tally.opponents.push(opponent);
  if (side === 'win') {
    tally.beat.add(opponent);
  }
}

/** Every player's record and opponents over the pod's decided Swiss matches. */
export function tallySwiss(pod: Pod, throughRound = Infinity): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const id of pod.playerIds) {
    tallyFor(tallies, id);
  }
  for (const round of pod.rounds) {
    if (round.kind !== 'swiss' || round.number > throughRound) {
      continue;
    }
    countRound(tallies, round);
  }
  return tallies;
}

function countRound(tallies: Map<string, Tally>, round: Round): void {
  for (const match of round.matches) {
    countSeat(tallies, match, 1);
    countSeat(tallies, match, 2);
  }
}

export function matchPoints(record: MatchRecord): number {
  return record.wins * WIN_POINTS + record.ties * TIE_POINTS;
}

/** A player's win percentage as an opponent (see the module note). */
export function winRate(tally: Tally, dropped: boolean): number {
  const played = tally.record.wins + tally.record.losses + tally.record.ties - tally.byes;
  const won = tally.record.wins - tally.byes + tally.record.ties / 2;
  const rate = played > 0 ? won / played : 0;
  return Math.min(dropped ? DROPPED_MAX_WIN_RATE : 1, Math.max(MIN_WIN_RATE, rate));
}

function opponentAverage(opponents: readonly string[], values: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const id of opponents) {
    sum += values.get(id) ?? 0;
  }
  return opponents.length === 0 ? 0 : sum / opponents.length;
}

/** Floating-point noise must not decide a tiebreak two equal records share. */
const EPSILON = 1e-9;

/**
 * The order two players rank in. The handbook ends on a random draw; TOM
 * ends on the order players were registered (the .tdf's player list), and so
 * does this, which also keeps the organizer's copy and the public one, whose
 * player IDs differ, in the same order.
 */
function compareStandings(order: ReadonlyMap<string, number>) {
  const byRate = (x: number, y: number) => (Math.abs(x - y) < EPSILON ? 0 : y - x);
  return (a: Omit<Standing, 'place'>, b: Omit<Standing, 'place'>): number =>
    b.points - a.points ||
    Number(a.late) - Number(b.late) ||
    byRate(a.owp, b.owp) ||
    byRate(a.oowp, b.oowp) ||
    (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0);
}

type Row = Omit<Standing, 'place'>;

const level = (a: Row, b: Row) =>
  a.points === b.points &&
  a.late === b.late &&
  Math.abs(a.owp - b.owp) < EPSILON &&
  Math.abs(a.oowp - b.oowp) < EPSILON;

/** Where exactly two players are level on everything and met, the winner goes first. */
function headToHead(rows: Row[], tallies: Map<string, Tally>): Row[] {
  const out = [...rows];
  for (let i = 0; i + 1 < out.length; i += 1) {
    const [a, b] = [out[i] as Row, out[i + 1] as Row];
    const three = (out[i - 1] && level(out[i - 1] as Row, a)) || (out[i + 2] && level(b, out[i + 2] as Row));
    if (!three && level(a, b) && tallies.get(b.playerId)?.beat.has(a.playerId)) {
      out[i] = b;
      out[i + 1] = a;
    }
  }
  return out;
}

interface Tiebreakers {
  owp: number;
  oowp: number;
}

/** O(P + E): look up cached opponent rates rather than walking opponents' opponents. */
function tiebreakersFor(tallies: ReadonlyMap<string, Tally>, dropped: (id: string) => boolean): Map<string, number> {
  const rates = new Map<string, number>();
  for (const [id, tally] of tallies) {
    rates.set(id, winRate(tally, dropped(id)));
  }
  const owp = new Map<string, number>();
  for (const [id, tally] of tallies) {
    owp.set(id, opponentAverage(tally.opponents, rates));
  }
  return owp;
}

function playerTiebreakers(id: string, tally: Tally, owp: ReadonlyMap<string, number>): Tiebreakers {
  return { owp: owp.get(id) ?? 0, oowp: opponentAverage(tally.opponents, owp) };
}

function ranked(id: string, byId: ReadonlyMap<string, Player>, options: StandingsOptions): boolean {
  return (!options.only || options.only.has(id)) && (options.withDisqualified === true || !byId.get(id)?.disqualified);
}

function dropRounds(pod: Pod, rounds: readonly Round[], byId: ReadonlyMap<string, Player>, options: StandingsOptions) {
  const through = options.throughRound ?? Infinity;
  // Include match participants absent from the pod roster, just as tallySwiss does.
  const ids = new Set([
    ...pod.playerIds,
    ...rounds.flatMap(round => round.matches.flatMap(match => [match.p1, match.p2]))
  ]);
  const drops = new Map<number, string[]>();
  for (const id of ids) {
    if (id === null || !ranked(id, byId, options)) {
      continue;
    }
    const at = byId.get(id)?.droppedAfter ?? null;
    if (at !== null && at < through) {
      const group = drops.get(at) ?? [];
      group.push(id);
      drops.set(at, group);
    }
  }
  return drops;
}

/** Tally each match once; snapshots retain only the rows that freeze at that cutoff. */
function standingsTallies(pod: Pod, byId: ReadonlyMap<string, Player>, options: StandingsOptions) {
  const through = options.throughRound ?? Infinity;
  const rounds = pod.rounds.filter(round => round.kind === 'swiss' && round.number <= through);
  const tallies = new Map<string, Tally>();
  for (const id of pod.playerIds) {
    tallyFor(tallies, id);
  }
  const drops = dropRounds(pod, rounds, byId, options);
  const frozen = new Map<string, Tiebreakers>();
  const remaining = rounds.sort((a, b) => a.number - b.number)[Symbol.iterator]();
  let next = remaining.next();
  for (const [at, droppedIds] of [...drops].sort(([a], [b]) => a - b)) {
    while (!next.done && next.value.number <= at) {
      countRound(tallies, next.value);
      next = remaining.next();
    }
    const owp = tiebreakersFor(tallies, id => (byId.get(id)?.droppedAfter ?? Infinity) <= at);
    for (const id of droppedIds) {
      const tally = tallies.get(id);
      frozen.set(id, tally ? playerTiebreakers(id, tally, owp) : { owp: 0, oowp: 0 });
    }
  }
  while (!next.done) {
    countRound(tallies, next.value);
    next = remaining.next();
  }
  return { tallies, frozen };
}

export interface StandingsOptions {
  throughRound?: number;
  /** Rank only these players (one division of a combined pod); everyone still counts as an opponent. */
  only?: ReadonlySet<string>;
  /** Rank disqualified players too, as a dropped player ranks: a .tdf carries a disqualification as a drop. */
  withDisqualified?: boolean;
}

/** The pod's Swiss standings, best first. */
export function swissStandings(pod: Pod, players: readonly Player[], options: StandingsOptions = {}): Standing[] {
  const byId = new Map(players.map(player => [player.id, player]));
  const dropped = (id: string) => (byId.get(id)?.droppedAfter ?? null) !== null;
  const { tallies, frozen } = standingsTallies(pod, byId, options);
  const owp = tiebreakersFor(tallies, dropped);
  // A disqualified player leaves the standings; their matches still count for their opponents.
  const rows: Row[] = [];
  for (const [id, tally] of tallies) {
    if (!ranked(id, byId, options)) {
      continue;
    }
    const rates = frozen.get(id) ?? playerTiebreakers(id, tally, owp);
    rows.push({
      playerId: id,
      record: tally.record,
      points: matchPoints(tally.record),
      ...rates,
      dropped: dropped(id),
      late: byId.get(id)?.late === true
    });
  }
  const order = new Map(players.map((player, i) => [player.id, i]));
  return headToHead(rows.sort(compareStandings(order)), tallies).map((row, i) => ({ ...row, place: i + 1 }));
}

/** Winner and loser of a decided elimination match, or null while it is open. */
export function eliminationResult(match: Match): { winner: string; loser: string | null } | null {
  if (match.outcome === 'bye' || (match.outcome === 'p1' && match.p2 === null)) {
    return { winner: match.p1, loser: null };
  }
  if (match.outcome === 'p1') {
    return { winner: match.p1, loser: match.p2 };
  }
  if (match.outcome === 'p2' && match.p2 !== null) {
    return { winner: match.p2, loser: match.p1 };
  }
  return null;
}

/**
 * The match for third place in a top cut that plays one: in the final's
 * round, between the two players the semifinals knocked out.
 */
export function thirdPlaceMatch(pod: Pod, round: Round): Match | undefined {
  const semis = pod.rounds.find(r => r.number === round.number - 1);
  if (round.kind !== 'elimination' || round.matches.length !== 2 || semis?.kind !== 'elimination') {
    return undefined;
  }
  if (semis.matches.length !== 2) {
    return undefined;
  }
  const out = new Set(semis.matches.map(match => eliminationResult(match)?.loser));
  return round.matches.find(match => match.p2 !== null && out.has(match.p1) && out.has(match.p2));
}

/** A top-cut round's bracket: every match but a third-place one. */
export function bracketMatches(pod: Pod, round: Round): Match[] {
  const playoff = thirdPlaceMatch(pod, round);
  return round.matches.filter(match => match !== playoff);
}

/**
 * How deep each top-cut player went: the round they lost in, or past the last
 * round for the winner. The third-place match's winner sits half a round
 * above its loser, both below the final's loser.
 */
function eliminationDepth(pod: Pod): Map<string, number> {
  const depth = new Map<string, number>();
  for (const round of pod.rounds) {
    if (round.kind !== 'elimination') {
      continue;
    }
    const playoff = thirdPlaceMatch(pod, round);
    for (const match of round.matches) {
      const result = eliminationResult(match);
      const [won, lost] = match === playoff ? [round.number - 0.5, round.number - 1] : [round.number + 1, round.number];
      depth.set(match.p1, won);
      if (match.p2 !== null) {
        depth.set(match.p2, won);
      }
      if (result?.loser) {
        depth.set(result.loser, lost);
      }
    }
  }
  return depth;
}

/**
 * Final places: the top cut by how far each player went (champion, finalist,
 * then each round's losers by Swiss place), then everyone else in Swiss order.
 */
export function placeFinals(pod: Pod, swiss: readonly Standing[]): Standing[] {
  const depth = eliminationDepth(pod);
  if (depth.size === 0) {
    return [...swiss];
  }
  const ordered = [...swiss].sort(
    (a, b) => (depth.get(b.playerId) ?? -1) - (depth.get(a.playerId) ?? -1) || a.place - b.place
  );
  return ordered.map((row, i) => ({ ...row, place: i + 1 }));
}

export function recordLabel(record: MatchRecord): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

export function percentLabel(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
