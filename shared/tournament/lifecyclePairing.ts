import { divisionLookup } from './divisions.js';
import { repairSurvivors } from './lifecycleRepair.js';
import { eliminationLosers } from './lifecycleSurvivors.js';
import { pairingTableStart, tableCeiling } from './lifecycleTables.js';
import type { LifecycleContext } from './lifecycleTypes.js';
import { newRound, replacePods, scheduledFinal, selectedPods } from './lifecycleWorkflow.js';
import { type Entrant, type Pairing, PairingError, pairSwiss, SearchExhausted, sortSwissPairings } from './pairing.js';
import {
  activeIds,
  countsComplete,
  fixedTables,
  latestRound,
  type MatchStamp,
  pairingHistory,
  pointsBefore,
  regularRounds,
  seatPairings
} from './rounds.js';
import {
  DIVISIONS,
  type Match,
  type Player,
  type Pod,
  type PodCategory,
  type Round,
  type Tournament
} from './types.js';

export function stamp(t: Tournament, pod: Pod, ctx: LifecycleContext, taken: ReadonlySet<number>) {
  return tableStamp(t, pod, ctx, { taken, repairing: false });
}

/** A repair numbers the round it repairs, so its own tables are not another round's (statement 21b). */
export function repairStamp(t: Tournament, pod: Pod, ctx: LifecycleContext, taken: ReadonlySet<number>) {
  return tableStamp(t, pod, ctx, { taken, repairing: true });
}

function tableStamp(
  t: Tournament,
  pod: Pod,
  ctx: LifecycleContext,
  { taken, repairing }: { taken: ReadonlySet<number>; repairing: boolean }
) {
  return {
    firstTable: pod.rounds.length ? pairingTableStart(t, pod) : pod.startingTable,
    timestamp: ctx.localTime,
    fixed: new Map([...fixedTables(t)].filter(([id]) => pod.playerIds.includes(id))),
    taken: new Set([
      ...taken,
      ...(pod.playerIds.some(id => fixedTables(t).has(id)) ? [] : overflowTables(t, pod, ctx, repairing)),
      ...(ctx.recorded?.heldRepairTables ?? [])
    ]),
    blocked: pod.blockedRanges,
    ceiling: tableCeiling(t, pod),
    overflow: t.settings?.overflowTableStart
  };
}

function overflowTables(
  t: Tournament,
  pod: Pod,
  ctx: Pick<LifecycleContext, 'terminalPairing'>,
  repairing = false
): number[] {
  if (t.pods.length < 2) {
    return [];
  }
  const overflow = t.settings?.overflowTableStart ?? 0;
  // Statement 21b: a terminal attempt also skips its own previous round, which a repair is still numbering.
  const own = ctx.terminalPairing && !repairing;
  return t.pods
    .filter(p => p !== pod || own)
    .flatMap(
      p =>
        latestRound(p)
          ?.matches.filter(m => m.p2 !== null && m.table >= overflow)
          .map(m => m.table) ?? []
    );
}

function otherOverflowTables(t: Tournament, pod: Pod): number[] {
  return overflowTables(t, pod, {}).filter(
    table => !latestRound(pod)?.matches.some(m => m.p2 !== null && m.table === table)
  );
}

function singles(ids: string[], outcome: Match['outcome'], timestamp: string): Match[] {
  return ids.map(p1 => ({ p1, p2: null, table: 0, outcome, timestamp }));
}

export interface FlightBatch {
  number: number;
  ids: readonly string[];
  kept: Match[];
  repair: boolean;
}

/** Each freshly paired round consumes one award; an absence defers it and a repair never grants it. */
function holdsAssignedBye(pod: Pod, player: Player, number: number): boolean {
  const awarded = pod.rounds
    .filter(r => r.kind === 'swiss' && r.number < number)
    .reduce((count, r) => count + r.matches.filter(m => m.outcome === 'assigned-bye' && m.p1 === player.id).length, 0);
  return awarded + (player.forfeitedByes ?? 0) < (player.byes ?? 0);
}

