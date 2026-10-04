/**
 * Checking a tournament document that came over the wire. A TOM-run event is
 * parsed from its .tdf in the organizer's browser and sent up whole, so the
 * function storing it cannot assume anything about its shape. This rebuilds
 * the document field by field, keeping only what the types name and refusing
 * the lot if any required part is missing or out of bounds.
 */

import { normalizeCutPods } from './rounds.js';
import {
  EVENT_TYPES,
  type Match,
  type Outcome,
  type Player,
  type Pod,
  POD_CATEGORIES,
  type PodCategory,
  type Round,
  type RoundKind,
  type RoundStatus,
  type TdfPassthrough,
  type Tournament,
  type TournamentInfo
} from './types.js';

export const LIMITS = {
  players: 5000,
  rounds: 40,
  matchesPerRound: 2600,
  text: 200,
  passthrough: 20_000,
  standings: 1_000_000
} as const;

const OUTCOMES: readonly Outcome[] = [
  'pending',
  'p1',
  'p2',
  'tie',
  'double-loss',
  'bye',
  'assigned-bye',
  'deleted',
  'loss'
];
const KINDS: readonly RoundKind[] = ['swiss', 'elimination'];
const STATUSES: readonly RoundStatus[] = ['paired', 'started', 'finished'];

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Invalid('object');
  }
  return value as Obj;
}

function arr(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Invalid('array');
  }
  return value;
}

function str(value: unknown, max: number = LIMITS.text): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Invalid('string');
  }
  return value;
}

function int(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Invalid('number');
  }
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) {
    throw new Invalid('enum');
  }
  return value as T;
}

function pairs(value: unknown): [string, string][] {
  return arr(value, 200).map(entry => {
    const [key, text] = arr(entry, 2);
    return [str(key), str(text, LIMITS.passthrough)];
  });
}

function info(value: unknown): TournamentInfo {
  const o = obj(value);
  return {
    name: str(o.name),
    sanctionId: str(o.sanctionId),
    city: str(o.city),
    state: str(o.state),
    country: str(o.country),
    roundTime: int(o.roundTime, 0, 600),
    finalsRoundTime: int(o.finalsRoundTime, 0, 600),
    organizerPopId: str(o.organizerPopId),
    organizerName: str(o.organizerName),
    startDate: str(o.startDate),
    ...(o.eventType === undefined ? {} : { eventType: oneOf(o.eventType, EVENT_TYPES) })
  };
}

function lateData(value: unknown): NonNullable<Player['lateData']> {
  const o = obj(value);
  return {
    round: int(o.round, -1, LIMITS.rounds),
    timestamp: str(o.timestamp, 40),
    forcedLoss: o.forcedLoss === true,
    usedForcedLoss: o.usedForcedLoss === true
  };
}

function playerNumbers(o: Obj): Pick<Player, 'order' | 'seed' | 'byes'> {
  return Object.fromEntries(
    ['order', 'seed', 'byes'].filter(key => o[key] !== undefined).map(key => [key, int(o[key], 0, LIMITS.players)])
  );
}

function player(value: unknown): Player {
  const o = obj(value);
  return {
    id: str(o.id, 20),
    firstName: str(o.firstName),
    lastName: str(o.lastName),
    birthDate: str(o.birthDate, 20),
    droppedAfter: o.droppedAfter === null ? null : int(o.droppedAfter, 0, LIMITS.rounds),
    // A disqualification is a drop: without one it would leave a player paired but out of the standings.
    ...(o.disqualified === true && o.droppedAfter !== null ? { disqualified: true as const } : {}),
    ...(o.late === true ? { late: true } : {}),
    ...(o.starter === undefined ? {} : { starter: o.starter === true }),
    ...(o.lateData === undefined ? {} : { lateData: lateData(o.lateData) }),
    ...playerNumbers(o),
    ...(o.fixedTable === undefined ? {} : { fixedTable: int(o.fixedTable, 1, 9999) }),
    ...(o.fromList === true ? { fromList: true } : {}),
    created: str(o.created, 40),
    modified: str(o.modified, 40)
  };
}

function match(value: unknown): Match {
  const o = obj(value);
  return {
    table: int(o.table, 0, 100_000),
    p1: str(o.p1, 20),
    p2: o.p2 === null ? null : str(o.p2, 20),
    outcome: oneOf(o.outcome, OUTCOMES),
    timestamp: str(o.timestamp, 40)
  };
}

function round(value: unknown): Round {
  const o = obj(value);
  return {
    number: int(o.number, 1, LIMITS.rounds),
    kind: oneOf(o.kind, KINDS),
    status: oneOf(o.status, STATUSES),
    timeLeft: int(o.timeLeft, -86_400, 86_400),
    pairTime: str(o.pairTime, 40),
    startTime: str(o.startTime, 40),
    ...(o.startedAt === undefined ? {} : { startedAt: int(o.startedAt, 0, Number.MAX_SAFE_INTEGER) }),
    clockStartedAt: o.clockStartedAt == null ? null : int(o.clockStartedAt, 0, Number.MAX_SAFE_INTEGER),
    matches: arr(o.matches, LIMITS.matchesPerRound).map(match)
  };
}

