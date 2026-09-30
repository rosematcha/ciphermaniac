/**
 * Swiss and single-elimination pairings, the way Play! Pokémon runs them.
 *
 * Swiss: players are paired inside their match-point group, in random order,
 * top group first. An odd player out of a group pairs down into the next one.
 * Nobody meets the same opponent twice while any other pairing exists, and the
 * bye goes to the lowest-placed player who has not had one.
 *
 * The search is a depth-first walk down the ranked list: each player takes the
 * first opponent below them they have not played, and backs up when the rest
 * of the field can no longer be paired. On real fields it pairs at the first
 * try. A field that cannot pair rematch-free is walked again allowing one
 * rematch, then two, so a round takes the fewest the walk can find. The walks
 * share a step budget, which bounds the work on a pathological field; past
 * it, one last walk still prefers a new opponent at every seat and always
 * finishes.
 */

import { type Random, shuffled } from './random.js';

export interface Entrant {
  id: string;
  points: number;
}

export interface PairingHistory {
  /** Every opponent each player has already met. */
  opponents: ReadonlyMap<string, ReadonlySet<string>>;
  /** Players who have already had a bye. */
  byes: ReadonlySet<string>;
}

export interface Pairing {
  p1: string;
  /** Null for the bye. */
  p2: string | null;
}

/** Seats every walk for one round may look at together: a few milliseconds at worst. */
const STEP_BUDGET = 25_000;

/** Highest points first, shuffled inside each point group. */
export function rankForPairing(entrants: readonly Entrant[], random: Random): string[] {
  const groups = new Map<number, string[]>();
  for (const entrant of entrants) {
    const group = groups.get(entrant.points);
    if (group) {
      group.push(entrant.id);
    } else {
      groups.set(entrant.points, [entrant.id]);
    }
  }
  return [...groups.keys()].sort((a, b) => b - a).flatMap(points => shuffled(groups.get(points) ?? [], random));
}

/** The lowest-ranked player without a bye yet, or the lowest-ranked of all if everyone has had one. */
export function pickBye(ranked: readonly string[], byes: ReadonlySet<string>): string | undefined {
  for (let i = ranked.length - 1; i >= 0; i -= 1) {
    const id = ranked[i];
    if (id !== undefined && !byes.has(id)) {
      return id;
    }
  }
  return ranked.at(-1);
}

/** A round's field as every walk reads it: who sits where, and whom each has met. */
interface Field {
  ranked: readonly string[];
  /** For each seat, the seats of the players it has met: a round's worth or so, so a scan beats a lookup table. */
  met: number[][];
  /** The most opponents any player has met. */
  mostMet: number;
}

function fieldOf(ranked: readonly string[], history: PairingHistory): Field {
  const seatOf = new Map(ranked.map((id, seat) => [id, seat]));
  const met = ranked.map(id => {
    const seats: number[] = [];
    for (const opponent of history.opponents.get(id) ?? []) {
      const seat = seatOf.get(opponent);
      if (seat !== undefined) {
        seats.push(seat);
      }
    }
    return seats;
  });
  return { ranked, met, mostMet: met.reduce((most, seats) => Math.max(most, seats.length), 0) };
}

/**
 * One walk's state. Seats are taken and pairings pushed as the walk goes
 * down, and undone as it backs up, so a step costs no copying of the field.
 * The unseated seats are a list linked in seat order, a taken seat unlinked
 * and linked back as the walk backs up, so the walk only ever looks at seats
 * still open. It keeps its choices on a list of its own rather than the call
 * stack, so a field of thousands does not run the stack out.
 */
interface Search {
  field: Field;
  /** Next and previous unseated seat; the field's length stands for the list's two ends. */
  next: Int32Array;
  prev: Int32Array;
  open: number;
  /** For each seat, how many of the players it has met are still unseated. */
  metLeft: Int32Array;
  pairings: Pairing[];
  /** Rematches the walk may still take. */
  rematches: number;
  steps: number;
  budget: number;
}

