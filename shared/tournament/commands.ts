/**
 * Everything an organizer can do to a Swiss event, as commands on the
 * tournament document. Each command is checked and applied here, in shared
 * code, so the function that stores the result and the page that previews it
 * agree on what it does.
 *
 * A command never edits in place: it returns a new document or a reason it
 * cannot run. The two things Slowpoke could not do are first-class here: a
 * player can be added at any point, and a round that is already paired can be
 * re-paired around the results already reported, so a late arrival is in the
 * round rather than waiting for the next one.
 */

import { divisionFor, divisionLookup } from './divisions.js';
import { type Pairing, pairNextElimination, pairSwiss, pairTopCut } from './pairing.js';
import type { Random } from './random.js';
import {
  activeIds,
  findMatch,
  fixedTables,
  hasPlayed,
  isReported,
  latestRound,
  type MatchStamp,
  pairingHistory,
  podOf,
  pointsBefore,
  roundComplete,
  seatPairings,
  sortMatches,
  toMatches
} from './rounds.js';
import { eliminationResult, swissStandings } from './standings.js';
import {
  type Division,
  isDivision,
  type Match,
  type Outcome,
  type Player,
  type Pod,
  type PodCategory,
  REPORTABLE_OUTCOMES,
  type Round,
  type Tournament,
  type TournamentInfo
} from './types.js';

export interface NewPlayer {
  firstName: string;
  lastName: string;
  /** POP ID; one is generated when blank. */
  id?: string;
  birthDate?: string;
  /** Overrides the division the birth date gives. */
  division?: Division;
  /** Set when the player's own decklist submission adds them (see functions/api/tournaments/[code]/decklists.ts). */
  fromList?: boolean;
}

export type Command =
  | { type: 'addPlayer'; player: NewPlayer }
  | { type: 'editPlayer'; id: string; firstName: string; lastName: string; birthDate: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'dropPlayer'; id: string }
  | { type: 'undropPlayer'; id: string }
  | { type: 'setFixedTable'; id: string; table: number | null }
  | { type: 'pairRound'; pod: PodCategory }
  | { type: 'repairRound'; pod: PodCategory; keepReported: boolean }
  | { type: 'deleteRound'; pod: PodCategory }
  | { type: 'startClock'; pod: PodCategory }
  | { type: 'stopClock'; pod: PodCategory }
  | { type: 'adjustClock'; pod: PodCategory; seconds: number }
  | {
      type: 'reportResult';
      pod: PodCategory;
      round: number;
      table: number;
      /** Both players name the match, so a report cannot land on a pairing made since it was sent. */
      p1: string;
      p2: string | null;
      outcome: Outcome;
    }
  | { type: 'swapPlayers'; pod: PodCategory; a: string; b: string }
  | { type: 'startTopCut'; pod: PodCategory; size: number; division?: Division }
  | { type: 'updateInfo'; info: Partial<Pick<TournamentInfo, EditableInfo>> };

export type EditableInfo = 'name' | 'city' | 'state' | 'country' | 'roundTime' | 'finalsRoundTime' | 'startDate';

export interface CommandContext {
  /** Epoch ms. */
  now: number;
  /** The same moment as TOM writes times: MM/DD/YYYY HH:mm:ss at the venue. */
  localTime: string;
  season: number;
  random: Random;
}

export type CommandResult = { ok: true; tournament: Tournament } | { ok: false; error: string };

const fail = (error: string): CommandResult => ({ ok: false, error });
const done = (tournament: Tournament): CommandResult => ({ ok: true, tournament });

export const TOP_CUT_SIZES = [2, 4, 8, 16, 32] as const;

function findPod(tournament: Tournament, category: PodCategory): Pod | undefined {
  return tournament.pods.find(pod => pod.category === category);
}

function withPod(tournament: Tournament, pod: Pod): Tournament {
  return { ...tournament, pods: tournament.pods.map(p => (p.category === pod.category ? pod : p)) };
}

function withRound(pod: Pod, round: Round): Pod {
  return { ...pod, rounds: pod.rounds.map(r => (r.number === round.number ? round : r)) };
}

