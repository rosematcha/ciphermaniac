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

import { divisionFor, divisionLookup, parseTomDate, seasonOf, yearOnlyBirthDate } from './divisions.js';
import { type Pairing, pairNextElimination, pairSwiss, pairTopCut, sortSwissPairings } from './pairing.js';
import { categoryFor, divisionsOf, poddingFor } from './podding.js';
import { type Random, shuffled } from './random.js';
import {
  activeIds,
  cutPodOf,
  cutPodsOf,
  findMatch,
  fixedTables,
  fullRoundSeconds,
  hasPlayed,
  hasStarted,
  isReported,
  latestRound,
  livePods,
  type MatchStamp,
  normalizeCutPods,
  pairingHistory,
  podOf,
  pointsBefore,
  roundComplete,
  seatPairings,
  toMatches
} from './rounds.js';
import { bracketMatches, eliminationResult, swissStandings } from './standings.js';
import { eventTypeOf, recommendedStructure, SANCTIONED, sanctionedMinutesError } from './structure.js';
import {
  type Division,
  DIVISION_LABELS,
  DIVISIONS,
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
  /** Set when the player's own decklist submission adds them (see functions/api/tournaments/[code]/decklists.ts). */
  fromList?: boolean;
}

export type Command =
  | { type: 'addPlayer'; player: NewPlayer }
  | { type: 'editPlayer'; id: string; firstName: string; lastName: string; birthDate: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'dropPlayer'; id: string }
  | { type: 'disqualifyPlayer'; id: string }
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
  | { type: 'startTopCut'; pod: PodCategory; size: number; division?: Division; playoff3rd4th?: boolean }
  | { type: 'updateInfo'; info: Partial<Pick<TournamentInfo, EditableInfo>> };

export type EditableInfo =
  'name' | 'city' | 'state' | 'country' | 'roundTime' | 'finalsRoundTime' | 'startDate' | 'eventType';