export function flightField(
  t: Tournament,
  pod: Pod,
  { number, ids, kept, repair }: FlightBatch,
  ctx: LifecycleContext
): {
  assigned: string[];
  forced: string[];
  entrants: Entrant[];
} {
  const lost = eliminationLosers(pod);
  const active = new Set(activeIds(t, pod).filter(id => !lost.has(id)));
  const seated = new Set(kept.flatMap(m => [m.p1, m.p2]));
  // V18-3: a repair returns every seat of a dissolved match to the pool, a departed player's included.
  const round = repair ? (latestRound(pod)?.matches ?? []) : [];
  const dissolved = new Set(round.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])));
  const players = t.players.filter(
    p => ids.includes(p.id) && (active.has(p.id) || dissolved.has(p.id)) && !seated.has(p.id)
  );
  const assigned = repair ? [] : players.filter(p => holdsAssignedBye(pod, p, number)).map(p => p.id);
  const forced = repair
    ? []
    : players
        .filter(p => p.lateData?.forcedLoss && !p.lateData.usedForcedLoss && p.lateData.round === number)
        .map(p => p.id);
  const excluded = new Set([...assigned, ...forced]);
  const points = pointsBefore(pod, number + Number(Boolean(repair && ctx.terminalPairing)));
  const of = divisionLookup(t);
  const entrants = players
    .filter(p => !excluded.has(p.id))
    .map(p => ({
      id: p.id,
      // V22-1: a player without a record pairs with no match points.
      points: pod.lostRecords?.includes(p.id) ? 0 : (points.get(p.id) ?? 0),
      category: DIVISIONS.indexOf(of(p.id))
    }));
  return { assigned, forced, entrants };
}

/** V18-2: a flight with nobody left to pair, or whose search gives up, fails the pairing attempt. */
export class FlightFailure extends PairingError {
  constructor(
    message: string,
    readonly flight: readonly string[]
  ) {
    super(message);
  }
}

function flightMatches(t: Tournament, pod: Pod, batch: FlightBatch, ctx: LifecycleContext): Match[] {
  const { number, kept } = batch;
  const { assigned, forced, entrants } = flightField(t, pod, batch, ctx);
  if (!entrants.length && kept.some(m => batch.ids.includes(m.p1))) {
    return [];
  }
  if (!entrants.length) {
    throw new FlightFailure('An empty ordinary flight cannot produce a round', batch.ids);
  }
  const available = new Set(entrants.map(e => e.id));
  const recorded = ctx.recorded?.pairings?.[pod.category]?.filter(p => available.has(p.p1));
  const seats = searchedFlight(
    () =>
      pairSwiss(entrants, pairingHistory(pod, number), ctx.random, {
        round: number,
        recorded,
        freshByes: ctx.recorded?.freshRandomByes
      }),
    batch.ids
  );
  const pairings = recorded ? seats : sortSwissPairings(seats, entrants);
  const tables = new Set(kept.filter(m => m.p2 !== null).map(m => m.table));
  const matches = seatPairings(pairings, tableStamp(t, pod, ctx, { taken: tables, repairing: batch.repair }));

  return [...singles(assigned, 'assigned-bye', ctx.localTime), ...singles(forced, 'loss', ctx.localTime), ...matches];
}

function searchedFlight<T>(search: () => T, flight: readonly string[]): T {
  try {
    return search();
  } catch (error) {
    throw error instanceof SearchExhausted ? new FlightFailure(error.message, flight) : error;
  }
}

function checkedSwissRepair(last: ReturnType<typeof latestRound>, terminal: boolean): void {
  if (!last || last.kind !== 'swiss') {
    throw new PairingError('Only a Swiss round can be repaired');
  }
  const refused = terminal ? [4, 5].includes(last.stage ?? 4) : (last.stage ?? 4) >= 4;
  if (refused) {
    throw new PairingError('Only a paired, not-started Swiss round can be repaired');
  }
}

