/**
 * A top cut as a bracket: its single-elimination rounds as columns, each
 * match fed by the two beside it in the column before. Pure, so the public
 * page, the console and the big screen draw the same bracket.
 *
 * The latest paired round is ordered by seed (1 at the top, and the top two
 * apart until the final), whatever order the matches were stored in: a TOM
 * file keeps its own. Each round before it is ordered by the pairings that
 * came of it, every match once; a round not paired yet still shows who has
 * gone through to it.
 */

import { bracketOrder } from '../../../shared/tournament/pairing';
import { withSwiss } from '../../../shared/tournament/rounds';
import {
  bracketMatches,
  eliminationResult,
  swissStandings,
  thirdPlaceMatch
} from '../../../shared/tournament/standings';
import type { Match, Pod, Round, Tournament } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { cutStageLabel, shownOutcome } from './present';

export interface BracketSeat {
  /** Null for a seat nobody has reached yet, or the empty side of a bye. */
  id: string | null;
  seed: number | null;
  /** W or L once the match is decided; '' while it is open. */
  mark: '' | 'W' | 'L';
}

export interface BracketMatch {
  /** 0 for a match not paired yet, or a bye. */
  table: number;
  top: BracketSeat;
  bottom: BracketSeat;
  /** Paired with two players and no result yet. */
  playing: boolean;
  /** Its result was entered on the site and is waiting on TOM. */
  unconfirmed: boolean;
}

export interface BracketRound {
  label: string;
  matches: BracketMatch[];
}

export interface Bracket {
  rounds: BracketRound[];
  /** The match for third place, when the cut plays one. */
  third: BracketMatch | null;
}

/** Each top-cut player's seed: their place in the Swiss standings that seeded the cut. */
export function cutSeeds(tournament: Tournament, pod: Pod): Map<string, number> {
  const played = withSwiss(tournament, pod);
  const only = pod.cutOf ? { only: new Set(pod.playerIds) } : {};
  return new Map(swissStandings(played, tournament.players, only).map(row => [row.playerId, row.place]));
}

/** A match with the result the pages show for it: TOM's, or one entered on the site and waiting. */
interface Shown {
  match: Match;
  unconfirmed: boolean;
}

function shown(match: Match, pod: Pod, round: Round, pending: readonly PendingResult[]): Shown {
  const { outcome, unconfirmed } = shownOutcome(match, pod, round, pending);
  return { match: { ...match, outcome }, unconfirmed };
}

const winnerOf = (entry: Shown | null) => (entry ? (eliminationResult(entry.match)?.winner ?? null) : null);

/**
 * A round's matches by bracket position, the top seed's match first: each
 * placed where its best seed sits in a bracket of `size`.
 */
function bySeed(matches: readonly Shown[], seeds: ReadonlyMap<string, number>, size: number): Shown[] {
  const position = new Map(bracketOrder(size).map((seed, i) => [seed, i]));
  const unseeded = Number.MAX_SAFE_INTEGER;
  const best = (entry: Shown) =>
    Math.min(seeds.get(entry.match.p1) ?? unseeded, seeds.get(entry.match.p2 ?? '') ?? unseeded);
  const at = (entry: Shown) => position.get(best(entry)) ?? unseeded;
  return [...matches].sort((a, b) => at(a) - at(b));
}

/** A match not paired yet, with whoever has gone through to it so far; null while nobody has. */
function unpaired(a: string | null, b: string | null): Shown | null {
  return a || b
    ? { match: { table: 0, p1: a ?? '', p2: b, outcome: 'pending', timestamp: '' }, unconfirmed: false }
    : null;
}

type Column = (Shown | null)[];

/** The two matches in `before` whose winners `entry` pairs, in seat order; null when they are not both there. */
function feedersOf(entry: Shown, before: readonly Shown[], used: Set<Shown>): Shown[] | null {
  const { p1, p2 } = entry.match;
  if (p2 === null) {
    return null;
  }
  const feeders: Shown[] = [];
  for (const id of [p1, p2]) {
    const feeder = before.find(f => !used.has(f) && winnerOf(f) === id);
    if (!feeder) {
      return null;
    }
    used.add(feeder);
    feeders.push(feeder);
  }
  return feeders;
}

