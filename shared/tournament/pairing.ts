/** Swiss opponent search and complementary-seed elimination brackets. */

import { bracketOrder } from './seeding.js';
import { type Random, shuffled } from './random.js';

export interface Entrant {
  id: string;
  points: number;
  category?: number;
  subgroup?: number;
}

export interface PairingHistory {
  /** Every opponent each player has already met. */
  opponents: ReadonlyMap<string, ReadonlySet<string>>;
  /** Players who have already had a bye. */
  byes: ReadonlySet<string>;
  /** Players missing the immediately preceding round may lose their record during backtracking. */
  missingPrevious?: ReadonlySet<string>;
}

export interface Pairing {
  p1: string;
  /** Null for the bye. */
  p2: string | null;
}

/** Seats every walk for one round may look at together: a few milliseconds at worst. */
export const STEP_BUDGET = 25_000;

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
  const categories = new Map(entrants.map(e => [e.id, e.category ?? 2]));
  return [...groups.keys()]
    .sort((a, b) => b - a)
    .flatMap(points =>
      shuffled(groups.get(points) ?? [], random).sort((a, b) => (categories.get(b) ?? 2) - (categories.get(a) ?? 2))
    );
}

/** The lowest-ranked player without a previous random bye; exhausted eligibility has no fallback. */
export function pickBye(ranked: readonly string[], byes: ReadonlySet<string>): string | undefined {
  for (let i = ranked.length - 1; i >= 0; i -= 1) {
    const id = ranked[i];
    if (id !== undefined && !byes.has(id)) {
      return id;
    }
  }
  return undefined;
}

/** A round's field as every walk reads it: who sits where, and whom each has met. */
interface Field {
  ranked: readonly string[];
  /** For each seat, the seats of the players it has met: a round's worth or so, so a scan beats a lookup table. */
  met: number[][];
  /** The most opponents any player has met. */
  mostMet: number;
  entrants: ReadonlyMap<string, Entrant>;
  highestPoints: number;
  minimumDifference: number;
  pointDifference: number;
  divisionDifference: number;
}

function fieldOf(ranked: readonly string[], history: PairingHistory, entrants: readonly Entrant[]): Field {
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
  return {
    ranked,
    met,
    mostMet: met.reduce((most, seats) => Math.max(most, seats.length), 0),
    entrants: new Map(entrants.map(e => [e.id, e])),
    highestPoints: Math.max(...entrants.map(e => e.points)),
    minimumDifference: minimumDifference(entrants, history),
    pointDifference: 0,
    divisionDifference: 0
  };
}

