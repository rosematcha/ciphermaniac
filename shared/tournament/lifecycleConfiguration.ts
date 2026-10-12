import { applyCommand, podded } from './legacyCommands.js';
import { emptyTournament } from './create.js';
import { divisionLookup, parseTomDate, seasonOf } from './divisions.js';
import { dealFlights, validFlightCount } from './flights.js';
import type { LifecycleContext, LifecycleOperation } from './lifecycleTypes.js';
import { regularRounds, schedulePlayers } from './rounds.js';
import { shuffled } from './random.js';
import { type Division, DIVISIONS, isDivision, type Player, type Pod, type Tournament } from './types.js';

export function createEvent(operation: Extract<LifecycleOperation, { type: 'create' }>): Tournament {
  return {
    ...emptyTournament(operation.info),
    settings: {
      ...operation.settings,
      stage: 1,
      lessSwiss: false,
      autoTables: true,
      overflowTableStart: 0,
      elapsedSeconds: 0
    }
  };
}

export function registerPlayers(
  t: Tournament,
  operation: Extract<LifecycleOperation, { type: 'register' }>,
  ctx: LifecycleContext
): Tournament {
  if ((t.settings?.stage ?? 4) >= 4) {
    throw new Error('Registration after start must use late entry');
  }
  let next = t;
  for (const player of operation.players) {
    const added = applyCommand(next, { type: 'addPlayer', player }, ctx);
    if (!added.ok) {
      throw new Error(added.error);
    }
    next = {
      ...added.tournament,
      settings: next.settings && { ...next.settings, autoTables: next.settings.autoTables && !player.fixedTable },
      players: added.tournament.players.map(p =>
        p.id === player.id
          ? {
              ...p,
              ...(player.byes === undefined ? {} : { byes: player.byes }),
              ...(player.fixedTable === undefined ? {} : { fixedTable: player.fixedTable })
            }
          : p
      ),
      pods: []
    };
  }
  return next;
}

type ConfigureOperation = Extract<LifecycleOperation, { type: 'configure' }>;

/**
 * Tables a pod takes at configuration. The direct operation halves the whole pod; the wizard halves each
 * division row, rounding a combined pod's Seniors row up.
 */
function allotment(of: ReturnType<typeof divisionLookup>, pod: Pod, wizard: boolean): number {
  if (!wizard) {
    return Math.floor(pod.playerIds.length / 2);
  }
  return DIVISIONS.reduce((sum, division) => {
    const players = pod.playerIds.filter(id => of(id) === division).length / 2;
    return sum + (division === 'senior' && !isDivision(pod.category) ? Math.ceil(players) : Math.floor(players));
  }, 0);
}

function startingTables(t: Tournament, pods: Pod[], wizard: boolean): { pods: Pod[]; highest: number } {
  const of = divisionLookup(t);
  let table = 1;
  const started = pods.map(pod => {
    const startingTable = table;
    table += allotment(of, pod, wizard);
    return { ...pod, startingTable };
  });
  return { pods: started, highest: table - 1 };
}

/** The wizard keeps a larger overflow input only with automatic numbering; clearing it keeps the proposal. */
function overflowStart(op: ConfigureOperation, proposed: number, autoTables: boolean): number {
  if (!op.wizard) {
    return op.overflowTableStart ?? proposed;
  }
  return autoTables ? Math.max(proposed, op.overflowTableStart ?? 0) : proposed;
}

/** The wizard offers automatic numbering and an overflow start only to an event with several pods. */
function tableSettings(t: Tournament, op: ConfigureOperation, pods: number, highest: number) {
  if (op.wizard && !wizardTablesOffered(t, pods)) {
    return { autoTables: false, overflowTableStart: 0 };
  }
  const proposed = highest + 10;
  const autoTables = automaticTables(t, op);
  return { autoTables, overflowTableStart: overflowStart(op, proposed, autoTables) };
}

/** The operation writes its round times directly, zero included, and pods the field again. */
function configuredInfo(t: Tournament, op: ConfigureOperation, ctx: LifecycleContext): Tournament {
  if (![op.roundMinutes, op.finalMinutes].every(minutes => Number.isInteger(minutes) && minutes >= 0)) {
    throw new Error('Round times are whole minutes');
  }
  const info = {
    ...t.info,
    roundTime: op.roundMinutes,
    finalsRoundTime: op.finalMinutes,
    eventType: op.eventType === 3 ? ('cup' as const) : ('challenge' as const)
  };
  const dated = parseTomDate(info.startDate);
  return podded({ ...t, info }, dated ? seasonOf(dated) : ctx.season);
}

