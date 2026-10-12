import { divisionLookup } from './divisions.js';
import {
  departed,
  eliminationLosers,
  playoffPaired,
  playoffPlayers,
  seatedPlayers,
  survivorList
} from './lifecycleSurvivors.js';
import type { LifecycleContext } from './lifecycleTypes.js';
import { seatElimination } from './lifecyclePairing.js';
import { newRound, replacePods, selectedPods } from './lifecycleWorkflow.js';
import { type Pairing, PairingError, pairNextElimination, pairTopCut } from './pairing.js';
import { countsComplete, latestRound, regularRounds } from './rounds.js';
import { swissStandings } from './standings.js';
import { type Division, DIVISIONS, type Player, type Pod, type PodCategory, type Tournament } from './types.js';

export function bracketPlayers(
  players: Player[],
  seeds: string[],
  pairings: readonly Pairing[],
  writeSeed: boolean
): Player[] {
  const seedOf = new Map(seeds.map((id, index) => [id, index + 1]));
  const order = pairings.flatMap(p => (p.p2 === null ? [p.p1] : [p.p1, p.p2]));
  const orderOf = new Map(order.map((id, index) => [id, index + 1]));
  return players.map(p =>
    orderOf.has(p.id) ? { ...p, order: orderOf.get(p.id)!, ...(writeSeed ? { seed: seedOf.get(p.id)! } : {}) } : p
  );
}

type Flight = NonNullable<Pod['flights']>[number];

function podFlights(pod: Pod): Flight[] {
  return pod.flights?.length ? pod.flights : [{ number: 1, playerIds: pod.playerIds }];
}

/** V18-1: each flight is its own bracket, seeded in the order the saved flight lists its members. */
export function startEliminationOnly(t: Tournament, ctx: LifecycleContext): Tournament {
  let { players } = t;
  const pods = t.pods.map(pod => {
    if (pod.playerIds.length < 2) {
      return pod;
    }
    const brackets = podFlights(pod).map(flight => {
      const pairings = pairTopCut(flight.playerIds);
      players = bracketPlayers(players, flight.playerIds, pairings, false);
      return pairings;
    });
    const matches = seatElimination(t, pod, brackets, ctx);
    return {
      ...pod,
      survivors: [...pod.playerIds],
      rounds: [newRound(t, pod, { matches, kind: 'elimination' }, ctx)]
    };
  });
  return { ...t, players, pods };
}

function cutSeeds(t: Tournament, pod: Pod, division: Division, size: number): string[] {
  const of = divisionLookup(t);
  const flights = pod.flights ?? [{ number: 1, playerIds: pod.playerIds }];
  const rows = flights.map(f =>
    swissStandings(pod, t.players, {
      only: new Set(f.playerIds.filter(id => of(id) === division)),
      regularRounds: regularRounds(t, pod)
    })
      .filter(row => !row.dropped)
      .slice(0, size / flights.length)
  );
  const seeds: string[] = [];
  for (let index = 0; index < size / flights.length; index += 1) {
    for (const flight of rows) {
      const row = flight[index];
      if (row) {
        seeds.push(row.playerId);
      }
    }
  }
  return seeds;
}

export function initializeCuts(t: Tournament, category: PodCategory | undefined, ctx: LifecycleContext): Tournament {
  let { players } = t;
  const pods = selectedPods(t, category).map(pod => {
    const last = latestRound(pod);
    if (pod.stage !== 0 || last?.kind !== 'swiss' || last.number < regularRounds(t, pod) || !countsComplete(last)) {
      throw new PairingError('Finish Swiss results before starting the cut');
    }
    const cuts = { ...pod.divisionCuts };
    const pairings: Pairing[] = [];
    const qualifiers: string[] = [];
    for (const division of [...DIVISIONS].reverse()) {
      const size = cuts[division]?.size ?? 0;
      const seeds = cutSeeds(t, pod, division, size);
      if (seeds.length < 2) {
        continue;
      }
      const pairs = pairTopCut(seeds);
      players = bracketPlayers(players, seeds, pairs, true);
      cuts[division] = { size, playoff3rd4th: pod.playoff3rd4th, playerIds: seeds };
      pairings.push(...pairs);
      qualifiers.push(...seeds);
    }
    const matches = seatElimination(t, pod, [pairings], ctx);
    const rounds = matches.length
      ? [...pod.rounds, newRound(t, pod, { matches, kind: 'elimination' }, ctx)]
      : pod.rounds;
    return { ...pod, divisionCuts: cuts, stage: 1 as const, rounds, survivors: qualifiers, playoffsPaired: [] };
  });
  return { ...replacePods(t, pods), players };
}