export function validateSwissRound(t: Tournament, pod: Pod, repair: boolean, terminal: boolean): void {
  const last = latestRound(pod);
  if (repair) {
    checkedSwissRepair(last, terminal);
    return;
  }
  if (last && last.number >= regularRounds(t, pod) && countsComplete(last) && pod.stage !== 1) {
    throw new PairingError('This Swiss pod is complete');
  }
}

const sameSeats = (a: Pick<Match, 'p1' | 'p2'>, b: Pick<Match, 'p1' | 'p2'>) => a.p1 === b.p1 && a.p2 === b.p2;

/** V19-5: force the abandoned search's saved choices while computing stage and unsaved waiting seats. */
function partialSwissRepair(t: Tournament, pod: Pod, ctx: LifecycleContext): Pod | undefined {
  const recorded = ctx.recorded?.partialRepair?.[pod.category];
  if (!recorded) {
    return undefined;
  }
  validateSwissRound(t, pod, true, ctx.terminalPairing ?? false);
  const last = latestRound(pod)!;
  const kept = repairSurvivors(t, pod, ctx);
  const fresh = recorded.filter(m => !kept.some(k => sameSeats(k, m)));
  const retained = kept.every(k =>
    recorded.some(m => sameSeats(k, m) && m.table === k.table && m.outcome === k.outcome)
  );
  if (!retained || fresh.some(m => m.table !== 0 || (m.p2 === null ? m.outcome !== 'bye' : m.outcome !== 'pending'))) {
    throw new PairingError('A partial repair must preserve retained matches and leave new matches untabled');
  }
  const matches = recorded.map(m => kept.find(k => sameSeats(k, m)) ?? { ...m, timestamp: ctx.localTime });
  const seated = new Set(matches.flatMap(m => [m.p1, m.p2]));
  const omitted = activeIds(t, pod).filter(id => !seated.has(id));
  const stage = repairedStage(createdStage(last, { list: kept, fresh }).stage ?? 2, ctx);
  const round = { ...last, matches, stage, status: 'paired' as const };
  return { ...pod, repairOmittedPlayers: omitted, rounds: pod.rounds.map(r => (r === last ? round : r)) };
}

function sortedRepair(t: Tournament, pod: Pod, matches: Match[], ctx: LifecycleContext): Match[] {
  const points = pointsBefore(pod, latestRound(pod)!.number + Number(Boolean(ctx.terminalPairing)));
  const of = divisionLookup(t);
  const entrants = pod.playerIds.map(id => ({
    id,
    points: points.get(id) ?? 0,
    category: DIVISIONS.indexOf(of(id)),
    subgroup: pod.flights?.find(f => f.playerIds.includes(id))?.number ?? 1
  }));
  const assigned = matches.filter(m => m.outcome === 'assigned-bye');
  const ordinary = matches.filter(m => m.outcome !== 'assigned-bye');
  const ordered = sortSwissPairings(ordinary, entrants);
  return [...assigned, ...ordered.map(p => ordinary.find(m => m.p1 === p.p1 && m.p2 === p.p2)!)];
}

function orderedMatches(combined: Match[], pod: Pod, ctx: LifecycleContext): Match[] {
  const ordered = ctx.recorded?.pairings?.[pod.category];
  const all = ordered ? ordered.map(p => combined.find(m => m.p1 === p.p1 && m.p2 === p.p2)!) : combined;
  if (all.some(m => !m) || all.length !== combined.length) {
    throw new PairingError('Recorded round seats do not match its generated matches');
  }
  return all;
}

/** V18-9: the pod's range while a repair numbers new matches follows the round as it stands at that moment. */
export function momentRange(t: Tournament, pod: Pod, moment: Round): { firstTable: number; ceiling?: number } {
  const last = latestRound(pod)!;
  const current = { ...pod, rounds: pod.rounds.map(r => (r === last ? moment : r)) };
  const now = replacePods(t, [current]);
  return { firstTable: pairingTableStart(now, current), ceiling: tableCeiling(now, current) };
}