function newPod(category: PodCategory): Pod {
  return { category, playerIds: [], rounds: [], cut: 0, playoff3rd4th: false, startingTable: 1 };
}

/** A local ID for a player without a POP ID; TOM wants digits, so it is digits. */
function generatedId(tournament: Tournament, random: Random): string {
  const taken = new Set(tournament.players.map(p => p.id));
  let id = '';
  do {
    id = String(9_000_000_000 + Math.floor(random() * 999_999_999));
  } while (taken.has(id));
  return id;
}

/**
 * The rounds a late entrant missed are losses with no opponent: every round
 * already paired in their pod. Re-pairing the current round afterwards swaps
 * that round's loss for a real match.
 */
function missedRounds(pod: Pod, id: string, timestamp: string): Pod {
  const rounds = pod.rounds.map(round =>
    round.kind === 'swiss'
      ? { ...round, matches: [...round.matches, { table: 0, p1: id, p2: null, outcome: 'loss' as const, timestamp }] }
      : round
  );
  return { ...pod, playerIds: [...pod.playerIds, id], rounds };
}

function podFor(tournament: Tournament, division: Division): Pod {
  const category: PodCategory = tournament.combined ? 'mixed' : division;
  return findPod(tournament, category) ?? newPod(category);
}

/** A player as they join: late once their pod has paired a round, and marked when their decklist added them. */
function newPlayer(
  fields: Pick<Player, 'id' | 'firstName' | 'lastName' | 'birthDate'> & { fromList?: boolean | undefined },
  pod: Pod,
  ctx: CommandContext
): Player {
  const { fromList, ...rest } = fields;
  return {
    ...rest,
    droppedAfter: null,
    ...(pod.rounds.length > 0 ? { late: true } : {}),
    ...(fromList ? { fromList: true } : {}),
    created: ctx.localTime,
    modified: ctx.localTime
  };
}

function addPlayer(tournament: Tournament, input: NewPlayer, ctx: CommandContext): CommandResult {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    return fail('A player needs a first and last name');
  }
  const id = input.id?.trim() || generatedId(tournament, ctx.random);
  if (!/^\d{1,10}$/.test(id)) {
    return fail('A POP ID is up to ten digits');
  }
  if (tournament.players.some(p => p.id === id)) {
    return fail('That POP ID is already registered');
  }
  const birthDate = input.birthDate?.trim() ?? '';
  const pod = podFor(tournament, input.division ?? divisionFor(birthDate, ctx.season));
  const player = newPlayer({ id, firstName, lastName, birthDate, fromList: input.fromList }, pod, ctx);
  const joined = missedRounds(pod, id, ctx.localTime);
  const pods = tournament.pods.some(p => p.category === pod.category)
    ? tournament.pods.map(p => (p.category === pod.category ? joined : p))
    : [...tournament.pods, joined];
  return done({ ...tournament, players: [...tournament.players, player], pods });
}

function updatePlayer(tournament: Tournament, id: string, change: (player: Player) => Player): CommandResult {
  const player = tournament.players.find(p => p.id === id);
  if (!player) {
    return fail('No such player');
  }
  return done({ ...tournament, players: tournament.players.map(p => (p.id === id ? change(p) : p)) });
}

function removePlayer(tournament: Tournament, id: string): CommandResult {
  const pod = podOf(tournament, id);
  if (hasPlayed(pod, id)) {
    return fail('This player has been paired; drop them instead');
  }
  const pods = tournament.pods.map(p =>
    p === pod
      ? {
          ...p,
          playerIds: p.playerIds.filter(pid => pid !== id),
          rounds: p.rounds.map(r => ({ ...r, matches: r.matches.filter(m => m.p1 !== id) }))
        }
      : p
  );
  return done({ ...tournament, players: tournament.players.filter(p => p.id !== id), pods });
}

function dropPlayer(tournament: Tournament, id: string, ctx: CommandContext): CommandResult {
  const pod = podOf(tournament, id);
  const round = pod ? latestRound(pod) : undefined;
  return updatePlayer(tournament, id, player => ({
    ...player,
    droppedAfter: round?.number ?? 0,
    modified: ctx.localTime
  }));
}