/** A seat's opponent as the walk chose them. */
interface Choice {
  seat: number;
  other: number;
  rematch: boolean;
}

function newSearch(field: Field, rematches: number, budget: number): Search {
  const size = field.ranked.length;
  const next = new Int32Array(size + 1);
  const prev = new Int32Array(size + 1);
  for (let seat = 0; seat <= size; seat += 1) {
    next[seat] = seat === size ? 0 : seat + 1;
    prev[seat] = seat === 0 ? size : seat - 1;
  }
  prev[size] = size - 1;
  const metLeft = Int32Array.from(field.met, seats => seats.length);
  return { field, next, prev, open: size, metLeft, pairings: [], rematches, steps: 0, budget };
}

function take(state: Search, seat: number): void {
  const { next, prev } = state;
  next[prev[seat] as number] = next[seat] as number;
  prev[next[seat] as number] = prev[seat] as number;
  state.open -= 1;
  for (const opponent of state.field.met[seat] ?? []) {
    state.metLeft[opponent] = (state.metLeft[opponent] as number) - 1;
  }
}

/** Undoes the latest `take` still standing: seats come back in the reverse of the order they went. */
function untake(state: Search, seat: number): void {
  const { next, prev } = state;
  next[prev[seat] as number] = seat;
  prev[next[seat] as number] = seat;
  state.open += 1;
  for (const opponent of state.field.met[seat] ?? []) {
    state.metLeft[opponent] = (state.metLeft[opponent] as number) + 1;
  }
}

/** The first unseated seat: the walk seats from the top, so every seat above it is taken. */
const firstOpen = (state: Search) => state.next[state.field.ranked.length] as number;

/**
 * Whether an unseated player has met everyone still unseated, so only a
 * rematch can seat them. Nobody can have until the players left fit inside
 * one player's history, and by then they are few, so the look costs at most
 * that history's length.
 */
function stranded(state: Search): boolean {
  const others = state.open - 1;
  if (others < 1 || others > state.field.mostMet) {
    return false;
  }
  const end = state.field.ranked.length;
  for (let seat = firstOpen(state); seat !== end; seat = state.next[seat] as number) {
    if (state.metLeft[seat] === others) {
      return true;
    }
  }
  return false;
}

/**
 * The first unseated seat after `from` (`seat` itself, or an opponent it
 * tried) whose player the one in `seat` has met (`rematch`) or not; the
 * field's length if none, or once the walk is out of steps. Each seat looked
 * at is a step.
 */
function nextOpponent(state: Search, seat: number, from: number, rematch: boolean): number {
  const end = state.field.ranked.length;
  const met = state.field.met[seat] ?? [];
  // `seat` is taken, so its old link may be stale; every open seat is below it anyway.
  let other = from === seat ? firstOpen(state) : (state.next[from] as number);
  while (other !== end && state.steps < state.budget) {
    state.steps += 1;
    if (met.includes(other) === rematch) {
      return other;
    }
    other = state.next[other] as number;
  }
  return end;
}

/**
 * The seat's next opponent after `after`, its last try: new opponents in
 * order, then, with rematches left, old ones. Null when none is left, or the
 * walk is out of steps.
 */
function nextChoice(state: Search, seat: number, after: Choice | null): Choice | null {
  const end = state.field.ranked.length;
  const phases = after?.rematch ? [true] : [false, true];
  for (const rematch of phases) {
    const from = after && after.rematch === rematch ? after.other : seat;
    const other = rematch && state.rematches === 0 ? end : nextOpponent(state, seat, from, rematch);
    if (other !== end) {
      return { seat, other, rematch };
    }
  }
  return null;
}

function pair(state: Search, choice: Choice): void {
  const { ranked } = state.field;
  take(state, choice.other);
  state.rematches -= choice.rematch ? 1 : 0;
  state.pairings.push({ p1: ranked[choice.seat] as string, p2: ranked[choice.other] as string });
}