/** V18-9: the repaired round as it stands while new matches are numbered decides whether its pod is finished. */
export function finishedAtRepair(
  t: Tournament,
  pod: Pod,
  round: Round,
  list: readonly Match[]
): { finished: boolean; stage: number } {
  const stage = round.stage ?? 2;
  if (!scheduledFinal(t, pod, round)) {
    return { finished: false, stage };
  }
  if (stage >= 5) {
    return { finished: true, stage };
  }
  const complete = list.length > 0 && list.every(m => m.outcome !== 'pending');
  return { finished: complete, stage: complete ? 5 : stage };
}

/**
 * V18-3: creating a one-seat match returns a round at 6 to 8 to 4 while the round holds nothing or a pending
 * two-seat match. Only a terminal attempt reaches such a round.
 */
export function createdStage(
  round: Round,
  moment: { list: readonly Match[]; fresh: readonly Match[]; apart?: readonly Match[] }
): Round {
  const bye = moment.fresh.findIndex(m => m.p2 === null);
  const list = [...moment.list, ...(moment.apart ?? []), ...moment.fresh.slice(0, Math.max(bye, 0))];
  const open = !list.length || list.some(m => m.p2 !== null && m.outcome === 'pending');
  return (round.stage ?? 2) >= 5 && bye >= 0 && open ? { ...round, stage: 4 } : round;
}

/** V18-3: with no surviving match, the recorded stage shows that the pool's pairing took the matches apart. */
function apartMatches(round: Round, kept: readonly Match[], ctx: LifecycleContext): Match[] {
  return ctx.recorded?.takenApart && !kept.some(m => m.p2 !== null) ? round.matches.filter(m => m.p2 !== null) : [];
}

/** The ordinary repair saves 2 for a round below 5; a terminal attempt keeps the stage. */
export function repairedStage(stage: number, ctx: LifecycleContext): number {
  return ctx.terminalPairing || stage >= 5 ? stage : 2;
}

/**
 * V18-9: a finished pod under automatic numbering has no range, so its new two-seat matches have no table and every
 * tabled two-seat match moves, in list order, to the overflow range.
 */
export function finishedTables(
  t: Tournament,
  pod: Pod,
  matches: readonly Match[],
  options: { fresh: readonly Match[]; ctx: LifecycleContext }
): Match[] {
  const zeroed = matches.map(m => (options.fresh.includes(m) && m.p2 !== null ? { ...m, table: 0 } : m));
  const tabled = zeroed.filter(m => m.p2 !== null && m.table !== 0);
  const moving = zeroed.some(m => m.table === 0) ? tabled : tabled.slice(1);
  const base = stamp(t, pod, options.ctx, new Set());
  const seated = seatPairings(moving, {
    ...base,
    taken: new Set(pod.playerIds.some(id => fixedTables(t).has(id)) ? [] : otherOverflowTables(t, pod)),
    firstTable: t.settings!.overflowTableStart,
    ceiling: undefined
  });
  return zeroed.map(m => (moving.includes(m) ? { ...m, table: seated[moving.indexOf(m)]!.table } : m));
}

export function swissRound(t: Tournament, pod: Pod, ctx: LifecycleContext, repair = false): Pod {
  validateSwissRound(t, pod, repair, ctx.terminalPairing ?? false);
  return repair && pod.flights && pod.flights.length > 1
    ? repairedFlights(t, pod, ctx)
    : singlePassRound(t, pod, ctx, repair);
}