/**
 * A drop can be taken back until the next round is paired. After that the
 * player has missed a pairing, and letting them back in would hand them a
 * loss they never played or a round they were never in.
 */
export function canUndrop(tournament: Tournament, player: Pick<Player, 'id' | 'droppedAfter'>): boolean {
  return player.droppedAfter === (latestRound(podOf(tournament, player.id))?.number ?? 0);
}

function undropPlayer(tournament: Tournament, id: string, ctx: CommandContext): CommandResult {
  const player = tournament.players.find(p => p.id === id);
  if (player?.droppedAfter != null && !canUndrop(tournament, player)) {
    return fail(`They dropped before round ${player.droppedAfter + 1} was paired, so they can’t come back now`);
  }
  return updatePlayer(tournament, id, p => ({ ...p, droppedAfter: null, modified: ctx.localTime }));
}

const MAX_TABLE = 9999;

function setFixedTable(tournament: Tournament, id: string, table: number | null): CommandResult {
  if (table !== null && (!Number.isInteger(table) || table < 1 || table > MAX_TABLE)) {
    return fail('A table is a whole number from 1');
  }
  const holder = table === null ? undefined : tournament.players.find(p => p.fixedTable === table && p.id !== id);
  if (holder) {
    return fail(`Table ${table} is already fixed for ${holder.firstName} ${holder.lastName}`);
  }
  return updatePlayer(tournament, id, ({ fixedTable: _old, ...player }) =>
    table === null ? player : { ...player, fixedTable: table }
  );
}

/** How a round's pairings get their tables: from the pod's first, around the players whose table is fixed. */
function stampFor(tournament: Tournament, pod: Pod, ctx: CommandContext): MatchStamp {
  return { firstTable: pod.startingTable, timestamp: ctx.localTime, fixed: fixedTables(tournament) };
}

/**
 * A round as it is paired: on the clock its kind plays to, not started. A
 * Swiss round's tables run best first; a top cut's keep bracket order (see
 * seatPairings).
 */
function pairedRound(
  tournament: Tournament,
  pod: Pod,
  ctx: CommandContext,
  round: { number: number; kind: Round['kind']; pairings: readonly Pairing[] }
): Round {
  const swiss = round.kind === 'swiss';
  return {
    number: round.number,
    kind: round.kind,
    status: 'paired',
    timeLeft: (swiss ? tournament.info.roundTime : tournament.info.finalsRoundTime) * 60,
    pairTime: ctx.localTime,
    startTime: '',
    clockStartedAt: null,
    matches: (swiss ? toMatches : seatPairings)(round.pairings, stampFor(tournament, pod, ctx))
  };
}

function nextSwissRound(tournament: Tournament, pod: Pod, ctx: CommandContext): Round {
  const number = pod.rounds.length + 1;
  const points = pointsBefore(pod, number);
  const entrants = activeIds(tournament, pod).map(id => ({ id, points: points.get(id) ?? 0 }));
  const pairings = pairSwiss(entrants, pairingHistory(pod), ctx.random);
  return pairedRound(tournament, pod, ctx, { number, kind: 'swiss', pairings });
}

/** Winners of the latest elimination round, in bracket order; null while any match is open. */
function eliminationWinners(round: Round): string[] | null {
  const winners: string[] = [];
  for (const match of round.matches) {
    const result = eliminationResult(match);
    if (!result) {
      return null;
    }
    winners.push(result.winner);
  }
  return winners;
}

function nextEliminationRound(tournament: Tournament, pod: Pod, latest: Round, ctx: CommandContext): CommandResult {
  const winners = eliminationWinners(latest);
  if (!winners) {
    return fail('Report every match before pairing the next round');
  }
  if (winners.length < 2) {
    return fail('The top cut is finished');
  }
  const pairings = pairNextElimination(winners);
  const round = pairedRound(tournament, pod, ctx, { number: latest.number + 1, kind: 'elimination', pairings });
  return done(withPod(tournament, { ...pod, rounds: [...pod.rounds, round] }));
}