/**
 * The round before `column`, ordered by the pairings that follow it, so each
 * pair of matches sits beside the match its winners meet in. Null unless
 * every match in it feeds exactly one there, once.
 */
function fedFrom(column: readonly Shown[], before: readonly Shown[]): Shown[] | null {
  const used = new Set<Shown>();
  const ordered: Shown[] = [];
  for (const entry of column) {
    const feeders = feedersOf(entry, before, used);
    if (!feeders) {
      return null;
    }
    ordered.push(...feeders);
  }
  return used.size === before.length ? ordered : null;
}

/**
 * The rounds paired so far as columns: the latest by seed, each before it by
 * the pairings that came of it. Null when the rounds do not make one bracket.
 */
function pairedColumns(played: readonly Shown[][], seeds: ReadonlyMap<string, number>, size: number): Shown[][] | null {
  let column = bySeed(played.at(-1) ?? [], seeds, size);
  const columns = [column];
  for (let k = played.length - 2; k >= 0; k -= 1) {
    const before = fedFrom(column, played[k] ?? []);
    if (!before) {
      return null;
    }
    columns.unshift(before);
    column = before;
  }
  return columns;
}

/** The rounds not paired yet: neighbouring matches' winners meet, as far as anyone has gone through. */
function unpairedColumns(last: readonly Shown[]): Column[] {
  const columns: Column[] = [];
  let column: Column = [...last];
  while (column.length > 1) {
    const before = column;
    column = Array.from({ length: before.length / 2 }, (_, j) =>
      unpaired(winnerOf(before[2 * j] ?? null), winnerOf(before[2 * j + 1] ?? null))
    );
    columns.push(column);
  }
  return columns;
}

function seatOf(id: string | null, entry: Shown | null, seeds: ReadonlyMap<string, number>): BracketSeat {
  const result = entry ? eliminationResult(entry.match) : null;
  const mark = !id || !result ? '' : result.winner === id ? 'W' : 'L';
  return { id: id || null, seed: id ? (seeds.get(id) ?? null) : null, mark };
}

const EMPTY_SEAT: BracketSeat = { id: null, seed: null, mark: '' };

/** A match as the bracket draws it; a slot nobody has reached yet is two empty seats. */
function present(entry: Shown | null, seeds: ReadonlyMap<string, number>): BracketMatch {
  if (!entry) {
    return { table: 0, top: EMPTY_SEAT, bottom: EMPTY_SEAT, playing: false, unconfirmed: false };
  }
  const { match, unconfirmed } = entry;
  const top = match.p1 || null;
  const open = match.outcome === 'pending';
  return {
    table: match.table,
    top: seatOf(top, entry, seeds),
    bottom: seatOf(match.p2, entry, seeds),
    playing: open && match.table > 0 && top !== null && match.p2 !== null,
    unconfirmed
  };
}

/** Whether `n` is a power of two from 2 up, the only sizes a bracket can be drawn for. */
const drawable = (n: number) => n >= 2 && (n & (n - 1)) === 0;

/**
 * The pod's top cut as a bracket, or null when it has none to draw: no
 * elimination round yet, a first round that is not a whole bracket, or
 * later rounds that do not follow from the ones before (the pages show the
 * table then rather than a bracket that loses or repeats a match).
 */
export function buildBracket(
  pod: Pod,
  seeds: ReadonlyMap<string, number>,
  pending: readonly PendingResult[]
): Bracket | null {
  const rounds = pod.rounds.filter(round => round.kind === 'elimination');
  const [first] = rounds;
  if (!first || !drawable(bracketMatches(pod, first).length * 2)) {
    return null;
  }
  const played = rounds.map(round => bracketMatches(pod, round).map(match => shown(match, pod, round, pending)));
  const paired = pairedColumns(played, seeds, (played[0]?.length ?? 0) * 2);
  if (!paired) {
    return null;
  }
  const columns: Column[] = [...paired, ...unpairedColumns(paired.at(-1) ?? [])];
  const last = rounds.at(-1);
  const playoff = last ? thirdPlaceMatch(pod, last) : undefined;
  return {
    rounds: columns.map(entries => ({
      label: cutStageLabel(entries.length * 2),
      matches: entries.map(entry => present(entry, seeds))
    })),
    third: playoff && last ? present(shown(playoff, pod, last, pending), seeds) : null
  };
}