/** Statement 26: players without a bracket position first, then by position, keeping list order among equals. */
function byPosition(t: Tournament, ids: readonly string[]): string[] {
  const order = new Map(t.players.map(p => [p.id, p.order ?? 0]));
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Statement 26: a departed player in a pair leaves the other a random bye, the first seat checked first, so the
 * second seat keeps the bye even when both have departed (`bx4-elimflights-51923`).
 */
function withoutDeparted(t: Tournament, pairings: readonly Pairing[]): Pairing[] {
  return pairings.map(({ p1, p2 }) => {
    if (p2 === null) {
      return { p1, p2 };
    }
    if (departed(t, p1)) {
      return { p1: p2, p2: null };
    }
    return departed(t, p2) ? { p1, p2: null } : { p1, p2 };
  });
}

export interface Bracket {
  pairings: Pairing[];
  playoff?: Pairing;
}

/** The next round of one bracket: nothing for fewer than two, or for a final already played out. */
export function nextBracket(t: Tournament, pod: Pod, list: string[], last: boolean): Bracket | undefined {
  if (list.length < 2) {
    return undefined;
  }
  const finalists = list.length % 2 ? list.slice(1) : list;
  const [third, fourth] = playoffCandidates(t, pod, finalists, !(list.length === 2 && last));
  const pairings = list.length === 2 && last ? [] : withoutDeparted(t, pairNextElimination(list));
  return third && fourth
    ? { pairings, playoff: { p1: third, p2: fourth } }
    : pairings.length
      ? { pairings }
      : undefined;
}

/** V18-1: every flight of an elimination-only pod pairs its own bracket, or the round is not created. */
function flightBrackets(t: Tournament, pod: Pod, number: number): Bracket[] | undefined {
  const lost = eliminationLosers(pod);
  const deleted = (latestRound(pod)?.matches ?? []).filter(m => m.outcome === 'deleted').map(m => m.p1);
  const scheduled = Math.ceil(Math.log2(t.players.length));
  const brackets = podFlights(pod).map(flight => {
    const members = flight.playerIds.filter(id => !departed(t, id) && !lost.has(id));
    const current = members.length === 2 ? pod : { ...pod, playoff3rd4th: false };
    return nextBracket(t, current, byPosition(t, [...members, ...deleted]), number > scheduled);
  });
  return brackets.every(Boolean) ? (brackets as Bracket[]) : undefined;
}

/** V18-11: each division pairs its surviving cut players who have not departed and have not lost. */
function divisionBrackets(t: Tournament, pod: Pod, number: number): Bracket[] {
  const of = divisionLookup(t);
  const lost = eliminationLosers(pod);
  const swiss = pod.rounds.filter(r => r.kind === 'swiss').length;
  const survivors = survivorList(t, pod).filter(id => !departed(t, id) && !lost.has(id));
  return [...DIVISIONS].reverse().flatMap(division => {
    const size = pod.divisionCuts?.[division]?.size ?? pod.cut;
    const list = byPosition(
      t,
      survivors.filter(id => of(id) === division)
    );
    const bracket = nextBracket(t, pod, list, number > swiss + Math.ceil(Math.log2(Math.max(size, 1))));
    return bracket ? [bracket] : [];
  });
}

function attemptsPlayoff(t: Tournament, pod: Pod, winners: string[]): boolean {
  if (!pod.playoff3rd4th || winners.length !== 2) {
    return false;
  }
  const division = divisionLookup(t)(winners[0]!);
  return t.settings?.type === 1
    ? pod.playerIds.length >= 4
    : (pod.divisionCuts?.[division]?.size ?? 0) > 2 && !playoffPaired(pod, division);
}

export function playoffCandidates(t: Tournament, pod: Pod, winners: string[], finalPaired = true): string[] {
  if (!attemptsPlayoff(t, pod, winners)) {
    return [];
  }
  const prior = winners.map(id => {
    const matches = pod.rounds.flatMap(r => r.matches).filter(m => m.p1 === id || m.p2 === id);
    const last = matches.at(-1);
    const opponent = last?.p1 === id ? last.p2 : last?.p1;
    return !finalPaired && winners.includes(opponent ?? '') ? matches.at(-2) : last;
  });
  if (prior.some(m => !m)) {
    throw new PairingError('A third-place playoff requires a previous match for each finalist');
  }
  const candidates: string[] = [];
  for (const i of [1, 0]) {
    const match = prior[i]!;
    if (match.p2 === null) {
      throw new PairingError('A third-place playoff requires a previous two-seat match for each finalist');
    }
    const candidate = match.p1 === winners[i] ? match.p2 : match.p1;
    if (t.players.find(p => p.id === candidate)?.droppedAfter !== null) {
      return [];
    }
    candidates.push(candidate);
  }
  return candidates;
}

/** SPEC 3.9, V18-1: an elimination-only pod is finished once its last scheduled round is complete. */
function playedOut(t: Tournament, last: Pod['rounds'][number]): boolean {
  return t.settings?.type === 1 && last.number >= Math.ceil(Math.log2(t.players.length)) && countsComplete(last);
}

export function nextElimination(t: Tournament, category: PodCategory | undefined, ctx: LifecycleContext): Tournament {
  return replacePods(
    t,
    selectedPods(t, category).map(pod => {
      // A Swiss round appended during the cut (V16-2) is followed by the cut's next round.
      const last = latestRound(pod);
      const cutRound = [...pod.rounds].reverse().find(round => round.kind === 'elimination');
      if (!last || !cutRound) {
        throw new PairingError('There is no elimination round to advance');
      }
      if (playedOut(t, cutRound)) {
        throw new PairingError('The elimination bracket has played all its rounds');
      }
      const brackets =
        t.settings?.type === 1 ? flightBrackets(t, pod, last.number + 1) : divisionBrackets(t, pod, last.number + 1);
      if (!brackets?.length) {
        throw new PairingError('No more elimination rounds can be paired');
      }
      const flights = t.settings?.type === 1 ? brackets.map(bracketPairings) : [brackets.flatMap(bracketPairings)];
      // A paired playoff counts its players before the round's tables are numbered (V16-11).
      const paired = brackets.reduce((current, bracket) => playoffPlayers(t, current, bracket.playoff), pod);
      const matches = seatElimination(replacePods(t, [paired]), paired, flights, ctx);
      const seated = seatedPlayers(t, paired, matches);
      return { ...seated, rounds: [...pod.rounds, newRound(t, pod, { matches, kind: 'elimination' }, ctx)] };
    })
  );
}

export const bracketPairings = (bracket: Bracket): Pairing[] =>
  bracket.playoff ? [...bracket.pairings, bracket.playoff] : bracket.pairings;
