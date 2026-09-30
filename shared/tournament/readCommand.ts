/**
 * A command out of a request body, checked field by field against the shape
 * `applyCommand` expects. Anything malformed is refused whole; the handlers
 * then only have to judge whether a well-formed command makes sense.
 */

import type { Command, EditableInfo, NewPlayer } from './commands.js';
import { isDivision, type Outcome, POD_CATEGORIES, type PodCategory } from './types.js';

type Obj = Record<string, unknown>;

const OUTCOMES: readonly Outcome[] = ['pending', 'p1', 'p2', 'tie', 'double-loss'];

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStr = (value: unknown, max = 100): value is string => typeof value === 'string' && value.length <= max;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isPod = (value: unknown): value is PodCategory => POD_CATEGORIES.includes(value as PodCategory);

function newPlayer(value: unknown): NewPlayer | null {
  if (!isObj(value) || !isStr(value.firstName) || !isStr(value.lastName)) {
    return null;
  }
  const optional = ['id', 'birthDate'].every(key => value[key] === undefined || isStr(value[key], 20));
  if (!optional) {
    return null;
  }
  // Only what staff may say of a player: nothing else in the body rides along.
  const { firstName, lastName, id, birthDate } = value as unknown as NewPlayer;
  return {
    firstName,
    lastName,
    ...(id === undefined ? {} : { id }),
    ...(birthDate === undefined ? {} : { birthDate })
  };
}

const INFO_TEXT: EditableInfo[] = ['name', 'city', 'state', 'country', 'startDate'];
const INFO_MINUTES: EditableInfo[] = ['roundTime', 'finalsRoundTime'];

function infoPatch(value: unknown): Obj | null {
  if (!isObj(value)) {
    return null;
  }
  const patch: Obj = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = INFO_TEXT.includes(key as EditableInfo) && isStr(entry);
    const minutes = INFO_MINUTES.includes(key as EditableInfo) && isInt(entry);
    if (!text && !minutes) {
      return null;
    }
    patch[key] = entry;
  }
  return patch;
}

/** Field checks per command type; each returns whether the body has that command's shape. */
const SHAPES: { [T in Command['type']]: (body: Obj) => boolean } = {
  addPlayer: body => newPlayer(body.player) !== null,
  editPlayer: body => isStr(body.id, 20) && isStr(body.firstName) && isStr(body.lastName) && isStr(body.birthDate, 20),
  removePlayer: body => isStr(body.id, 20),
  dropPlayer: body => isStr(body.id, 20),
  undropPlayer: body => isStr(body.id, 20),
  setFixedTable: body => isStr(body.id, 20) && (body.table === null || isInt(body.table)),
  pairRound: body => isPod(body.pod),
  repairRound: body => isPod(body.pod) && typeof body.keepReported === 'boolean',
  deleteRound: body => isPod(body.pod),
  startClock: body => isPod(body.pod),
  stopClock: body => isPod(body.pod),
  adjustClock: body => isPod(body.pod) && isInt(body.seconds),
  reportResult: body =>
    isPod(body.pod) &&
    isInt(body.round) &&
    isInt(body.table) &&
    isStr(body.p1, 20) &&
    (body.p2 === null || isStr(body.p2, 20)) &&
    OUTCOMES.includes(body.outcome as Outcome),
  swapPlayers: body => isPod(body.pod) && isStr(body.a, 20) && isStr(body.b, 20),
  startTopCut: body =>
    isPod(body.pod) && isInt(body.size) && (body.division === undefined || isDivision(body.division)),
  updateInfo: body => infoPatch(body.info) !== null
};

export function readCommand(body: unknown): Command | null {
  if (!isObj(body) || typeof body.type !== 'string' || !Object.hasOwn(SHAPES, body.type)) {
    return null;
  }
  return SHAPES[body.type as Command['type']](body) ? (body as unknown as Command) : null;
}