export interface CommandContext {
  /** Epoch ms. */
  now: number;
  /** A Play! Pokémon event, held to what makes one valid (see SANCTIONED). */
  sanctioned?: boolean;
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

/**
 * A pod of several divisions whose divisions have gone on to their top cuts
 * has played its last round: its rounds seed the cuts, so they stand.
 */
const CUTS_UNDER_WAY = 'Its divisions are playing their top cuts; change those instead';

/** The pod a round command names, or why it cannot take one: none by that name, or its cuts under way. */
function roundPod(tournament: Tournament, category: PodCategory): Pod | string {
  const pod = findPod(tournament, category);
  if (!pod) {
    return 'There is no round to change';
  }
  return tournament.pods.some(p => p.cutOf === category) ? CUTS_UNDER_WAY : pod;
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

/** Where a division nobody played in goes once play has started: the pods §5.2.1 would have combined it into. */
const JOINS: Record<Division, readonly Division[]> = {
  junior: ['senior', 'masters'],
  senior: ['masters', 'junior'],
  masters: ['senior', 'junior']
};

/**
 * The pod a player joins once play has started, when the pods stand: the one
 * that plays their division, or for a division nobody played in, the one it
 * would have been combined into, which plays it from then on. `replaces` is
 * the pod as it stood, when it changes category.
 */
function podFor(tournament: Tournament, division: Division): { pod: Pod; replaces?: Pod } {
  const plays = (d: Division) => tournament.pods.find(pod => !pod.cutOf && divisionsOf(pod.category).includes(d));
  const playing = plays(division);
  if (playing) {
    return { pod: playing, replaces: playing };
  }
  const into = JOINS[division].map(plays).find(pod => pod !== undefined);
  if (!into) {
    return { pod: newPod(division) };
  }
  return { pod: { ...into, category: categoryFor([...divisionsOf(into.category), division]) }, replaces: into };
}

/** A division's age as the pods list them: the youngest a pod plays. */
const youngest = (category: PodCategory) => DIVISIONS.indexOf(divisionsOf(category)[0] as Division);

/**
 * Before round 1, the pods §5.2.1 makes of the field (see podding.ts),
 * youngest first, each keeping its own settings. The field is counted by the
 * players still in; one who dropped before play joins their division's pod,
 * or the first when theirs has none. Once a round is paired the pods stand.
 */
function podded(tournament: Tournament, season: number): Tournament {
  if (hasStarted(tournament)) {
    return tournament;
  }
  const divisionOf = (player: Player) => divisionFor(player.birthDate, season);
  const counts: Record<Division, number> = { junior: 0, senior: 0, masters: 0 };
  for (const player of tournament.players) {
    counts[divisionOf(player)] += player.droppedAfter === null ? 1 : 0;
  }
  const podding = poddingFor(counts);
  const categories = [...new Set(podding.values())].sort((a, b) => youngest(a) - youngest(b));
  const categoryOf = (player: Player) => podding.get(divisionOf(player)) ?? categories[0] ?? divisionOf(player);
  const pods = [...new Set([...categories, ...tournament.players.map(categoryOf)])].map(category => ({
    ...(findPod(tournament, category) ?? newPod(category)),
    playerIds: tournament.players.filter(player => categoryOf(player) === category).map(player => player.id)
  }));
  return { ...tournament, pods };
}

/**
 * A player as they join, marked when their decklist added them. One added
 * once play has started takes losses for the rounds they missed (see
 * missedRounds), has no starter flag, and carries TOM's structured late tag.
 */
function newPlayer(
  fields: Pick<Player, 'id' | 'firstName' | 'lastName' | 'birthDate'> & { fromList?: boolean | undefined },
  ctx: CommandContext
): Player {
  const { fromList, ...rest } = fields;
  return {
    ...rest,
    droppedAfter: null,
    ...(fromList ? { fromList: true } : {}),
    created: ctx.localTime,
    modified: ctx.localTime
  };
}

function latePlayer(fields: Parameters<typeof newPlayer>[0], pod: Pod, ctx: CommandContext): Player {
  return {
    ...newPlayer(fields, ctx),
    starter: false,
    late: true,
    lateData: {
      round: latestRound(pod)?.number ?? -1,
      timestamp: ctx.localTime,
      forcedLoss: true,
      usedForcedLoss: true
    }
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
  const birthDate = yearOnlyBirthDate(input.birthDate ?? '');
  const fields = { id, firstName, lastName, birthDate, fromList: input.fromList };
  if (!hasStarted(tournament)) {
    // Every roster change before round 1 pods the field again (see podded), so any pod will do.
    const player = newPlayer(fields, ctx);
    return done({ ...tournament, players: [...tournament.players, player] });
  }
  const { pod, replaces } = podFor(tournament, divisionFor(birthDate, ctx.season));
  if (pod.rounds.some(r => r.kind === 'elimination')) {
    return fail('Their division’s Swiss rounds are over; the top cuts are under way');
  }
  const player = latePlayer(fields, pod, ctx);
  const joined = missedRounds(pod, id, ctx.localTime);
  const pods = replaces ? tournament.pods.map(p => (p === replaces ? joined : p)) : [...tournament.pods, joined];
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

/**
 * The match a player leaving mid-round forfeits: a player who drops before
 * their match is over loses its unresolved games (Tournament Rules Handbook
 * §5.7.1), so their opponent wins, or in a top cut goes through.
 */
function forfeitOpenMatch(tournament: Tournament, id: string, ctx: CommandContext): Tournament {
  const pod = podOf(tournament, id);
  const round = pod && latestRound(pod);
  const match = round?.matches.find(m => m.outcome === 'pending' && m.p2 !== null && (m.p1 === id || m.p2 === id));
  if (!pod || !round || !match) {
    return tournament;
  }
  const outcome: Outcome = match.p1 === id ? 'p2' : 'p1';
  const matches = round.matches.map(m => (m === match ? { ...m, outcome, timestamp: ctx.localTime } : m));
  const status = matches.every(isReported) ? 'finished' : round.status;
  return withPod(tournament, withRound(pod, { ...round, matches, status }));
}

/**
 * Takes a player out of the rounds still to pair, forfeiting a match they
 * are in. A disqualified player also leaves the standings (§5.7.3), though
 * their results still count for their opponents' tiebreakers.
 */
function dropPlayer(tournament: Tournament, id: string, ctx: CommandContext, disqualified = false): CommandResult {
  const pod = podOf(tournament, id);
  const round = pod ? latestRound(pod) : undefined;
  return updatePlayer(forfeitOpenMatch(tournament, id, ctx), id, player => ({
    ...player,
    droppedAfter: round?.number ?? 0,
    ...(disqualified ? { disqualified: true } : {}),
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

/**
 * The match a drop forfeited, opened again: still the latest round's, decided
 * against the player at the moment they dropped (its result stamped with the
 * drop's own time), so a result entered since stands.
 */
function reopenForfeit(tournament: Tournament, player: Player): Tournament {
  const pod = podOf(tournament, player.id);
  const round = pod && latestRound(pod);
  const lost = (m: Match) => (m.p1 === player.id && m.outcome === 'p2') || (m.p2 === player.id && m.outcome === 'p1');
  const match = round?.matches.find(m => m.p2 !== null && lost(m) && m.timestamp === player.modified);
  if (!pod || !round || !match) {
    return tournament;
  }
  const matches = round.matches.map(m =>
    m === match ? { ...m, outcome: 'pending' as const, timestamp: round.pairTime } : m
  );
  const status = round.startTime ? 'started' : 'paired';
  return withPod(tournament, withRound(pod, { ...round, matches, status }));
}

function undropPlayer(tournament: Tournament, id: string, ctx: CommandContext): CommandResult {
  const player = tournament.players.find(p => p.id === id);
  if (player?.droppedAfter != null && !canUndrop(tournament, player)) {
    return fail(`They dropped before round ${player.droppedAfter + 1} was paired, so they can’t come back now`);
  }
  const reopened = player?.droppedAfter != null ? reopenForfeit(tournament, player) : tournament;
  return updatePlayer(reopened, id, ({ disqualified: _dq, ...p }) => ({
    ...p,
    droppedAfter: null,
    modified: ctx.localTime
  }));
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
  return { firstTable: firstTableFor(tournament, pod), timestamp: ctx.localTime, fixed: fixedTables(tournament) };
}

/**
 * The first table a pod's new round takes: its own first, past every table a
 * round still playing in another pod holds. Divisions paired apart, and their
 * top cuts, play at once, so none of them shares a table with another.
 */
function firstTableFor(tournament: Tournament, pod: Pod): number {
  const held = livePods(tournament)
    .filter(other => other.category !== pod.category)
    .map(other => latestRound(other))
    .filter((round): round is Round => round !== undefined && !roundComplete(round))
    .flatMap(round => round.matches.map(match => match.table));
  return Math.max(pod.startingTable, ...held.map(table => table + 1));
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
    timeLeft: fullRoundSeconds(tournament, round.kind),
    pairTime: ctx.localTime,
    startTime: '',
    clockStartedAt: null,
    matches: (swiss ? toMatches : seatPairings)(round.pairings, stampFor(tournament, pod, ctx))
  };
}

function swissEntrants(tournament: Tournament, pod: Pod, number: number, ids: string[]) {
  const points = pointsBefore(pod, number);
  const of = divisionLookup(tournament);
  return ids.map(id => ({ id, points: points.get(id) ?? 0, category: DIVISIONS.indexOf(of(id)) }));
}

function nextSwissRound(tournament: Tournament, pod: Pod, ctx: CommandContext): Round {
  const number = pod.rounds.length + 1;
  const active = new Set(activeIds(tournament, pod));
  const assigned = tournament.players.filter(p => active.has(p.id) && (p.byes ?? 0) >= number);
  const given = new Set(assigned.map(p => p.id));
  const entrants = swissEntrants(
    tournament,
    pod,
    number,
    [...active].filter(id => !given.has(id))
  );
  const pairings = sortSwissPairings(pairSwiss(entrants, pairingHistory(pod), ctx.random), entrants);
  const round = pairedRound(tournament, pod, ctx, { number, kind: 'swiss', pairings });
  const byes: Match[] = assigned.map(p => ({
    table: 0,
    p1: p.id,
    p2: null,
    outcome: 'assigned-bye',
    timestamp: ctx.localTime
  }));
  return { ...round, matches: [...byes, ...round.matches] };
}

/**
 * Winners and losers of the latest elimination round's bracket, in bracket
 * order (a third-place match is no part of it); null while any match is open.
 */
function eliminationResults(pod: Pod, round: Round): { winners: string[]; losers: string[] } | null {
  const winners: string[] = [];
  const losers: string[] = [];
  for (const match of bracketMatches(pod, round)) {
    const result = eliminationResult(match);
    if (!result) {
      return null;
    }
    winners.push(result.winner);
    losers.push(...(result.loser ? [result.loser] : []));
  }
  return { winners, losers };
}

function advancingPairings(tournament: Tournament, pod: Pod): Pairing[] | null {
  const latest = latestRound(pod);
  const results = latest && eliminationResults(pod, latest);
  if (!results) {
    return null;
  }
  if (results.winners.length < 2) {
    return [];
  }
  const gone = new Set(tournament.players.filter(p => p.droppedAfter !== null).map(p => p.id));
  const playoff = pod.playoff3rd4th && results.losers.some(id => !gone.has(id)) ? results.losers : [];
  return pairNextElimination(results.winners, playoff);
}

function nextEliminationRound(tournament: Tournament, pod: Pod, latest: Round, ctx: CommandContext): CommandResult {
  const views = cutPodsOf(tournament, pod);
  const brackets = views.length
    ? [...views].sort((a, b) => DIVISIONS.indexOf(b.category as Division) - DIVISIONS.indexOf(a.category as Division))
    : [pod];
  const next = brackets.map(bracket => advancingPairings(tournament, bracket));
  if (next.some(p => p === null)) {
    return fail('Report every match before pairing the next round');
  }
  const pairings = next.flatMap(p => p ?? []);
  if (!pairings.length) {
    return fail('The top cut is finished');
  }
  const round = pairedRound(tournament, pod, ctx, { number: latest.number + 1, kind: 'elimination', pairings });
  const paired = withPod(tournament, { ...pod, rounds: [...pod.rounds, round] });
  return done(
    tournament.players.filter(p => p.droppedAfter !== null).reduce((t, p) => forfeitOpenMatch(t, p.id, ctx), paired)
  );
}

function startingCuts(t: Tournament, pod: Pod): Pick<Pod, 'cut' | 'divisionCuts' | 'divisionCounts'> {
  const of = divisionLookup(t);
  const divisionCounts: Partial<Record<Division, number>> = Object.fromEntries(
    divisionsOf(pod.category).map(d => [d, pod.playerIds.filter(id => of(id) === d).length])
  );
  const sizes = divisionsOf(pod.category).map(
    d => [d, recommendedStructure(divisionCounts[d]!, eventTypeOf(t)).cut] as const
  );
  if (isDivision(pod.category)) {
    return { cut: pod.cut || sizes[0]?.[1] || 0, divisionCounts };
  }
  return {
    cut: 0,
    divisionCounts,
    divisionCuts: Object.fromEntries(
      sizes
        .filter(([, size]) => size > 0)
        .map(([division, size]) => [
          division,
          { size, playoff3rd4th: pod.playoff3rd4th, playerIds: pod.playerIds.filter(id => of(id) === division) }
        ])
    )
  };
}

function startRoster(tournament: Tournament, ctx: CommandContext): Tournament {
  if (hasStarted(tournament)) {
    return tournament;
  }
  const players = shuffled(tournament.players, ctx.random).map(p => ({ ...p, starter: true }));
  const pods = tournament.pods.map(p => {
    const playerIds = shuffled(p.playerIds, ctx.random);
    return { ...p, ...startingCuts(tournament, p), playerIds, startingPlayerIds: [...playerIds] };
  });
  return {
    ...tournament,
    players,
    pods,
    startedAt: ctx.now,
    info: { ...tournament.info, startDate: ctx.localTime.slice(0, 10) }
  };
}

const activePlayers = (tournament: Tournament) => tournament.players.filter(p => p.droppedAfter === null).length;

function pairRound(input: Tournament, category: PodCategory, ctx: CommandContext): CommandResult {
  const tournament = input;
  if (tournament.pods.some(p => p.cutOf === category)) {
    return fail(CUTS_UNDER_WAY);
  }
  const pod = findPod(tournament, category);
  if (!pod || activeIds(tournament, pod).length < 2) {
    return fail('Add at least two players first');
  }
  if (ctx.sanctioned && !hasStarted(tournament) && activePlayers(tournament) < SANCTIONED.players) {
    return fail(`A sanctioned event needs at least ${SANCTIONED.players} players`);
  }
  const latest = latestRound(pod);
  if (latest && !roundComplete(latest)) {
    return fail('Report every match before pairing the next round');
  }
  if (latest?.kind === 'elimination') {
    return nextEliminationRound(tournament, pod, latest, ctx);
  }
  const closed = latest ? withRound(pod, { ...latest, status: 'finished', clockStartedAt: null }) : pod;
  const started = startRoster(tournament, ctx);
  const ready = findPod(started, category) as Pod;
  const round = nextSwissRound(started, { ...ready, rounds: closed.rounds }, ctx);
  return done(withPod(started, { ...ready, rounds: [...closed.rounds, round] }));
}

/** Earned byes survive a re-pair; reported two-player matches can also be retained. */
function keptMatches(round: Round, keepReported: boolean): Match[] {
  return round.matches.filter(
    match => match.outcome === 'assigned-bye' || (keepReported && match.p2 !== null && isReported(match))
  );
}

function repairRound(tournament: Tournament, category: PodCategory, keepReported: boolean, ctx: CommandContext) {
  const pod = roundPod(tournament, category);
  if (typeof pod === 'string') {
    return fail(pod);
  }
  const round = latestRound(pod);
  if (!round) {
    return fail('There is no round to re-pair');
  }
  if (round.kind !== 'swiss') {
    return fail('Only a Swiss round can be re-paired');
  }
  const kept = keptMatches(round, keepReported);
  const seated = new Set(kept.flatMap(match => [match.p1, match.p2]));
  const entrants = swissEntrants(
    tournament,
    pod,
    round.number,
    activeIds(tournament, pod).filter(id => !seated.has(id))
  );

  const pairings = sortSwissPairings(pairSwiss(entrants, pairingHistory(pod, round.number), ctx.random), entrants);
  const fresh = toMatches(pairings, {
    ...stampFor(tournament, pod, ctx),
    taken: new Set(kept.map(match => match.table))
  });
  // Dropped players keep the missed-round entries they already had in this round.
  const stale = round.matches.filter(m => m.p2 === null && m.outcome === 'loss' && !entrants.some(e => e.id === m.p1));
  const matches = [...kept, ...fresh, ...stale];
  return done(
    withPod(
      tournament,
      withRound(pod, { ...round, status: round.startTime ? 'started' : 'paired', pairTime: ctx.localTime, matches })
    )
  );
}

function deleteRound(tournament: Tournament, category: PodCategory): CommandResult {
  const pod = roundPod(tournament, category);
  if (typeof pod === 'string') {
    return fail(pod);
  }
  const round = latestRound(pod);
  if (!round) {
    return fail('There is no round to delete');
  }
  if (round.matches.some(match => match.p2 !== null && isReported(match))) {
    return fail('Clear this round’s results before deleting it');
  }
  const rounds = pod.rounds.slice(0, -1);
  if (pod.cutOf && rounds.length === 0) {
    // A division's top cut with no round left has not started: its division is back where the Swiss left it.
    return done({ ...tournament, pods: tournament.pods.filter(p => p !== pod) });
  }
  return done(withPod(tournament, { ...pod, rounds, cut: rounds.some(r => r.kind === 'elimination') ? pod.cut : 0 }));
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
  const timestamp = ctx.localTime;
  const matches = round.matches.map(m => (m === match ? { ...m, outcome: command.outcome, timestamp } : m));
  const status = matches.every(isReported) ? 'finished' : round.status === 'finished' ? 'started' : round.status;
  return done(withPod(tournament, withRound(pod, { ...round, matches, status })));
}

function swapPlayers(tournament: Tournament, category: PodCategory, a: string, b: string): CommandResult {
  const pod = roundPod(tournament, category);
  if (typeof pod === 'string') {
    return fail(pod);
  }
  const round = latestRound(pod);
  if (!round || a === b) {
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
          startedAt: round.startedAt ?? ctx.now,
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
 * together, the one division asked for, since each keeps its own standings
 * and cut (Tournament Rules Handbook §5.2.1). A pod whose players are all one
 * division (an unsanctioned event has no birth dates, so everyone reads as
 * Masters) cuts as a whole.
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

/** Why the cut asked for cannot start, or null when it can. */
function cutRefusal(
  tournament: Tournament,
  pod: Pod | undefined,
  command: Extract<Command, { type: 'startTopCut' }>,
  ctx: CommandContext
) {
  const latest = pod?.rounds.filter(r => r.kind === 'swiss').at(-1);
  if (!pod || !latest || !roundComplete(latest)) {
    return 'Finish the Swiss rounds first';
  }
  if (ctx.sanctioned && pod.rounds.filter(round => round.kind === 'swiss').length < SANCTIONED.swissRounds) {
    return `A sanctioned event plays at least ${SANCTIONED.swissRounds} Swiss rounds before its top cut`;
  }
  if (eventTypeOf(tournament) === 'challenge') {
    return 'A League Challenge has no top cut';
  }
  if (!(TOP_CUT_SIZES as readonly number[]).includes(command.size)) {
    return 'A top cut is 2, 4, 8, 16 or 32 players';
  }
  const taken = command.division && cutPodOf(tournament, pod, command.division);
  return taken ? `The ${DIVISION_LABELS[command.division as Division]} top cut has started` : null;
}

function startTopCut(
  tournament: Tournament,
  command: Extract<Command, { type: 'startTopCut' }>,
  ctx: CommandContext
): CommandResult {
  const { size, division } = command;
  // A third-place match needs two semifinal losers: a cut of four or more.
  const playoff3rd4th = command.playoff3rd4th === true && size >= 4;
  const pod = findPod(tournament, command.pod);
  const refusal = cutRefusal(tournament, pod, command, ctx);
  if (!pod || refusal) {
    return fail(refusal ?? 'Finish the Swiss rounds first');
  }
  const only = cutField(tournament, pod, division, ctx.season);
  if (only && !division) {
    return fail('Pick the division to cut');
  }
  const seeds = swissStandings(pod, tournament.players, only ? { only } : {})
    .filter(row => !row.dropped)
    .slice(0, size)
    .map(row => row.playerId);
  if (seeds.length < size) {
    return fail('Not enough players for that cut');
  }
  return openCut(tournament, pod, { seeds, division, playoff3rd4th }, ctx);
}

function openCut(
  tournament: Tournament,
  pod: Pod,
  config: { seeds: string[]; division: Division | undefined; playoff3rd4th: boolean },
  ctx: CommandContext
): CommandResult {
  const { seeds, division, playoff3rd4th } = config;
  const size = seeds.length;
  const swiss = pod.rounds.filter(r => r.kind === 'swiss').at(-1) as Round;
  const existing = pod.rounds.find(r => r.kind === 'elimination');
  if (existing && (pod.rounds.at(-1) !== existing || existing.matches.some(m => m.outcome !== 'pending'))) {
    return fail('The top cut has started; finish configuring divisions before entering results');
  }
  const pairings = pairTopCut(seeds);
  const seedOf = new Map(seeds.map((id, i) => [id, i + 1]));
  const orderOf = new Map(pairings.flatMap(p => [p.p1, p.p2]).map((id, i) => [id, i + 1]));
  const players = tournament.players.map(p =>
    seedOf.has(p.id) ? { ...p, seed: seedOf.get(p.id)!, order: orderOf.get(p.id)! } : p
  );
  const divisionOf = divisionLookup(tournament, ctx.season);
  const cutDivision = division ?? divisionOf(seeds[0] as string);
  const divisionCuts = isDivision(pod.category)
    ? pod.divisionCuts
    : { ...pod.divisionCuts, [cutDivision]: { size, playoff3rd4th, playerIds: seeds } };
  const fresh = pairedRound(tournament, pod, ctx, { number: swiss.number + 1, kind: 'elimination', pairings });
  const matches = [...(existing?.matches ?? []), ...fresh.matches].sort(
    (a, b) => DIVISIONS.indexOf(divisionOf(b.p1)) - DIVISIONS.indexOf(divisionOf(a.p1))
  );
  const seated = seatPairings(matches, { firstTable: pod.startingTable, timestamp: ctx.localTime });
  const round = { ...fresh, matches: seated };
  const rounds = [...pod.rounds.filter(r => r.kind === 'swiss'), round];
  return done(
    withPod(
      { ...tournament, players },
      { ...pod, cut: isDivision(pod.category) ? size : 0, playoff3rd4th, divisionCuts, rounds }
    )
  );
}

function updateInfo(
  tournament: Tournament,
  info: Partial<Pick<TournamentInfo, EditableInfo>>,
  ctx: CommandContext
): CommandResult {
  const next = { ...tournament.info, ...info };
  if (!next.name.trim()) {
    return fail('The event needs a name');
  }
  const minutes = [next.roundTime, next.finalsRoundTime];
  if (minutes.some(value => !Number.isInteger(value) || value < 1 || value > 180)) {
    return fail('Round times are whole minutes, up to 180');
  }
  const short = ctx.sanctioned ? sanctionedMinutesError(next) : null;
  if (short) {
    return fail(short);
  }
  const cutStarted = tournament.pods.some(pod => pod.rounds.some(round => round.kind === 'elimination'));
  if (cutStarted && eventTypeOf({ info: next }) !== eventTypeOf(tournament)) {
    return fail('The top cut has started; the event type stays as it is');
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
      birthDate: yearOnlyBirthDate(c.birthDate),
      modified: ctx.localTime
    })),
  removePlayer: (t, c) => removePlayer(t, c.id),
  dropPlayer: (t, c, ctx) => dropPlayer(t, c.id, ctx),
  disqualifyPlayer: (t, c, ctx) => dropPlayer(t, c.id, ctx, true),
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
  updateInfo: (t, c, ctx) => updateInfo(t, c.info, ctx)
};

/** The commands that change who plays or in which season, after which the field is podded again before round 1. */
const ROSTER: ReadonlySet<Command['type']> = new Set([
  'addPlayer',
  'editPlayer',
  'removePlayer',
  'dropPlayer',
  'disqualifyPlayer',
  'undropPlayer',
  'updateInfo'
]);

export function applyCommand(input: Tournament, command: Command, ctx: CommandContext): CommandResult {
  const tournament = normalizeCutPods(input);
  const handler = HANDLERS[command.type] as (t: Tournament, c: Command, x: CommandContext) => CommandResult;
  const result = handler(tournament, command, ctx);
  if (!result.ok || !ROSTER.has(command.type)) {
    return result;
  }
  // The command's season, unless the change itself gave the event a start date that sets another.
  const dated = parseTomDate(result.tournament.info.startDate);
  return done(podded(result.tournament, dated ? seasonOf(dated) : ctx.season));
}