export function configureEvent(t: Tournament, op: ConfigureOperation, ctx: LifecycleContext): Tournament {
  if (!t.settings || t.settings.stage >= 4) {
    throw new Error('Configure the event before starting');
  }
  if (![0, 1].includes(op.additionalRounds)) {
    throw new Error('Only zero or one additional Swiss round is available');
  }
  const result = { tournament: configuredInfo(t, op, ctx) };
  const combined: Pod = {
    category: 'mixed',
    playerIds: t.players.map(p => p.id),
    rounds: [],
    cut: 0,
    playoff3rd4th: op.thirdPlace,
    startingTable: 1
  };
  const allotted = startingTables(
    result.tournament,
    op.eventType === 1 && t.players.length ? [combined] : result.tournament.pods,
    Boolean(op.wizard)
  );
  if (op.wizard && !wizardTablesOffered(t, allotted.pods.length)) {
    allotted.pods = allotted.pods.map(pod => ({ ...pod, startingTable: 1 }));
  }
  const configured = { ...op, thirdPlace: configuredThirdPlace(t, op) };
  const cuts = requestedCuts(result.tournament, allotted.pods, configured);
  const pods = allotted.pods.map(pod => configuredPod(result.tournament, pod, configured, cuts));
  return {
    ...result.tournament,
    pods,
    settings: {
      ...t.settings,
      stage: t.players.length ? 3 : 1,
      type: op.eventType,
      lessSwiss: configuredLessSwiss(result.tournament, pods, op),
      ...tableSettings(t, op, pods.length, allotted.highest)
    }
  };
}

function configuredLessSwiss(t: Tournament, pods: Pod[], op: ConfigureOperation): boolean {
  if (!op.wizard) {
    return op.lessSwiss;
  }
  const planned = { ...t, settings: { ...t.settings!, type: op.eventType, lessSwiss: false } };
  return (
    op.lessSwiss &&
    op.eventType === 3 &&
    pods.every(p => (p.subgroupCount ?? 1) === 1) &&
    pods.some(p => regularRounds(planned, p) >= 4)
  );
}

/** The direct operation numbers automatically unless it sets manual tables or a blocked range itself. */
function automaticTables(t: Tournament, op: ConfigureOperation): boolean {
  const seated = op.wizard && t.players.some(p => p.fixedTable);
  return !op.manualTables && !op.blockedRanges.length && !seated;
}

/** TCG top-cut sizes offered to a division of this many registered players. */
function offeredCuts(players: number): number[] {
  return [0, ...(players >= 9 ? [4] : []), ...(players > 20 ? [8] : [])];
}

type DivisionCounts = Partial<Record<Division, number>>;

function divisionCountsOf(t: Tournament, pod: Pod): DivisionCounts {
  const of = divisionLookup(t);
  return Object.fromEntries(DIVISIONS.map(d => [d, pod.playerIds.filter(id => of(id) === d).length]));
}

/** A direct request saves the largest offered size up to it, but only when some division offers it. */
function directCut(op: ConfigureOperation, offered: number[], anyOffers: boolean): number {
  return anyOffers ? Math.max(...offered.filter(size => size <= op.cut)) : 0;
}

/**
 * Verify keeps a nonzero offered pick and gives every other division its largest offered size, raised to
 * twice the flight count when that is offered.
 */
function wizardCut(op: ConfigureOperation, offered: number[], division: Division, flights: number): number {
  if (op.eventType !== 3) {
    return 0;
  }
  const pick = op.divisionCuts?.[division] ?? op.cut;
  const size = pick > 0 && offered.includes(pick) ? pick : Math.max(...offered);
  return flights > 1 && offered.includes(2 * flights) ? 2 * flights : size;
}

const podFlights = (pod: Pod, op: ConfigureOperation) =>
  validFlightCount(pod.playerIds.length, op.flights) ? op.flights : 1;

/** Each represented division's saved cut size, keyed by pod category and division. */
function requestedCuts(t: Tournament, pods: Pod[], op: ConfigureOperation): Map<string, number> {
  const divisions = pods.flatMap(pod =>
    Object.entries(divisionCountsOf(t, pod))
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([division, count]) => ({
        key: `${pod.category}:${division}`,
        division: division as Division,
        count,
        flights: podFlights(pod, op)
      }))
  );
  const anyOffers = divisions.some(d => offeredCuts(d.count ?? 0).includes(op.cut) && op.cut > 0);
  return new Map(
    divisions.map(({ key, division, count, flights }) => {
      const offered = offeredCuts(count ?? 0);
      const direct = op.divisionCuts?.[division] ?? directCut(op, offered, anyOffers);
      return [key, op.wizard ? wizardCut(op, offered, division, flights) : direct];
    })
  );
}