function pairRound(tournament: Tournament, category: PodCategory, ctx: CommandContext): CommandResult {
  const pod = findPod(tournament, category);
  if (!pod || activeIds(tournament, pod).length < 2) {
    return fail('Add at least two players first');
  }
  const latest = latestRound(pod);
  if (latest && !roundComplete(latest)) {
    return fail('Report every match before pairing the next round');
  }
  if (latest?.kind === 'elimination') {
    return nextEliminationRound(tournament, pod, latest, ctx);
  }
  const closed = latest ? withRound(pod, { ...latest, status: 'finished', clockStartedAt: null }) : pod;
  const round = nextSwissRound(tournament, closed, ctx);
  return done(withPod(tournament, { ...closed, rounds: [...closed.rounds, round] }));
}

/** Matches a re-pair leaves alone: decided between two players. Byes and missed-round losses are re-drawn. */
function keptMatches(round: Round, keepReported: boolean): Match[] {
  return keepReported ? round.matches.filter(match => match.p2 !== null && isReported(match)) : [];
}

function repairRound(tournament: Tournament, category: PodCategory, keepReported: boolean, ctx: CommandContext) {
  const pod = findPod(tournament, category);
  const round = pod && latestRound(pod);
  if (!pod || !round) {
    return fail('There is no round to re-pair');
  }
  if (round.kind !== 'swiss') {
    return fail('Only a Swiss round can be re-paired');
  }
  const kept = keptMatches(round, keepReported);
  const seated = new Set(kept.flatMap(match => [match.p1, match.p2]));
  const points = pointsBefore(pod, round.number);
  const entrants = activeIds(tournament, pod)
    .filter(id => !seated.has(id))
    .map(id => ({ id, points: points.get(id) ?? 0 }));
  const pairings = pairSwiss(entrants, pairingHistory(pod, round.number), ctx.random);
  const fresh = toMatches(pairings, {
    ...stampFor(tournament, pod, ctx),
    taken: new Set(kept.map(match => match.table))
  });
  // Dropped players keep the missed-round entries they already had in this round.
  const stale = round.matches.filter(m => m.p2 === null && m.outcome === 'loss' && !entrants.some(e => e.id === m.p1));
  const matches = sortMatches([...kept, ...fresh, ...stale]);
  return done(
    withPod(
      tournament,
      withRound(pod, { ...round, status: round.startTime ? 'started' : 'paired', pairTime: ctx.localTime, matches })
    )
  );
}

function deleteRound(tournament: Tournament, category: PodCategory): CommandResult {
  const pod = findPod(tournament, category);
  const round = pod && latestRound(pod);
  if (!pod || !round) {
    return fail('There is no round to delete');
  }
  if (round.matches.some(match => match.p2 !== null && isReported(match))) {
    return fail('Clear this round’s results before deleting it');
  }
  const rounds = pod.rounds.slice(0, -1);
  const next = withPod(tournament, { ...pod, rounds, cut: rounds.some(r => r.kind === 'elimination') ? pod.cut : 0 });
  return done(rounds.length > 0 ? next : onTime(next, pod));
}

/** With no round left in the pod, nobody in it joined after one was paired. */
function onTime(tournament: Tournament, pod: Pod): Tournament {
  const inPod = new Set(pod.playerIds);
  const players = tournament.players.map(player => {
    if (!player.late || !inPod.has(player.id)) {
      return player;
    }
    const { late: _late, ...onTimeNow } = player;
    return onTimeNow;
  });
  return { ...tournament, players };
}

function outcomeError(round: Round, match: Match, outcome: Outcome): string | null {
  if (match.p2 === null) {
    return 'A bye has no result to report';
  }
  if (!REPORTABLE_OUTCOMES.includes(outcome) && outcome !== 'pending') {
    return 'Not a result';
  }
  if (round.kind === 'elimination' && (outcome === 'tie' || outcome === 'double-loss')) {
    return 'A top cut match needs a winner';
  }
  return null;
}