function singlePassRound(t: Tournament, pod: Pod, ctx: LifecycleContext, repair: boolean): Pod {
  validateSwissRound(t, pod, repair, ctx.terminalPairing ?? false);
  const last = latestRound(pod);
  const number = repair ? last!.number : (last?.number ?? 0) + 1;
  const kept = repair ? repairSurvivors(t, pod, ctx) : [];
  const flights = pod.flights ?? [{ number: 1, playerIds: pod.playerIds }];
  const matches = flights.reduce<Match[]>(
    (made, flight) => [
      ...made,
      ...flightMatches(t, pod, { ids: flight.playerIds, number, kept: [...kept, ...made], repair }, ctx)
    ],
    []
  );
  const combined = [...kept, ...matches];
  const ordered = orderedMatches(repair ? sortedRepair(t, pod, combined, ctx) : combined, pod, ctx);
  if (!repair) {
    const round = newRound(t, pod, { matches: freshTables(t, pod, ordered, ctx), kind: 'swiss' }, ctx);
    return { ...pod, rounds: [...pod.rounds, round] };
  }
  const apart = apartMatches(last!, kept, ctx);
  const moment = finishedAtRepair(t, pod, createdStage(last!, { list: kept, fresh: matches, apart }), kept);
  const all =
    moment.finished && t.settings?.autoTables
      ? finishedTables(t, pod, ordered, { fresh: matches, ctx })
      : numberedMatches(t, pod, ordered, { kept, ctx, moment: { ...last!, stage: moment.stage, matches: kept } });
  const stage = repairedStage(moment.stage, ctx);
  const round: Round = { ...last!, matches: all, stage, status: 'paired' };
  return { ...pod, rounds: pod.rounds.map(r => (r === last ? round : r)) };
}

/** V18-13: a fresh round is numbered flight by flight, in its final order. */
function freshTables(t: Tournament, pod: Pod, ordered: Match[], ctx: LifecycleContext): Match[] {
  const flightOf = (id: string) => pod.flights?.findIndex(f => f.playerIds.includes(id)) ?? 0;
  const groups = new Map<number, Match[]>();
  for (const match of ordered) {
    groups.set(flightOf(match.p1), [...(groups.get(flightOf(match.p1)) ?? []), match]);
  }
  const seated = seatedFlights([...groups.values()], stamp(t, pod, ctx, new Set()));
  const flat = [...groups.values()].flat();
  return ordered.map(m => ({ ...m, table: seated[flat.indexOf(m)]!.table }));
}

/** The ordinary repair returns a completed round at an acknowledgment stage unchanged; a terminal one repairs it. */
function acknowledgedRepair(pod: Pod, terminal: boolean): boolean {
  const round = latestRound(pod);
  return Boolean(
    !terminal && round && [6, 8].includes(round.stage ?? 0) && round.matches.every(m => m.outcome !== 'pending')
  );
}

function terminalNothingToPlace(t: Tournament, pod: Pod): boolean {
  const round = latestRound(pod);
  if (!round || [4, 5].includes(round.stage ?? 4)) {
    return false;
  }
  const seated = new Set(round.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])));
  return !round.matches.some(m => m.outcome === 'bye') && activeIds(t, pod).every(id => seated.has(id));
}

function repairedSwissRound(t: Tournament, pod: Pod, ctx: LifecycleContext, repair: boolean): Pod {
  const partial = repair ? partialSwissRepair(t, pod, ctx) : undefined;
  if (partial) {
    return partial;
  }
  const unchanged = unchangedRepair(t, pod, repair, ctx);
  if (unchanged) {
    return unchanged;
  }
  try {
    return swissRound(t, pod, ctx, repair);
  } catch (error) {
    if (!repair || ctx.recorded?.retainedTables !== undefined || !(error instanceof PairingError)) {
      throw error;
    }
    // Ordinary search may need to release further pending matches to pair the pool.
    return swissRound(t, pod, { ...ctx, recorded: { ...ctx.recorded, retainedTables: [] } }, true);
  }
}

export function pairSwissPods(
  t: Tournament,
  category: PodCategory | undefined,
  ctx: LifecycleContext,
  repair = false
): Tournament {
  return selectedPods(t, category).reduce((current, pod) => {
    const paired = repairedSwissRound(current, pod, ctx, repair);
    const next = replacePods(current, [paired]);
    return repair ? consumedRepairByes(next, pod, paired) : next;
  }, t);
}