function configuredPod(t: Tournament, pod: Pod, op: ConfigureOperation, sizes: Map<string, number>): Pod {
  const divisionCounts = divisionCountsOf(t, pod);
  const cuts = Object.fromEntries(
    DIVISIONS.filter(d => (divisionCounts[d] ?? 0) > 0).map(d => [
      d,
      { size: sizes.get(`${pod.category}:${d}`) ?? 0, playoff3rd4th: op.thirdPlace }
    ])
  );
  return {
    ...pod,
    cut: Math.max(0, ...Object.values(cuts).map(cut => cut.size)),
    stage: 0,
    divisionCounts,
    divisionCuts: cuts,
    playoff3rd4th: op.thirdPlace,
    subgroupCount: podFlights(pod, op),
    additionalRounds: op.additionalRounds,
    blockedRanges: op.blockedRanges.map(({ start, end }) => ({
      start: Math.min(start, end),
      end: Math.max(start, end)
    }))
  };
}

export function setFlights(t: Tournament, op: Extract<LifecycleOperation, { type: 'setFlights' }>): Tournament {
  const pods = t.pods.filter(p => op.pod === undefined || p.category === op.pod);
  if (!pods.length || pods.some(p => !validFlightCount(p.playerIds.length, op.count))) {
    throw new Error('Flights require a power of two up to sixteen and 32 players per flight');
  }
  if ((t.settings?.stage ?? 4) >= 4) {
    throw new Error('Set flights before starting');
  }
  return { ...t, pods: t.pods.map(p => (pods.includes(p) ? { ...p, subgroupCount: op.count } : p)) };
}

function orderedRoster(players: Player[], order: readonly string[] | undefined, ctx: LifecycleContext): Player[] {
  if (!order) {
    return shuffled(players, ctx.random);
  }
  const byId = new Map(players.map(p => [p.id, p]));
  if (order.length !== byId.size || new Set(order).size !== byId.size || order.some(id => !byId.has(id))) {
    throw new Error('Recorded roster shuffle must be a permutation of registered players');
  }
  return order.map(id => byId.get(id)!);
}

function startingFlights(pod: Pod, ctx: LifecycleContext): Pod {
  const flights =
    ctx.recorded?.flights?.[pod.category] ?? dealFlights(pod.playerIds, pod.subgroupCount ?? 1, ctx.random);
  const ids = flights.flatMap(f => f.playerIds);
  const sizes = flights.map(f => f.playerIds.length);
  if (
    flights.length !== (pod.subgroupCount ?? 1) ||
    ids.length !== pod.playerIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !pod.playerIds.includes(id)) ||
    Math.max(...sizes) - Math.min(...sizes) > 2
  ) {
    throw new Error('Recorded flights must balance the registered pod without changing membership');
  }
  return {
    ...pod,
    flights: flights.map(f => ({ ...f, playerIds: [...f.playerIds] })),
    playerIds: ids,
    startingPlayerIds: ids
  };
}

export function startEvent(t: Tournament, ctx: LifecycleContext): Tournament {
  if (!t.settings || t.settings.stage >= 4) {
    throw new Error('The tournament has already started');
  }
  if (!t.players.length) {
    return { ...t, pods: [], settings: { ...t.settings, stage: 1 } };
  }
  if (!t.pods.length) {
    throw new Error('Configure pods before starting the tournament');
  }
  const of = divisionLookup(t);
  const players = orderedRoster(t.players, ctx.recorded?.rosterOrder, ctx).map((p, index) => ({
    ...p,
    starter: true,
    tiebreaker: index + 1
  }));
  return schedulePlayers({
    ...t,
    players,
    pods: t.pods.map(p =>
      startingFlights(
        {
          ...p,
          stage: p.stage ?? 0,
          divisionCounts: Object.fromEntries(DIVISIONS.map(d => [d, p.playerIds.filter(id => of(id) === d).length]))
        },
        ctx
      )
    ),
    startedAt: ctx.now,
    settings: { ...t.settings, stage: 4 },
    info: { ...t.info, startDate: ctx.localTime.slice(0, 10) }
  });
}

/** V17-1: seats or existing blocked ranges close both wizard table controls. */
function wizardTablesOffered(t: Tournament, pods: number): boolean {
  return pods > 1 && !t.players.some(p => p.fixedTable) && !t.pods.some(p => p.blockedRanges?.length);
}

/** V17-2: a preset cut stays selected without opening the third-place control. */
function configuredThirdPlace(t: Tournament, op: ConfigureOperation): boolean {
  if (!op.wizard) {
    return op.thirdPlace;
  }
  const presetCut = ['TCG1DAY', 'TCG2DAY', 'TCGCHAMPIONSHIP', 'VGCCHAMPIONSHIP', 'VGCPREMIER', 'GOPREMIER'].includes(
    t.settings?.mode ?? ''
  );
  const cutShown = presetCut || t.settings?.type === 3;
  const cutRequested = op.eventType === 3;
  const choiceOpen = cutRequested === cutShown ? t.settings?.type === 1 : cutRequested;
  return op.thirdPlace && [1, 3].includes(op.eventType) && choiceOpen;
}