/** A top-cut round's results are fixed once the next round is paired from them. */
function settledBracket(pod: Pod, round: Round): string | null {
  const later = pod.rounds.some(r => r.number > round.number);
  return round.kind === 'elimination' && later ? 'The next top cut round is already paired' : null;
}

function reportResult(
  tournament: Tournament,
  command: Extract<Command, { type: 'reportResult' }>,
  ctx: CommandContext
): CommandResult {
  const found = findMatch(tournament, command);
  if (!found) {
    return fail('That match has changed; reload and try again');
  }
  const { pod, round, match } = found;
  const error = outcomeError(round, match, command.outcome) ?? settledBracket(pod, round);
  if (error) {
    return fail(error);
  }
  // An open match carries its pairing time, as TOM writes it.
  const timestamp = command.outcome === 'pending' ? round.pairTime : ctx.localTime;
  const matches = round.matches.map(m => (m === match ? { ...m, outcome: command.outcome, timestamp } : m));
  const status = matches.every(isReported) ? 'finished' : round.status === 'finished' ? 'started' : round.status;
  return done(withPod(tournament, withRound(pod, { ...round, matches, status })));
}

function swapPlayers(tournament: Tournament, category: PodCategory, a: string, b: string): CommandResult {
  const pod = findPod(tournament, category);
  const round = pod && latestRound(pod);
  if (!pod || !round || a === b) {
    return fail('Pick two different players in the current round');
  }
  const seats = [a, b].map(id => round.matches.find(m => m.p1 === id || m.p2 === id));
  if (seats.some(match => !match || match.outcome === 'loss' || (match.p2 !== null && isReported(match)))) {
    return fail('Both players must be in unreported matches or the bye');
  }
  const swap = (id: string | null) => (id === a ? b : id === b ? a : id);
  const matches = round.matches.map(m => (seats.includes(m) ? { ...m, p1: swap(m.p1) ?? m.p1, p2: swap(m.p2) } : m));
  return done(withPod(tournament, withRound(pod, { ...round, matches })));
}

function clock(tournament: Tournament, category: PodCategory, change: (round: Round) => Round): CommandResult {
  const pod = findPod(tournament, category);
  const round = pod && latestRound(pod);
  if (!pod || !round) {
    return fail('There is no round to time');
  }
  return done(withPod(tournament, withRound(pod, change(round))));
}

/** Seconds left on a round's clock at `now`. */
export function secondsLeft(round: Round, now: number): number {
  const running = round.clockStartedAt != null ? Math.floor((now - round.clockStartedAt) / 1000) : 0;
  return round.timeLeft - running;
}

function startClock(tournament: Tournament, category: PodCategory, ctx: CommandContext): CommandResult {
  return clock(tournament, category, round =>
    round.clockStartedAt != null
      ? round
      : {
          ...round,
          status: round.status === 'finished' ? round.status : 'started',
          startTime: round.startTime || ctx.localTime,
          clockStartedAt: ctx.now
        }
  );
}

function stopClock(tournament: Tournament, category: PodCategory, ctx: CommandContext): CommandResult {
  return clock(tournament, category, round => ({
    ...round,
    timeLeft: secondsLeft(round, ctx.now),
    clockStartedAt: null
  }));
}

function adjustClock(tournament: Tournament, category: PodCategory, seconds: number): CommandResult {
  if (!Number.isInteger(seconds) || Math.abs(seconds) > 3600) {
    return fail('Adjust by up to an hour at a time');
  }
  return clock(tournament, category, round => ({ ...round, timeLeft: round.timeLeft + seconds }));
}

/**
 * Who a cut seeds from: the pod, or in a pod that plays several divisions
 * together, the one division asked for, since each keeps its own cut. A
 * combined pod whose players are all one division (an unsanctioned event has
 * no birth dates, so everyone reads as Masters) cuts as a whole.
 */
function cutField(tournament: Tournament, pod: Pod, division: Division | undefined, season: number) {
  if (isDivision(pod.category)) {
    return undefined;
  }
  const of = divisionLookup(tournament, season);
  if (new Set(pod.playerIds.map(of)).size < 2) {
    return undefined;
  }
  return new Set(pod.playerIds.filter(id => of(id) === division));
}