function unpair(state: Search, choice: Choice): void {
  state.pairings.pop();
  state.rematches += choice.rematch ? 1 : 0;
  untake(state, choice.other);
}

/** Whether a pairing just made leaves the rest unpairable within the rules: a player only a rematch could seat. */
const deadEnd = (state: Search) => state.rematches === 0 && stranded(state);

/**
 * Pairs the unseated seats top first: each takes the first new opponent below
 * them, and a rematch only where no new one leads through. False if it cannot
 * within its rematches and budget.
 */
function search(state: Search): boolean {
  const end = state.field.ranked.length;
  const choices: Choice[] = [];
  let last: Choice | null = null;
  let seat = firstOpen(state);
  while (seat !== end) {
    if (!last) {
      take(state, seat);
    }
    const choice = nextChoice(state, seat, last);
    if (choice) {
      pair(state, choice);
      if (deadEnd(state)) {
        unpair(state, choice);
        last = choice;
        continue;
      }
      choices.push(choice);
      last = null;
      seat = firstOpen(state);
      continue;
    }
    // Nothing left for this seat: undo the choice above it and try past that.
    untake(state, seat);
    last = choices.pop() ?? null;
    if (!last || state.steps >= state.budget) {
      return false;
    }
    unpair(state, last);
    ({ seat } = last);
  }
  return true;
}

interface Walk {
  pairings: Pairing[] | null;
  steps: number;
}

function walk(field: Field, rematches: number, budget: number): Walk {
  const state = newSearch(field, rematches, budget);
  return { pairings: search(state) ? state.pairings : null, steps: state.steps };
}

/** Rematch-free if the field allows it; otherwise the fewest rematches the walks find within the budget. */
function pairRanked(ranked: readonly string[], history: PairingHistory): Pairing[] {
  const field = fieldOf(ranked, history);
  const most = Math.floor(ranked.length / 2);
  let left = STEP_BUDGET;
  for (let rematches = 0; rematches < most && left > 0; rematches += 1) {
    const found = walk(field, rematches, left);
    if (found.pairings) {
      return found.pairings;
    }
    left -= found.steps;
  }
  // Every seat may rematch, so the first way down pairs everyone; each still takes a new opponent where one is left.
  return walk(field, most, Number.POSITIVE_INFINITY).pairings ?? [];
}

/**
 * One Swiss round. Pairings come back in table order: the top of the field at
 * table one, the bye last.
 */
export function pairSwiss(entrants: readonly Entrant[], history: PairingHistory, random: Random): Pairing[] {
  const ranked = rankForPairing(entrants, random);
  const bye = ranked.length % 2 === 1 ? pickBye(ranked, history.byes) : undefined;
  const field = bye === undefined ? ranked : ranked.filter(id => id !== bye);
  const pairings = pairRanked(field, history);
  return bye === undefined ? pairings : [...pairings, { p1: bye, p2: null }];
}

/**
 * Seed order for a single-elimination bracket of `size` (a power of two), so
 * that seed 1 meets seed `size` and the top two seeds can only meet in the
 * final: 8 gives 1, 8, 4, 5, 2, 7, 3, 6.
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, next - seed]);
  }
  return order;
}

/** The first round of a top cut: seeds in standings order, paired by bracket position. */
export function pairTopCut(seeds: readonly string[]): Pairing[] {
  const order = bracketOrder(seeds.length);
  const pairings: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const high = seeds[(order[i] ?? 1) - 1];
    const low = seeds[(order[i + 1] ?? 1) - 1];
    if (high !== undefined) {
      pairings.push({ p1: high, p2: low ?? null });
    }
  }
  return pairings;
}

/** The next elimination round: each pair of adjacent matches' winners meet. */
export function pairNextElimination(winners: readonly string[]): Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    const p1 = winners[i];
    if (p1 !== undefined) {
      pairings.push({ p1, p2: winners[i + 1] ?? null });
    }
  }
  return pairings;
}
