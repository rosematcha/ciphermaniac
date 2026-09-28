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
 * try; a step budget stops a pathological one from spinning, and a second pass
 * that allows rematches means a round can always be paired.
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

const STEP_BUDGET = 50_000;

/** Highest points first, shuffled inside each point group. */
export function rankForPairing(entrants: readonly Entrant[], random: Random): string[] {
  const groups = new Map<number, string[]>();
  for (const entrant of entrants) {
    groups.set(entrant.points, [...(groups.get(entrant.points) ?? []), entrant.id]);
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

interface Search {
  history: PairingHistory;
  allowRematch: boolean;
  steps: number;
}

function haveMet(history: PairingHistory, a: string, b: string): boolean {
  return history.opponents.get(a)?.has(b) ?? false;
}

/** Pairs `pool` (ranked) top down, or returns null if it cannot within the rules and budget. */
function pairPool(pool: readonly string[], state: Search): Pairing[] | null {
  const [top, ...rest] = pool;
  if (top === undefined) {
    return [];
  }
  for (let i = 0; i < rest.length; i += 1) {
    state.steps += 1;
    const candidate = rest[i] as string;
    if (state.steps > STEP_BUDGET) {
      return null;
    }
    if (!state.allowRematch && haveMet(state.history, top, candidate)) {
      continue;
    }
    const remainder = pairPool([...rest.slice(0, i), ...rest.slice(i + 1)], state);
    if (remainder) {
      return [{ p1: top, p2: candidate }, ...remainder];
    }
  }
  return null;
}

/** Rematch-free if the field allows it; otherwise the fewest rematches the walk finds first. */
function pairRanked(ranked: readonly string[], history: PairingHistory): Pairing[] {
  const strict = pairPool(ranked, { history, allowRematch: false, steps: 0 });
  if (strict) {
    return strict;
  }
  // Still prefers new opponents: with rematches allowed the walk keeps the ranked order,
  // so a rematch is taken only where the strict pass found no way through.
  return pairPool(ranked, { history, allowRematch: true, steps: 0 }) ?? [];
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