/** An isolated entrant proves that narrower point bands cannot pair the field. */
function minimumDifference(entrants: readonly Entrant[], history: PairingHistory): number {
  const sorted = [...entrants].sort((a, b) => a.points - b.points);
  return sorted.reduce((bound, entrant, index) => {
    const met = history.opponents.get(entrant.id);
    const nearest = (direction: number) => {
      for (let other = index + direction; other >= 0 && other < sorted.length; other += direction) {
        if (!met?.has(sorted[other]!.id)) {
          return Math.abs(entrant.points - sorted[other]!.points);
        }
      }
      return Infinity;
    };
    return Math.max(bound, Math.min(nearest(-1), nearest(1)));
  }, 0);
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
  protectedTop: boolean;
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
  return { field, next, prev, open: size, metLeft, pairings: [], rematches, steps: 0, budget, protectedTop: false };
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
    if (met.includes(other) === rematch && permitted(state.field, seat, other)) {
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
 * them. Returns false when no permitted matching exists within the search budget.
 */
function lowerBracketRepair(state: Search): boolean {
  if (state.open !== 2) {
    return false;
  }
  const first = firstOpen(state);
  const second = state.next[first]!;
  const points = (seat: number) => state.field.entrants.get(state.field.ranked[seat]!)?.points;
  return points(first) === points(second) && (state.field.met[first] ?? []).includes(second);
}

function protectsHighest(state: Search, choice: Choice): boolean {
  if (!state.protectedTop) {
    return false;
  }
  const highest = state.field.highestPoints;
  return (
    state.field.entrants.get(state.field.ranked[choice.seat]!)?.points === highest &&
    state.field.entrants.get(state.field.ranked[choice.other]!)?.points === highest
  );
}

function undoForRepair(state: Search, choice: Choice): boolean {
  state.protectedTop ||= lowerBracketRepair(state);
  if (protectsHighest(state, choice)) {
    return false;
  }
  unpair(state, choice);
  return true;
}

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
      const blocked = deadEnd(state);
      if (blocked && !undoForRepair(state, choice)) {
        return false;
      }
      if (blocked) {
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
    if (protectsHighest(state, last)) {
      return false;
    }
    unpair(state, last);
    ({ seat } = last);
  }
  return true;
}

export class PairingError extends Error {}

/** The bounded search found no rematch-free pairing (statement 12, V17-8): one pairing attempt fails. */
export class SearchExhausted extends PairingError {}

function permitted(field: Field, seat: number, other: number): boolean {
  const a = field.entrants.get(field.ranked[seat]!);
  const b = field.entrants.get(field.ranked[other]!);
  return (
    a !== undefined &&
    b !== undefined &&
    Math.abs(a.points - b.points) <= field.pointDifference &&
    Math.abs((a.category ?? 2) - (b.category ?? 2)) <= field.divisionDifference
  );
}

interface Constraints {
  points: number;
  division: number;
}

function pairAt(field: Field, constraints: Constraints, walks: number[]): Pairing[] | null {
  if (constraints.points < field.minimumDifference) {
    return null;
  }
  const constrained = { ...field, pointDifference: constraints.points, divisionDifference: constraints.division };
  const state = newSearch(constrained, 0, STEP_BUDGET);
  const found = search(state);
  walks.push(state.steps);
  return found ? state.pairings : null;
}

function preparedField(prepared: PreparedCandidate, priority: readonly string[], history: PairingHistory): Field {
  const saved = prepared.fields.get(priority);
  if (saved) {
    return saved;
  }
  const field = fieldOf(priority, history, prepared.entrants);
  prepared.fields.set(priority, field);
  return field;
}

function firstRoundByeField(entrants: readonly Entrant[]): readonly Entrant[] {
  const groups = [2, 1, 0].map(category => entrants.filter(e => (e.category ?? 2) === category));
  const odd = groups.filter(group => group.length % 2 === 1);
  const preferred = odd[0];
  return odd.length === 3 || !preferred || preferred.length < 3 ? entrants : preferred;
}

function byeCandidates(entrants: readonly Entrant[], history: PairingHistory, round: number): Entrant[] {
  const field = round === 1 ? firstRoundByeField(entrants) : entrants;
  const eligible = field.filter(e => !history.byes.has(e.id));
  if (!eligible.length) {
    throw new PairingError('No eligible player remains for a random bye');
  }
  const lowest = Math.min(...eligible.map(e => e.points));
  return eligible.filter(e => e.points === lowest);
}

export interface SwissOptions {
  round?: number;
  /** Recorded random seats only; validate coverage and opponent eligibility. */
  recorded?: readonly Pairing[];
  /** V22-5: holders whose earlier random bye a restarted search may have left out of their record. */
  freshByes?: readonly string[];
}

/**
 * Backtracking can move the bye above the lowest bracket (statement 13); it still needs no earlier random bye in the
 * holder's record, which a taken-apart match (V16-9) or a restarted search (V22-5) can lack.
 */
function heldBye(holder: string | undefined, history: PairingHistory, options: SwissOptions): boolean {
  return (
    holder !== undefined &&
    history.byes.has(holder) &&
    !options.freshByes?.includes(holder) &&
    !history.missingPrevious?.has(holder)
  );
}

function recordedPairings(entrants: readonly Entrant[], history: PairingHistory, options: SwissOptions): Pairing[] {
  const pairings = options.recorded!;
  const seats = pairings.flatMap(p => (p.p2 === null ? [p.p1] : [p.p1, p.p2]));
  const ids = new Set(entrants.map(e => e.id));
  if (seats.length !== ids.size || new Set(seats).size !== ids.size || seats.some(id => !ids.has(id))) {
    throw new PairingError('Recorded pairings do not cover the eligible field exactly once');
  }
  if (
    pairings.some(
      p =>
        p.p2 !== null &&
        history.opponents.get(p.p1)?.has(p.p2) &&
        !history.missingPrevious?.has(p.p1) &&
        !history.missingPrevious?.has(p.p2)
    )
  ) {
    throw new PairingError('Recorded pairings repeat a Swiss opponent');
  }
  const byes = pairings.filter(p => p.p2 === null);
  if (byes.length !== entrants.length % 2) {
    throw new PairingError('Recorded pairings have an invalid random bye count');
  }
  if (heldBye(byes[0]?.p1, history, options)) {
    throw new PairingError('Recorded random bye is ineligible');
  }
  return pairings.map(p => ({ ...p }));
}

/**
 * One Swiss round, with the steps its walks took, so a pairing's work can be
 * judged by steps rather than by a clock.
 */
export function pairSwissCounted(
  entrants: readonly Entrant[],
  history: PairingHistory,
  random: Random,
  options: SwissOptions = {}
): { pairings: Pairing[]; steps: number } {
  if (!entrants.length) {
    throw new PairingError('An empty flight cannot pair a round');
  }
  const round = options.round ?? (history.opponents.size || history.byes.size ? 2 : 1);
  if (options.recorded) {
    return { pairings: recordedPairings(entrants, history, { ...options, round }), steps: 0 };
  }
  const ranked = rankForPairing(entrants, random);
  const byes = entrants.length % 2 ? shuffled(byeCandidates(entrants, history, round), random) : [undefined];
  const candidates = byes.map(bye => ({ bye }));
  const inputs = { ranked, entrants, random, cache: new Map<Candidate, PreparedCandidate>(), walks: [] };
  const points = entrants.map(e => e.points);
  const maximum = Math.max(2, Math.max(...points) - Math.min(...points));
  const found = searchCandidates(candidates, history, maximum, inputs);
  if (found) {
    return { pairings: found, steps: inputs.walks.reduce((sum, steps) => sum + steps, 0) };
  }
  throw new SearchExhausted('No more rounds can be paired without repeating an opponent');
}

/** A complete, rematch-free Swiss field, or an explicit refusal without partial matches. */
export function pairSwiss(
  entrants: readonly Entrant[],
  history: PairingHistory,
  random: Random,
  options: SwissOptions = {}
): Pairing[] {
  return pairSwissCounted(entrants, history, random, options).pairings;
}

function retryPriorities(ranked: string[], entrants: readonly Entrant[], random: Random): string[][] {
  const of = new Map(entrants.map(e => [e.id, e]));
  return [
    ranked,
    [...ranked].reverse(),
    [...ranked].sort((a, b) => (of.get(b)?.category ?? 2) - (of.get(a)?.category ?? 2)),
    shuffled(ranked, random)
  ];
}

interface Candidate {
  bye: Entrant | undefined;
}
interface PreparedCandidate {
  priorities: string[][];
  entrants: Entrant[];
  fields: Map<readonly string[], Field>;
}
interface Inputs {
  ranked: string[];
  entrants: readonly Entrant[];
  random: Random;
  cache: Map<Candidate, PreparedCandidate>;
  /** Steps each walk took. */
  walks: number[];
}

function prepareCandidate(candidate: Candidate, inputs: Inputs): PreparedCandidate {
  const saved = inputs.cache.get(candidate);
  if (saved) {
    return saved;
  }
  const ranked = inputs.ranked.filter(id => id !== candidate.bye?.id);
  const entrants = inputs.entrants.filter(e => e.id !== candidate.bye?.id);
  const prepared = {
    priorities: retryPriorities(ranked, entrants, inputs.random),
    entrants,
    fields: new Map<readonly string[], Field>()
  };
  inputs.cache.set(candidate, prepared);
  return prepared;
}

function searchCandidates(
  candidates: Candidate[],
  history: PairingHistory,
  maximum: number,
  inputs: Inputs
): Pairing[] | null {
  for (let points = 0; points <= maximum; points += 1) {
    const found = searchDifference(candidates, history, points, inputs);
    if (found) {
      return found;
    }
  }
  return null;
}

function searchDifference(
  candidates: Candidate[],
  history: PairingHistory,
  points: number,
  inputs: Inputs
): Pairing[] | null {
  for (let division = 0; division <= Math.min(points, 2); division += 1) {
    const found = searchByes(candidates, history, { constraints: { points, division }, inputs });
    if (found) {
      return found;
    }
  }
  return null;
}

function searchByes(
  candidates: Candidate[],
  history: PairingHistory,
  attempt: { constraints: Constraints; inputs: Inputs }
): Pairing[] | null {
  for (const candidate of candidates) {
    const prepared = prepareCandidate(candidate, attempt.inputs);
    for (const priority of prepared.priorities) {
      const found = pairAt(preparedField(prepared, priority, history), attempt.constraints, attempt.inputs.walks);
      if (found) {
        return candidate.bye ? [...found, { p1: candidate.bye.id, p2: null }] : found;
      }
    }
  }
  return null;
}

/** The first round of a top cut: seeds in standings order, paired by bracket position. */
export function pairTopCut(seeds: readonly string[]): Pairing[] {
  const order = bracketOrder(seeds.length);
  const pairings: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const high = seeds[(order[i] ?? 1) - 1];
    const low = seeds[(order[i + 1] ?? 1) - 1];
    if (high !== undefined || low !== undefined) {
      pairings.push({ p1: high ?? low!, p2: high === undefined ? null : (low ?? null) });
    }
  }
  return pairings;
}