export function seatElimination(
  t: Tournament,
  pod: Pod,
  flights: readonly (readonly Pairing[])[],
  ctx: LifecycleContext
): Match[] {
  const pairings = flights.flat();
  if (!pairings.length) {
    return [];
  }
  const future = {
    ...pod,
    rounds: [
      ...pod.rounds,
      newRound(
        t,
        pod,
        {
          kind: 'elimination',
          matches: pairings.map(p => ({ ...p, table: 0, outcome: 'pending', timestamp: ctx.localTime }))
        },
        ctx
      )
    ]
  };
  const ceiling = tableCeiling(replacePods(t, [future]), future);
  return seatedFlights(flights, { ...stamp(t, pod, ctx, new Set()), ceiling, ignoreFixed: t.settings?.type !== 1 });
}

/** V18-13: each flight of a fresh round numbers from the pod's start; earlier flights hold only in-range tables. */
function seatedFlights(flights: readonly (readonly Pairing[])[], base: MatchStamp): Match[] {
  const ceiling = base.ceiling ?? Infinity;
  return flights.reduce<Match[]>((seated, pairings) => {
    const held = seated.filter(m => m.p2 !== null && m.table >= base.firstTable && m.table <= ceiling);
    const taken = new Set([...(base.taken ?? []), ...held.map(m => m.table)]);
    return [...seated, ...seatPairings(pairings, { ...base, taken })];
  }, []);
}

/** V17-4: dissolving an assigned bye consumes its award until a reload. */
function consumedRepairByes(t: Tournament, before: Pod, after: Pod): Tournament {
  const retained = new Set(
    latestRound(after)!
      .matches.filter(m => m.outcome === 'assigned-bye')
      .map(m => m.p1)
  );
  const dissolved = new Set(
    latestRound(before)!
      .matches.filter(m => m.outcome === 'assigned-bye' && !retained.has(m.p1))
      .map(m => m.p1)
  );
  return {
    ...t,
    players: t.players.map(p => (dissolved.has(p.id) ? { ...p, forfeitedByes: (p.forfeitedByes ?? 0) + 1 } : p))
  };
}

/** V17-5: number each flight before dissolving the next flight's matches. */
function repairedFlights(t: Tournament, pod: Pod, ctx: LifecycleContext): Pod {
  const last = latestRound(pod)!;
  const survivors = repairSurvivors(t, pod, ctx);
  const firstBye = last.matches.find(m => m.outcome === 'bye');
  const state = pod.flights!.reduce<FlightRepair>(
    (repaired, flight) =>
      repairFlight(
        t,
        { ...pod, rounds: pod.rounds.map(r => (r === last ? { ...last, stage: repaired.stage } : r)) },
        { ids: flight.playerIds, number: last.number, kept: repaired.matches, repair: true },
        { survivors, ctx, flight: flight.number }
      ),
    { matches: last.matches.filter(m => m !== firstBye), stage: last.stage ?? 2 }
  );
  const ordered = orderedMatches(sortedRepair(t, pod, state.matches, ctx), pod, ctx);
  const round: Round = { ...last, matches: ordered, stage: state.stage, status: 'paired' };
  return { ...pod, rounds: pod.rounds.map(r => (r === last ? round : r)) };
}

/** V17-5: a flight's own held tables, released once it is numbered. */
function flightContext(pod: Pod, ctx: LifecycleContext, flight: number): LifecycleContext {
  const held = ctx.recorded?.heldRepairTablesByFlight?.[pod.category]?.[flight] ?? ctx.recorded?.heldRepairTables;
  return { ...ctx, recorded: { ...ctx.recorded, heldRepairTables: held } };
}