function startTopCut(
  tournament: Tournament,
  command: Extract<Command, { type: 'startTopCut' }>,
  ctx: CommandContext
): CommandResult {
  const { size } = command;
  const pod = findPod(tournament, command.pod);
  const latest = pod && latestRound(pod);
  if (!pod || !latest || latest.kind !== 'swiss' || !roundComplete(latest)) {
    return fail('Finish the Swiss rounds first');
  }
  if (!(TOP_CUT_SIZES as readonly number[]).includes(size)) {
    return fail('A top cut is 2, 4, 8, 16 or 32 players');
  }
  const only = cutField(tournament, pod, command.division, ctx.season);
  if (only && !command.division) {
    return fail('Pick the division to cut');
  }
  const seeds = swissStandings(pod, tournament.players, only ? { only } : {})
    .filter(row => !row.dropped)
    .slice(0, size)
    .map(row => row.playerId);
  if (seeds.length < size) {
    return fail('Not enough players for that cut');
  }
  const closed = withRound(pod, { ...latest, status: 'finished', clockStartedAt: null });
  const pairings = pairTopCut(seeds);
  const round = pairedRound(tournament, pod, ctx, { number: latest.number + 1, kind: 'elimination', pairings });
  return done(withPod(tournament, { ...closed, cut: size, rounds: [...closed.rounds, round] }));
}

function updateInfo(tournament: Tournament, info: Partial<Pick<TournamentInfo, EditableInfo>>): CommandResult {
  const next = { ...tournament.info, ...info };
  if (!next.name.trim()) {
    return fail('The event needs a name');
  }
  const minutes = [next.roundTime, next.finalsRoundTime];
  if (minutes.some(value => !Number.isInteger(value) || value < 1 || value > 180)) {
    return fail('Round times are whole minutes, up to 180');
  }
  return done({ ...tournament, info: next });
}

type Handlers = {
  [T in Command['type']]: (
    tournament: Tournament,
    command: Extract<Command, { type: T }>,
    ctx: CommandContext
  ) => CommandResult;
};

const HANDLERS: Handlers = {
  addPlayer: (t, c, ctx) => addPlayer(t, c.player, ctx),
  editPlayer: (t, c, ctx) =>
    updatePlayer(t, c.id, p => ({
      ...p,
      firstName: c.firstName.trim() || p.firstName,
      lastName: c.lastName.trim() || p.lastName,
      birthDate: c.birthDate.trim(),
      modified: ctx.localTime
    })),
  removePlayer: (t, c) => removePlayer(t, c.id),
  dropPlayer: (t, c, ctx) => dropPlayer(t, c.id, ctx),
  undropPlayer: (t, c, ctx) => undropPlayer(t, c.id, ctx),
  setFixedTable: (t, c) => setFixedTable(t, c.id, c.table),
  pairRound: (t, c, ctx) => pairRound(t, c.pod, ctx),
  repairRound: (t, c, ctx) => repairRound(t, c.pod, c.keepReported, ctx),
  deleteRound: (t, c) => deleteRound(t, c.pod),
  startClock: (t, c, ctx) => startClock(t, c.pod, ctx),
  stopClock: (t, c, ctx) => stopClock(t, c.pod, ctx),
  adjustClock: (t, c) => adjustClock(t, c.pod, c.seconds),
  reportResult: (t, c, ctx) => reportResult(t, c, ctx),
  swapPlayers: (t, c) => swapPlayers(t, c.pod, c.a, c.b),
  startTopCut: (t, c, ctx) => startTopCut(t, c, ctx),
  updateInfo: (t, c) => updateInfo(t, c.info)
};

export function applyCommand(tournament: Tournament, command: Command, ctx: CommandContext): CommandResult {
  const handler = HANDLERS[command.type] as (t: Tournament, c: Command, x: CommandContext) => CommandResult;
  return handler(tournament, command, ctx);
}