/**
 * The next elimination round: each pair of adjacent matches' winners meet.
 * From the semifinals, a cut that plays for third place also pairs their two
 * losers, after the final.
 */
export function pairNextElimination(winners: readonly string[], thirdPlace: readonly string[] = []): Pairing[] {
  const pairings: Pairing[] = winners.length % 2 === 1 ? [{ p1: winners[0]!, p2: null }] : [];
  for (let i = winners.length % 2; i < winners.length; i += 2) {
    const p1 = winners[i];
    if (p1 !== undefined) {
      pairings.push({ p1, p2: winners[i + 1] ?? null });
    }
  }
  const [third, fourth] = thirdPlace;
  return winners.length === 2 && third && fourth ? [...pairings, { p1: third, p2: fourth }] : pairings;
}

/** Stable match order before tables are assigned. */
export function sortSwissPairings(pairings: readonly Pairing[], entrants: readonly Entrant[]): Pairing[] {
  const byId = new Map(entrants.map(e => [e.id, e]));
  const category = (id: string | null) => (id === null ? 10 : (byId.get(id)?.category ?? 2));
  const points = (id: string | null) => (id === null ? 0 : (byId.get(id)?.points ?? 0));
  const subgroup = (pairing: Pairing) => byId.get(pairing.p1)?.subgroup ?? 1;
  return [...pairings].sort(
    (a, b) =>
      Number(b.p2 === null) - Number(a.p2 === null) ||
      subgroup(a) - subgroup(b) ||
      category(b.p1) + category(b.p2) - (category(a.p1) + category(a.p2)) ||
      category(b.p1) - category(a.p1) ||
      points(b.p1) + points(b.p2) - (points(a.p1) + points(a.p2))
  );
}