function flightOrder(
  t: Tournament,
  pod: Pod,
  matches: Match[],
  flight: { ctx: LifecycleContext; ids: readonly string[] }
): Match[] {
  const { ctx, ids } = flight;
  const pairings = { [pod.category]: ctx.recorded?.pairings?.[pod.category]?.filter(p => ids.includes(p.p1)) };
  return orderedMatches(sortedRepair(t, pod, matches, ctx), pod, { ...ctx, recorded: { ...ctx.recorded, pairings } });
}

interface FlightRepair {
  matches: Match[];
  stage: number;
}

/** V23-3: a sole waiting flight also pairs the recorded dissolved matches of other flights. */
function repairTurnIds(
  pod: Pod,
  batch: FlightBatch,
  survivors: readonly Match[],
  pool: ReadonlySet<string>
): readonly string[] {
  const last = latestRound(pod)!;
  const firstBye = last.matches.find(m => m.outcome === 'bye');
  const seated = new Set(last.matches.filter(m => m !== firstBye).flatMap(m => [m.p1, m.p2]));
  const waiting = pod.flights!.filter(f => f.playerIds.some(id => pool.has(id) && !seated.has(id)));
  if (waiting.length !== 1 || !waiting[0]!.playerIds.some(id => batch.ids.includes(id))) {
    return batch.ids;
  }
  const dissolved = batch.kept.filter(m => m.p2 !== null && !survivors.some(s => sameSeats(s, m)));
  return [...new Set([...batch.ids, ...dissolved.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))])];
}

/** V23-3: an exhausted repair search releases existing matches from the round's end. */
function repairDraw(t: Tournament, pod: Pod, batch: FlightBatch, ctx: LifecycleContext) {
  let current = batch;
  const held: number[] = [];
  for (;;) {
    const context = {
      ...ctx,
      recorded: { ...ctx.recorded, heldRepairTables: [...(ctx.recorded?.heldRepairTables ?? []), ...held] }
    };
    try {
      return { ...current, ctx: context, fresh: flightMatches(t, pod, current, context) };
    } catch (error) {
      const match = [...current.kept].reverse().find(m => m.p2 !== null);
      if (!(error instanceof FlightFailure) || ctx.recorded?.pairings || !match) {
        throw error;
      }
      held.push(match.table);
      const bye = current.kept.find(m => m.outcome === 'bye');
      current = {
        ...current,
        ids: [...new Set([...current.ids, match.p1, match.p2!, ...(bye ? [bye.p1] : [])])],
        kept: current.kept.filter(m => m !== match && m !== bye)
      };
    }
  }
}

function repairFlight(
  t: Tournament,
  pod: Pod,
  batch: FlightBatch,
  options: { survivors: Match[]; ctx: LifecycleContext; flight: number }
): FlightRepair {
  const { survivors, ctx, flight } = options;
  const last = latestRound(pod)!;
  const seated = new Set(batch.kept.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])));
  // The pool also holds the dissolved bye's holder, departed or not (V18-3).
  const pool = new Set([...activeIds(t, pod), ...last.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))]);
  const unpaired = batch.ids.some(id => pool.has(id) && !seated.has(id));
  if (!unpaired) {
    return { matches: batch.kept, stage: last.stage ?? 2 };
  }
  const turnIds = repairTurnIds(pod, batch, survivors, pool);
  const retained = batch.kept.filter(m => !turnIds.includes(m.p1) || survivors.some(s => sameSeats(s, m)));
  const {
    ids,
    kept,
    fresh,
    ctx: context
  } = repairDraw(t, pod, { ...batch, ids: turnIds, kept: retained }, flightContext(pod, ctx, flight));
  const own = kept.filter(m => ids.includes(m.p1));
  const other = kept.filter(m => !ids.includes(m.p1));
  const all = flightOrder(t, pod, [...own, ...fresh], { ctx: context, ids });
  const moment = finishedAtRepair(t, pod, createdStage(last, { list: kept, fresh }), kept);
  const stage = repairedStage(moment.stage, ctx);
  if (moment.finished && t.settings?.autoTables) {
    const whole = presentOrder(t, pod, [...other, ...all], ctx);
    return { matches: finishedTables(t, pod, whole, { fresh, ctx }), stage };
  }
  const at = { ...last, stage: moment.stage, matches: kept };
  // V17-5: the pass also gives a new table to another flight's match outside the range.
  const range = momentRange(t, pod, at);
  const outside = other.filter(
    m => m.p2 !== null && (m.table < range.firstTable || m.table > (range.ceiling ?? Infinity))
  );
  const inside = other.filter(m => !outside.includes(m));
  // The pass numbers its matches in the round's final order, other flights' included (statement 20).
  const passing = presentOrder(t, pod, [...all, ...outside], ctx);
  const numbered = numberedMatches(t, pod, passing, {
    kept: [...own, ...outside],
    ctx: context,
    other: inside,
    moment: at
  });
  const renumbered = (m: Match) => numbered[passing.indexOf(m)] ?? m;
  return { matches: [...other.map(renumbered), ...all.map(renumbered)], stage };
}

