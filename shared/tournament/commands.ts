/** Organizer commands share the lifecycle used by TOM conformance replay. */
import {
  applyCommand as applyLegacyCommand,
  type Command,
  type CommandContext,
  type CommandResult,
  generatedId,
  canUndrop as legacyCanUndrop,
  podded
} from './legacyCommands.js';
import { lifecycleDocument } from './lifecycleImport.js';
import { applyLifecycleOperation } from './lifecycle.js';
import type { LifecycleOperation } from './lifecycleTypes.js';
import { divisionLookup } from './divisions.js';
import { eventTypeOf, SANCTIONED } from './structure.js';
import { latestRound } from './rounds.js';
import { DIVISIONS, type Player, type Tournament } from './types.js';

export {
  type Command,
  type CommandContext,
  type CommandResult,
  type EditableInfo,
  type NewPlayer,
  secondsLeft,
  TOP_CUT_SIZES
} from './legacyCommands.js';

export function canUndrop(t: Tournament, player: Pick<Player, 'id' | 'droppedAfter'>): boolean {
  if (!t.settings || player.droppedAfter === null) {
    return legacyCanUndrop(t, player);
  }
  const round = latestRound(t.pods.find(p => p.playerIds.includes(player.id)));
  const missed = (round?.number ?? 0) - player.droppedAfter;
  return missed - ((round?.stage ?? 4) < 4 ? 1 : 0) <= 1;
}

function translated(t: Tournament, command: Command, ctx: CommandContext): LifecycleOperation | undefined {
  const translations: Partial<Record<Command['type'], () => LifecycleOperation>> = {
    pairRound: () =>
      t.settings!.stage < 4
        ? { type: 'start' }
        : { type: 'pair', pod: (command as Extract<Command, { type: 'pairRound' }>).pod },
    repairRound: () => ({
      type: 'pair',
      pod: (command as Extract<Command, { type: 'repairRound' }>).pod,
      repair: true
    }),
    startClock: () => ({ type: 'startRound', pod: (command as Extract<Command, { type: 'startClock' }>).pod }),
    dropPlayer: () => ({
      type: 'drop',
      id: (command as Extract<Command, { type: 'dropPlayer' }>).id,
      disqualified: false,
      timestamp: ctx.localTime
    }),
    disqualifyPlayer: () => ({
      type: 'drop',
      id: (command as Extract<Command, { type: 'disqualifyPlayer' }>).id,
      disqualified: true,
      timestamp: ctx.localTime
    }),
    undropPlayer: () => ({ type: 'reenter', id: (command as Extract<Command, { type: 'undropPlayer' }>).id }),
    addPlayer: () => {
      const { player } = command as Extract<Command, { type: 'addPlayer' }>;
      return t.settings!.stage >= 4
        ? {
            type: 'late',
            player: { ...player, id: player.id?.trim() || generatedId(t, ctx.random) },
            markLate: true,
            forcedLoss: false,
            timestamp: ctx.localTime
          }
        : { type: 'register', players: [player] };
    },
    startTopCut: () => ({ type: 'topCut', pod: (command as Extract<Command, { type: 'startTopCut' }>).pod }),
    reportResult: () => reported(t, command as Extract<Command, { type: 'reportResult' }>, ctx)
  };
  return translations[command.type]?.();
}

function reported(
  t: Tournament,
  command: Extract<Command, { type: 'reportResult' }>,
  ctx: CommandContext
): LifecycleOperation {
  const round = latestRound(t.pods.find(p => p.category === command.pod)!);
  const match = round?.matches.find(m => m.p1 === command.p1 && m.p2 === command.p2 && m.table === command.table);
  if (!round || round.number !== command.round || !match) {
    throw new Error('The reported match has changed');
  }
  if (command.outcome === 'pending') {
    return { type: 'reopen', pod: command.pod, round: command.round, player: command.p1 };
  }
  return {
    type: 'results',
    pod: command.pod,
    results: [{ ...match, outcome: command.outcome, timestamp: ctx.localTime }]
  };
}

function checkedCutDivisions(
  t: Tournament,
  pod: Tournament['pods'][number],
  command: Extract<Command, { type: 'startTopCut' }>
): void {
  const of = divisionLookup(t);
  const present = DIVISIONS.filter(d => pod.playerIds.some(id => of(id) === d));
  if (!command.division && present.length > 1) {
    throw new Error('Pick the division to cut');
  }
  if (command.division && pod.divisionCuts?.[command.division]?.playerIds) {
    throw new Error('The top cut has started');
  }
  if (!command.division && pod.stage === 1) {
    throw new Error('The top cut has started');
  }
}

function preparedCut(
  t: Tournament,
  command: Extract<Command, { type: 'startTopCut' }>,
  ctx: CommandContext
): Tournament {
  if (eventTypeOf(t) === 'challenge') {
    throw new Error('A League Challenge has no top cut');
  }
  const pod = t.pods.find(p => p.category === command.pod);
  if (!pod) {
    throw new Error('There is no pod to cut');
  }
  if (command.size < 4 && command.playoff3rd4th) {
    throw new Error('A top cut of two cannot play for third');
  }
  if (ctx.sanctioned && pod.rounds.filter(r => r.kind === 'swiss').length < SANCTIONED.swissRounds) {
    throw new Error(`A sanctioned event plays at least ${SANCTIONED.swissRounds} Swiss rounds before its top cut`);
  }
  checkedCutDivisions(t, pod, command);
  const of = divisionLookup(t);
  const divisions = command.division
    ? [command.division]
    : DIVISIONS.filter(d => pod.playerIds.some(id => of(id) === d));
  const divisionCuts = {
    ...pod.divisionCuts,
    ...Object.fromEntries(
      divisions.map(d => [d, { size: command.size, playoff3rd4th: command.playoff3rd4th ?? false }])
    )
  };
  const changed = { ...pod, cut: command.size, divisionCuts, playoff3rd4th: command.playoff3rd4th ?? false };
  return { ...t, pods: t.pods.map(p => (p === pod ? changed : p)) };
}

