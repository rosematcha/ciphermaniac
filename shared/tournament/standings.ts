/**
 * Records and standings, by the Play! Pokémon Tournament Rules Handbook
 * (Sept 2026, §5.3, §5.5.2, §5.6.1).
 *
 * Players rank by match points (three for a win or a bye, one for a tie). A
 * player who joined late ranks below everyone on time with the same points.
 * Then opponents' win percentage (OWP), then opponents' opponents' (OOWP, the
 * mean of each opponent's OWP), then head-to-head when exactly two players are
 * still level and met.
 *
 * A win percentage is wins over rounds played, a tie counting half a win,
 * floored at 25% and capped at 100%, or 75% for a player who dropped. A bye is
 * a win on the record but neither a win nor a round in the percentage, and it
 * gives no opponent to average. A round a late entrant missed is a loss.
 *
 * Only Swiss rounds count here. A top cut is placed by its own bracket, and
 * `placeFinals` lays those places over the Swiss order.
 */

import type { Match, Outcome, Player, Pod } from './types.js';

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
    for (const match of round.matches) {
      countSeat(tallies, match, 1);
      countSeat(tallies, match, 2);
    }
  }
  return tallies;
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

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Floating-point noise must not decide a tiebreak two equal records share. */
const EPSILON = 1e-9;

/**
 * The order two players rank in. The handbook ends on a random draw; this
 * ends on roster order instead, which is as arbitrary but is the same in the
 * organizer's copy and the public one, whose player IDs differ.
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

export interface StandingsOptions {
  throughRound?: number;
  /** Rank only these players (one division of a combined pod); everyone still counts as an opponent. */
  only?: ReadonlySet<string>;
}

/** The pod's Swiss standings, best first. */
export function swissStandings(pod: Pod, players: readonly Player[], options: StandingsOptions = {}): Standing[] {
  const tallies = tallySwiss(pod, options.throughRound);
  const byId = new Map(players.map(player => [player.id, player]));
  const dropped = (id: string) => (byId.get(id)?.droppedAfter ?? null) !== null;
  const rate = new Map([...tallies].map(([id, tally]) => [id, winRate(tally, dropped(id))]));
  const owp = new Map([...tallies].map(([id, tally]) => [id, average(tally.opponents.map(o => rate.get(o) ?? 0))]));
  const rows: Row[] = [...tallies]
    .filter(([id]) => !options.only || options.only.has(id))
    .map(([id, tally]) => ({
      playerId: id,
      record: tally.record,
      points: matchPoints(tally.record),
      owp: owp.get(id) ?? 0,
      oowp: average(tally.opponents.map(o => owp.get(o) ?? 0)),
      dropped: dropped(id),
      late: byId.get(id)?.late === true
    }));
  const order = new Map(pod.playerIds.map((id, i) => [id, i]));
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

/** How deep each top-cut player went: the round they lost in, or past the last round for the winner. */
function eliminationDepth(pod: Pod): Map<string, number> {
  const depth = new Map<string, number>();
  for (const round of pod.rounds) {
    if (round.kind !== 'elimination') {
      continue;
    }
    for (const match of round.matches) {
      const result = eliminationResult(match);
      depth.set(match.p1, round.number + 1);
      if (match.p2 !== null) {
        depth.set(match.p2, round.number + 1);
      }
      if (result?.loser) {
        depth.set(result.loser, round.number);
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