/**
 * The final order of the matches a flight's pass sees. A later flight's match that its own turn will dissolve is
 * not in the recorded order, so it keeps its computed place and the recorded matches fill the others in order.
 */
function presentOrder(t: Tournament, pod: Pod, matches: Match[], ctx: LifecycleContext): Match[] {
  const recorded = (ctx.recorded?.pairings?.[pod.category] ?? []).flatMap(p => matches.filter(m => sameSeats(m, p)));
  let next = 0;
  return sortedRepair(t, pod, matches, ctx).map(m => (recorded.includes(m) ? recorded[next++]! : m));
}

/** V17-5: retained matches outside the regular range are numbered with the new matches in final order. */
function numberedMatches(
  t: Tournament,
  pod: Pod,
  ordered: Match[],
  options: { kept: Match[]; ctx: LifecycleContext; other?: Match[]; moment: Round }
): Match[] {
  const { kept, ctx } = options;
  const range = momentRange(t, pod, options.moment);
  const unchanged = !ctx.terminalPairing && ordered.every(m => kept.includes(m));
  const fixed = kept.filter(m => unchanged || (m.table >= range.firstTable && m.table <= (range.ceiling ?? Infinity)));
  const fresh = ordered.filter(m => !fixed.includes(m));
  const taken = new Set([...fixed, ...(options.other ?? [])].filter(m => m.p2 !== null).map(m => m.table));
  const numbered = seatPairings(fresh, { ...repairStamp(t, pod, ctx, taken), ...range });
  return ordered.map(m => (fixed.includes(m) ? m : { ...m, table: numbered[fresh.indexOf(m)]!.table }));
}

/** V16-3: an ordinary repair with no waiting player keeps its random bye and all existing seats. */
function ordinaryUnstartedRepair(t: Tournament, pod: Pod, repair: boolean, ctx: LifecycleContext): Pod | undefined {
  const last = latestRound(pod);
  if (!repair || ctx.terminalPairing || !last || (last.stage ?? 4) >= 4) {
    return undefined;
  }
  const seated = new Set([
    ...(pod.repairOmittedPlayers ?? []),
    ...last.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))
  ]);
  if (activeIds(t, pod).some(id => !seated.has(id))) {
    return undefined;
  }
  return { ...pod, rounds: pod.rounds.map(r => (r === last ? { ...r, stage: 2, status: 'paired' } : r)) };
}

function unchangedRepair(t: Tournament, pod: Pod, repair: boolean, ctx: LifecycleContext): Pod | undefined {
  if (!repair) {
    return undefined;
  }
  if (ctx.terminalPairing && terminalNothingToPlace(t, pod)) {
    return pod;
  }
  if (acknowledgedRepair(pod, ctx.terminalPairing ?? false)) {
    return pod;
  }
  return ordinaryUnstartedRepair(t, pod, repair, ctx);
}