function divisionCuts(value: unknown): NonNullable<Pod['divisionCuts']> {
  return Object.fromEntries(
    Object.entries(obj(value)).map(([key, value]) => {
      const o = obj(value);
      return [
        oneOf(key, ['junior', 'senior', 'masters']),
        {
          size: int(o.size, 0, 512),
          playoff3rd4th: o.playoff3rd4th === true,
          ...(o.playerIds === undefined ? {} : { playerIds: arr(o.playerIds, LIMITS.players).map(id => str(id, 20)) })
        }
      ];
    })
  );
}

function pod(value: unknown): Pod {
  const o = obj(value);
  return {
    category: oneOf(o.category, POD_CATEGORIES),
    playerIds: arr(o.playerIds, LIMITS.players).map(id => str(id, 20)),
    rounds: arr(o.rounds, LIMITS.rounds).map(round),
    cut: int(o.cut, 0, 512),
    playoff3rd4th: o.playoff3rd4th === true,
    startingTable: int(o.startingTable, 0, 100_000),
    ...(o.cutOf === undefined ? {} : { cutOf: oneOf(o.cutOf, POD_CATEGORIES) }),
    ...(o.divisionCounts === undefined
      ? {}
      : {
          divisionCounts: Object.fromEntries(
            Object.entries(obj(o.divisionCounts)).map(([d, count]) => [
              oneOf(d, ['junior', 'senior', 'masters']),
              int(count, 0, LIMITS.players)
            ])
          )
        }),
    ...(o.startingPlayerIds === undefined
      ? {}
      : { startingPlayerIds: arr(o.startingPlayerIds, LIMITS.players).map(id => str(id, 20)) }),
    ...(o.divisionCuts === undefined ? {} : { divisionCuts: divisionCuts(o.divisionCuts) })
  };
}

function podExtras(value: unknown): TdfPassthrough['podExtras'] {
  const out: TdfPassthrough['podExtras'] = {};
  for (const [key, entry] of Object.entries(obj(value))) {
    const o = obj(entry);
    out[oneOf(key, POD_CATEGORIES) as PodCategory] = { stage: str(o.stage), extra: pairs(o.extra) };
  }
  return out;
}

function record<T>(value: unknown, read: (entry: unknown) => T): Record<string, T> {
  const entries = Object.entries(obj(value));
  if (entries.length > LIMITS.players + LIMITS.rounds * 3) {
    throw new Invalid('record');
  }
  return Object.fromEntries(entries.map(([key, entry]) => [str(key, 40), read(entry)]));
}

function savedStandings(value: unknown): { xml: string; state: string } {
  const o = obj(value);
  return { xml: str(o.xml, LIMITS.standings), state: str(o.state, LIMITS.standings) };
}

function passthrough(value: unknown): TdfPassthrough {
  const o = obj(value);
  return {
    rootAttrs: pairs(o.rootAttrs),
    extraData: pairs(o.extraData),
    timeElapsed: str(o.timeElapsed),
    playerExtras: record(o.playerExtras, pairs),
    podExtras: podExtras(o.podExtras),
    roundCodes: record(o.roundCodes, entry => {
      const codes = obj(entry);
      return {
        type: str(codes.type, 10),
        stage: str(codes.stage, 10),
        ...(codes.timeLeft === undefined ? {} : { timeLeft: int(codes.timeLeft, 0, 24 * 60 * 60) }),
        ...(codes.startTime === undefined ? {} : { startTime: str(codes.startTime, 100) })
      };
    }),
    finalsOptions: str(o.finalsOptions, LIMITS.passthrough),
    ...(o.standings === undefined ? {} : { standings: savedStandings(o.standings) }),
    ...(o.original === undefined ? {} : { original: savedStandings(o.original) }),
    ...(o.finalsState === undefined ? {} : { finalsState: str(o.finalsState, LIMITS.standings) })
  };
}

/** Every match names players in its pod, and no player appears twice. */
function consistent(tournament: Tournament): boolean {
  const ids = new Set(tournament.players.map(p => p.id));
  if (ids.size !== tournament.players.length) {
    return false;
  }
  return tournament.pods.every(p =>
    p.rounds.every(r => r.matches.every(m => ids.has(m.p1) && (m.p2 === null || ids.has(m.p2))))
  );
}

/** A clean copy of the tournament in `body`, or null if it is not one. */
export function readTournament(body: unknown): Tournament | null {
  try {
    const o = obj(body);
    const tournament: Tournament = {
      info: info(o.info),
      players: arr(o.players, LIMITS.players).map(player),
      pods: arr(o.pods, POD_CATEGORIES.length).map(pod),
      ...(o.startedAt === undefined ? {} : { startedAt: int(o.startedAt, 0, Number.MAX_SAFE_INTEGER) }),
      ...(o.passthrough === undefined ? {} : { passthrough: passthrough(o.passthrough) })
    };
    return consistent(tournament) ? normalizeCutPods(tournament) : null;
  } catch (error) {
    if (error instanceof Invalid) {
      return null;
    }
    throw error;
  }
}
