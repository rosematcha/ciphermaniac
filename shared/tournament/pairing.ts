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
const STEP_BUDGET = 50_000;

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

/**
 * One walk's state. Seats are marked taken and pairings pushed as the walk
 * goes down, and undone as it backs up, so a step costs no copying of the
 * field. The walk keeps its choices on a list of its own rather than the call
 * stack, so a field of thousands does not run the stack out.
 */
interface Search {
  ranked: readonly string[];
  history: PairingHistory;
  used: boolean[];
  /** For each seat, the seats of the players it has met. */
  met: number[][];
  /** For each seat, how many of the players it has met are still unseated. */
  metLeft: number[];
  /** Seats that have met anyone, most opponents first: the players a walk can strand. */
  crowded: number[];
  /** Seats still unseated. */
  left: number;
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

function newSearch(ranked: readonly string[], history: PairingHistory, rematches: number, budget: number): Search {
  const seatOf = new Map(ranked.map((id, seat) => [id, seat]));
  const met = ranked.map(id => [...(history.opponents.get(id) ?? [])].flatMap(o => seatOf.get(o) ?? []));
  const crowded = met.flatMap((opponents, seat) => (opponents.length > 0 ? [seat] : []));
  crowded.sort((a, b) => (met[b] ?? []).length - (met[a] ?? []).length);
  return {
    ranked,
    history,
    used: ranked.map(() => false),
    met,
    metLeft: met.map(opponents => opponents.length),
    crowded,
    left: ranked.length,
    pairings: [],
    rematches,
    steps: 0,
    budget
  };
}

function haveMet(history: PairingHistory, a: string, b: string): boolean {
  return history.opponents.get(a)?.has(b) ?? false;
}

function take(state: Search, seat: number, taken: boolean): void {
  state.used[seat] = taken;
  state.left += taken ? -1 : 1;
  for (const opponent of state.met[seat] ?? []) {
    state.metLeft[opponent] = (state.metLeft[opponent] ?? 0) + (taken ? -1 : 1);
  }
}

/** The first seat at or after `from` nobody has taken yet; the field's length when all are taken. */
function nextFree(state: Search, from: number): number {
  let seat = from;
  while (seat < state.ranked.length && state.used[seat]) {
    seat += 1;
  }
  return seat;
}

/**
 * Whether an unseated player has met everyone still unseated, so only a
 * rematch can seat them. Only a player who has met that many can be, so the
 * look stops at the first who has met fewer.
 */
function stranded(state: Search): boolean {
  const others = state.left - 1;
  if (others < 1) {
    return false;
  }
  for (const seat of state.crowded) {
    if ((state.met[seat] ?? []).length < others) {
      return false;
    }
    if (!state.used[seat] && state.metLeft[seat] === others) {
      return true;
    }
  }
  return false;
}

/**
 * The first untaken seat after `from` whose player `top` has met (`rematch`)
 * or not; the field's length if none, or once the walk is out of steps. Each
 * seat looked at is a step.
 */
function nextOpponent(state: Search, top: string, from: number, rematch: boolean): number {
  let other = from + 1;
  while (other < state.ranked.length && state.steps < state.budget) {
    state.steps += 1;
    if (!state.used[other] && haveMet(state.history, top, state.ranked[other] as string) === rematch) {
      return other;
    }
    other += 1;
  }
  return state.ranked.length;
}

/**
 * The seat's next opponent after `after`, its last try: new opponents in
 * order, then, with rematches left, old ones. Null when none is left, or the
 * walk is out of steps.
 */
function nextChoice(state: Search, seat: number, after: Choice | null): Choice | null {
  const top = state.ranked[seat] as string;
  const phases = after?.rematch ? [true] : [false, true];
  for (const rematch of phases) {
    const from = after && after.rematch === rematch ? after.other : seat;
    const other = rematch && state.rematches === 0 ? state.ranked.length : nextOpponent(state, top, from, rematch);
    if (other < state.ranked.length) {
      return { seat, other, rematch };
    }
  }
  return null;
}

function pair(state: Search, choice: Choice): void {
  take(state, choice.other, true);
  state.rematches -= choice.rematch ? 1 : 0;
  state.pairings.push({ p1: state.ranked[choice.seat] as string, p2: state.ranked[choice.other] as string });
}

function unpair(state: Search, choice: Choice): void {
  state.pairings.pop();
  state.rematches += choice.rematch ? 1 : 0;
  take(state, choice.other, false);
}

/** Whether a pairing just made leaves the rest unpairable within the rules: a player only a rematch could seat. */
const deadEnd = (state: Search) => state.rematches === 0 && stranded(state);

/**
 * Pairs the untaken seats top first: each takes the first new opponent below
 * them, and a rematch only where no new one leads through. False if it cannot
 * within its rematches and budget.
 */
function search(state: Search): boolean {
  const choices: Choice[] = [];
  let last: Choice | null = null;
  let seat = nextFree(state, 0);
  while (seat < state.ranked.length) {
    if (!last) {
      take(state, seat, true);
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
      seat = nextFree(state, seat + 1);
      continue;
    }
    // Nothing left for this seat: undo the choice above it and try past that.
    take(state, seat, false);
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

function walk(ranked: readonly string[], history: PairingHistory, rematches: number, budget: number): Walk {
  const state = newSearch(ranked, history, rematches, budget);
  return { pairings: search(state) ? state.pairings : null, steps: state.steps };
}

/** Rematch-free if the field allows it; otherwise the fewest rematches the walks find within the budget. */
function pairRanked(ranked: readonly string[], history: PairingHistory): Pairing[] {
  const most = Math.floor(ranked.length / 2);
  let left = STEP_BUDGET;
  for (let rematches = 0; rematches < most && left > 0; rematches += 1) {
    const found = walk(ranked, history, rematches, left);
    if (found.pairings) {
      return found.pairings;
    }
    left -= found.steps;
  }
  // Every seat may rematch, so the first way down pairs everyone; each still takes a new opponent where one is left.
  return walk(ranked, history, most, Number.POSITIVE_INFINITY).pairings ?? [];
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