function checkedStart(t: Tournament, command: Command, ctx: CommandContext): void {
  if (
    command.type === 'pairRound' &&
    ctx.sanctioned &&
    t.settings!.stage < 4 &&
    t.players.filter(p => p.droppedAfter === null).length < SANCTIONED.players
  ) {
    throw new Error(`A sanctioned event needs at least ${SANCTIONED.players} players`);
  }
}

function additionalDivisionCut(t: Tournament, command: Command): boolean {
  if (command.type !== 'startTopCut' || !command.division) {
    return false;
  }
  const pod = t.pods.find(p => p.category === command.pod);
  return pod?.stage === 1 && !pod.divisionCuts?.[command.division]?.playerIds;
}

function legacyChange(t: Tournament, command: Command, ctx: CommandContext): CommandResult {
  const result = applyLegacyCommand(t, command, ctx);
  if (!result.ok || !result.tournament.settings) {
    return result;
  }
  const next = result.tournament;
  const settings = { ...next.settings! };
  if (command.type === 'setFixedTable' && command.table !== null) {
    settings.autoTables = false;
  }
  if (command.type === 'updateInfo' && command.info.eventType) {
    settings.type = command.info.eventType === 'cup' ? 3 : 2;
    if (settings.mode !== 'CUSTOM' && settings.mode !== 'PRERELEASE') {
      settings.mode = settings.type === 3 ? 'TCG1DAY' : 'LEAGUECHALLENGE';
    }
  }
  const pods = registrationPods(t, { ...next, settings }).map(pod => {
    const old = t.pods.find(p => p.category === pod.category);
    const stage = old?.stage === 1 && !pod.rounds.some(r => r.kind === 'elimination') ? (0 as const) : pod.stage;
    return {
      ...pod,
      stage,
      rounds: pod.rounds.map(round =>
        reconciledRound(
          round,
          old?.rounds.find(r => r.number === round.number)
        )
      )
    };
  });
  return { ok: true, tournament: { ...next, settings, pods } };
}

function registrationPods(t: Tournament, next: Tournament): Tournament['pods'] {
  if (t.settings!.stage >= 4 || next.settings!.type !== 1) {
    return next.pods;
  }
  const pod = t.pods.find(p => p.category === 'mixed') ?? next.pods[0];
  return pod ? [{ ...pod, category: 'mixed', playerIds: next.players.map(p => p.id) }] : [];
}

function reconciledRound(
  round: Tournament['pods'][number]['rounds'][number],
  prior: Tournament['pods'][number]['rounds'][number] | undefined
): typeof round {
  if (round.status === 'started' && prior?.status !== 'started') {
    return { ...round, stage: 4 };
  }
  return round;
}

function resumesClock(t: Tournament, command: Command): boolean {
  if (command.type !== 'startClock') {
    return false;
  }
  const round = latestRound(t.pods.find(p => p.category === command.pod));
  return round?.stage === 4 && round.clockStartedAt === null;
}

/** The site reports a round a retried pairing saved as paired, where TOM reports none (PAIRING V18-2). */
function commandResult(result: ReturnType<typeof applyLifecycleOperation>, prior: Tournament): CommandResult {
  return result.ok || result.retried
    ? { ok: true, tournament: result.tournament }
    : { ok: false, error: result.error!, ...(result.tournament === prior ? {} : { tournament: result.tournament }) };
}

function prepareRegistration(t: Tournament, command: Command, ctx: CommandContext): Tournament {
  if (command.type !== 'pairRound' || !t.settings || t.settings.stage >= 4) {
    return t;
  }
  const prepared = t.pods.length ? t : podded(t, ctx.season);
  if (t.settings.type !== 1 || !prepared.pods.length) {
    return prepared;
  }
  return {
    ...prepared,
    pods: [{ ...prepared.pods[0]!, category: 'mixed', playerIds: t.players.map(p => p.id), cut: 0 }]
  };
}

function registersBeforeStart(t: Tournament, command: Command): boolean {
  return command.type === 'addPlayer' && t.settings!.stage < 4;
}

export function applyCommand(t: Tournament, command: Command, ctx: CommandContext): CommandResult {
  const imported = t.settings || t.passthrough || command.type === 'pairRound' ? lifecycleDocument(t) : t;
  const document = prepareRegistration(imported, command, ctx);
  if (!document.settings) {
    return applyLegacyCommand(t, command, ctx);
  }
  try {
    checkedStart(document, command, ctx);
    if (registersBeforeStart(document, command)) {
      return legacyChange(document, command, ctx);
    }
    if (additionalDivisionCut(document, command)) {
      return legacyChange(document, command, ctx);
    }
    if (resumesClock(document, command)) {
      return legacyChange(document, command, ctx);
    }
    const prepared = command.type === 'startTopCut' ? preparedCut(document, command, ctx) : document;
    const operation = translated(prepared, command, ctx);
    if (!operation) {
      return legacyChange(document, command, ctx);
    }
    const result = applyLifecycleOperation(prepared, operation, ctx);
    return commandResult(result, prepared);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The command could not complete' };
  }
}
