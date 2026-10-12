/**
 * Records and standings, by the Play! Pokémon Tournament Rules Handbook
 * (Sept 2026, §5.3, §5.5.2, §5.6.1).
 *
 * Players rank by match points (three for a win or a bye, one for a tie). A
 * player TOM tagged late ranks below everyone else on the same points, as TOM
 * ranks them. Then
 * opponents' win percentage (OWP), then opponents' opponents' (OOWP, the
 * mean of each opponent's OWP), then head-to-head, then their fixed roster order.
 *
 * A win percentage is wins over rounds played, a tie counting half a win,
 * floored at 25% and capped at 100%, or 75% for a player who dropped before
 * playing every Swiss round the pod plans (TOM's Score). A bye is
 * a win on the record but neither a win nor a round in the percentage, and it
 * gives no opponent to average. A round a late entrant missed is a loss.
 *
 * A player who dropped keeps the OWP and OOWP they had when they dropped, as
 * TOM ranks them: replayed over 51 divisions TOM finalized, this is the only
 * reading that places every dropped player where TOM did. A disqualified
 * player, or one outside the division being ranked, keeps them too, so their
 * opponents' OOWP sees the same rates.
 *
 * Only Swiss rounds count here. A top cut is placed by its own bracket, and
 * `placeFinals` lays those places over the Swiss order.
 */

import type { Match, Outcome, Player, Pod, Round } from './types.js';

export const WIN_POINTS = 3;
export const TIE_POINTS = 1;
export const MIN_WIN_RATE = 0.25;
export const DROPPED_MAX_WIN_RATE = 0.75;

export interface MatchRecord {
  /** Byes included, as the record shows them. */
  wins: number;
  losses: number;
  ties: number;
}

export interface Standing {
  playerId: string;
  place: number;
  record: MatchRecord;
  points: number;
  /** Opponents' win percentage, 0..1. */
  owp: number;
  /** Opponents' opponents' win percentage, 0..1. */
  oowp: number;
  dropped: boolean;
  late: boolean;
}

type Side = 'win' | 'loss' | 'tie' | null;

/** What a finished match meant for the player in seat one or two; null while unreported. */
export function sideResult(outcome: Outcome, seat: 1 | 2): Side {
  switch (outcome) {
    case 'p1':
      return seat === 1 ? 'win' : 'loss';
    case 'p2':
      return seat === 2 ? 'win' : 'loss';
    case 'assigned-bye':
    case 'bye':
      return 'win';
    case 'tie':
      return 'tie';
    case 'double-loss':
    case 'loss':
      return 'loss';
    case 'deleted':
    case 'pending':
    default:
      return null;
  }
}

export interface Tally {
  record: MatchRecord;
  byes: number;
  assignedByes?: number;
  /** Decided rounds the player had, any result or a bye: what TOM checks a dropped player's rounds against. */
  matches: number;
  opponents: string[];
  /** Net wins against each opponent, for head-to-head. */
  headToHead: Map<string, number>;
}

function tallyFor(tallies: Map<string, Tally>, id: string): Tally {
  let tally = tallies.get(id);
  if (!tally) {
    tally = { record: { wins: 0, losses: 0, ties: 0 }, byes: 0, matches: 0, opponents: [], headToHead: new Map() };
    tallies.set(id, tally);
  }
  return tally;
}

const RECORD_KEY: { [side in Exclude<Side, null>]: keyof MatchRecord } = { win: 'wins', loss: 'losses', tie: 'ties' };

function countSeat(tallies: Map<string, Tally>, match: Match, seat: 1 | 2): void {
  const id = seat === 1 ? match.p1 : match.p2;
  const side = sideResult(match.outcome, seat);
  if (id === null || match.outcome === 'pending') {
    return;
  }
  const tally = tallyFor(tallies, id);
  tally.matches += 1;
  if (side !== null) {
    tally.record[RECORD_KEY[side]] += 1;
  }
  tally.byes += match.outcome === 'bye' ? 1 : 0;
  if (match.outcome === 'assigned-bye') {
    tally.assignedByes = (tally.assignedByes ?? 0) + 1;
  }
  const opponent = seat === 1 ? match.p2 : match.p1;
  if (opponent === null) {
    return;
  }
  // A double loss gives neither player a head-to-head win (SPEC 3.7).
  countOpponent(tally, opponent, match.outcome === 'double-loss' ? null : side);
}

function countOpponent(tally: Tally, opponent: string, side: Side): void {
  tally.opponents.push(opponent);
  const net = tally.headToHead;
  net.set(opponent, (net.get(opponent) ?? 0) + (side === 'win' ? 1 : side === 'loss' ? -1 : 0));
}

/** Every player's record and opponents over the pod's decided Swiss matches. */
export function tallySwiss(pod: Pod, throughRound = Infinity): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const id of pod.playerIds) {
    tallyFor(tallies, id);
  }
  for (const round of pod.rounds) {
    if (round.kind !== 'swiss' || round.number > throughRound) {
      continue;
    }
    countRound(tallies, round);
  }
  return tallies;
}

function countRound(tallies: Map<string, Tally>, round: Round): void {
  for (const match of round.matches) {
    countSeat(tallies, match, 1);
    countSeat(tallies, match, 2);
  }
}

export function matchPoints(record: MatchRecord): number {
  return record.wins * WIN_POINTS + record.ties * TIE_POINTS;
}

/** A player's win percentage as an opponent (see the module note); `capped` for one who dropped early. */
export function winRate(tally: Tally, capped: boolean): number {
  const played = tally.record.wins + tally.record.losses + tally.record.ties - tally.byes;
  const won = tally.record.wins - tally.byes + tally.record.ties / 2;
  const rate = played > 0 ? won / played : 0;
  return Math.min(capped ? DROPPED_MAX_WIN_RATE : 1, Math.max(MIN_WIN_RATE, rate));
}

/** Score.round: HALF_EVEN, four significant figures on the percentage (five at 100%). */
function tomRate(rate: number): number {
  if (rate === 0) {
    return 0;
  }
  const percent = rate * 100;
  const precision = percent >= 100 ? 5 : 4;
  const scale = 10 ** (precision - 1 - Math.floor(Math.log10(percent)));
  const scaled = percent * scale;
  const integer = Math.floor(scaled);
  const rounded = Math.abs(scaled - integer - 0.5) < 1e-8 ? integer + (integer % 2) : Math.round(scaled);
  return rounded / (scale * 100);
}

function opponentAverage(opponents: readonly string[], values: ReadonlyMap<string, number>, assigned = 0): number {
  let sum = assigned;
  for (const id of opponents) {
    sum += values.get(id) ?? 0;
  }
  const count = opponents.length + assigned;
  return count === 0 ? 0 : tomRate(sum / count);
}

/**
 * The order two players rank in. The handbook ends on a random draw; TOM
 * ends on the fixed shuffled roster (the .tdf's player list), and so
 * does this, which also keeps the organizer's copy and the public one, whose
 * player IDs differ, in the same order.
 */
function compareStandings(order: ReadonlyMap<string, number>, tallies: ReadonlyMap<string, Tally>) {
  return (a: Omit<Standing, 'place'>, b: Omit<Standing, 'place'>): number =>
    b.points - a.points ||
    Number(a.late) - Number(b.late) ||
    b.owp - a.owp ||
    b.oowp - a.oowp ||
    -(tallies.get(a.playerId)?.headToHead.get(b.playerId) ?? 0) ||
    (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0);
}

type Row = Omit<Standing, 'place'>;

interface Tiebreakers {
  owp: number;
  oowp: number;
}

function ranked(id: string, byId: ReadonlyMap<string, Player>, options: StandingsOptions): boolean {
  return (!options.only || options.only.has(id)) && (options.withDisqualified === true || !byId.get(id)?.disqualified);
}

const plannedRounds = (pod: Pod, options: StandingsOptions): number =>
  options.regularRounds ?? pod.rounds.filter(round => round.kind === 'swiss').length;

function snapshotRound(current: Map<string, Tally>, round: Round): Map<string, Tally> {
  if (round.kind !== 'swiss') {
    return current;
  }
  const snapshot = new Map(current);
  const seats = new Set(round.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])));
  for (const id of seats) {
    const old = tallyFor(snapshot, id);
    snapshot.set(id, {
      ...old,
      record: { ...old.record },
      opponents: [...old.opponents],
      headToHead: new Map(old.headToHead)
    });
  }
  countRound(snapshot, round);
  return snapshot;
}

/** Snapshot only affected rows; each match is tallied once even with many evaluation rounds. */
function tallySnapshots(pod: Pod, rounds: readonly Round[]): Map<number, Map<string, Tally>> {
  let current = new Map<string, Tally>();
  for (const id of pod.playerIds) {
    tallyFor(current, id);
  }
  const records = new Map([[0, current]]);
  for (const round of rounds) {
    current = snapshotRound(current, round);
    records.set(round.number, current);
  }
  return records;
}

function recordedRoundHistory(rounds: readonly Round[]): Map<string, number[]> {
  const history = new Map<string, number[]>();
  for (const round of rounds) {
    const ids = round.matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
    for (const id of ids) {
      history.set(id, [...(history.get(id) ?? []), round.number]);
    }
  }
  return history;
}

/** A missing round falls back to the latest recorded match, including later elimination matches. */
function percentageLookup(pod: Pod, byId: ReadonlyMap<string, Player>, options: StandingsOptions) {
  const rounds = pod.rounds
    .filter(r => r.number <= (options.throughRound ?? Infinity))
    .sort((a, b) => a.number - b.number);
  const records = tallySnapshots(pod, rounds);
  const history = recordedRoundHistory(rounds);
  const chosenRound = (id: string, at: number): number => {
    const recorded = history.get(id) ?? [];
    return recorded.includes(at) ? at : (recorded.at(-1) ?? 0);
  };
  const tallyAt = (id: string, at: number): Tally => {
    return tallyFor(records.get(at) ?? records.get(0)!, id);
  };
  const own = (id: string, at: number): number => {
    const player = byId.get(id);
    const capped =
      (player?.droppedAfter ?? null) !== null &&
      (history.get(id)?.length ?? 0) < (player?.scheduledSwissRounds ?? plannedRounds(pod, options));
    return winRate(tallyAt(id, chosenRound(id, at)), capped);
  };
  const rates = new Map<string, number>();
  const owp = (id: string, at: number): number => {
    const chosen = chosenRound(id, at);
    const key = `${id}:${chosen}`;
    if (!rates.has(key)) {
      const tally = tallyAt(id, chosen);
      const opponents = new Map(tally.opponents.map(opponent => [opponent, own(opponent, chosen)]));
      rates.set(key, opponentAverage(tally.opponents, opponents, tally.assignedByes));
    }
    return rates.get(key)!;
  };
  const percentages = (id: string, at: number): Tiebreakers => {
    const chosen = chosenRound(id, at);
    const tally = tallyAt(id, chosen);
    const opponents = new Map(tally.opponents.map(opponent => [opponent, owp(opponent, chosen)]));
    return { owp: owp(id, chosen), oowp: opponentAverage(tally.opponents, opponents) };
  };
  return { percentages, tallies: records.get(rounds.at(-1)?.number ?? 0)! };
}

export interface StandingsOptions {
  throughRound?: number;
  /** Rank only these players (one division of a combined pod); everyone still counts as an opponent. */
  only?: ReadonlySet<string>;
  /** Include disqualified players when explicitly requested by a staff view. */
  withDisqualified?: boolean;
  /** The Swiss rounds the pod plans (see regularRounds in rounds.ts); defaults to the rounds paired. */
  regularRounds?: number;
  /** PAIRING V22-1: players ranked with no match points and 0% averages, whose matches still count for others. */
  noRecord?: ReadonlySet<string>;
}

function evaluationRound(pod: Pod, options: StandingsOptions): number {
  const through = options.throughRound ?? Infinity;
  return Number.isFinite(through)
    ? through
    : Math.max(0, ...pod.rounds.filter(r => r.kind === 'swiss').map(r => r.number));
}

/** The pod's Swiss standings, best first. */
export function swissStandings(saved: Pod, players: readonly Player[], options: StandingsOptions = {}): Standing[] {
  const pod = withUnsavedByes(saved);
  const byId = new Map(players.map(player => [player.id, player]));
  const dropped = (id: string) => (byId.get(id)?.droppedAfter ?? null) !== null;
  const { percentages, tallies } = percentageLookup(pod, byId, options);
  const at = evaluationRound(pod, options);
  // A disqualified player leaves the standings; their matches still count for their opponents.
  const rows: Row[] = [];
  for (const [id, tally] of tallies) {
    if (!ranked(id, byId, options)) {
      continue;
    }
    const lost = options.noRecord?.has(id) === true;
    const rates = lost ? { owp: 0, oowp: 0 } : percentages(id, at);
    rows.push({
      playerId: id,
      record: tally.record,
      points: lost ? 0 : matchPoints(tally.record),
      ...rates,
      dropped: dropped(id),
      late: byId.get(id)?.late === true
    });
  }
  const order = new Map(players.map((player, i) => [player.id, player.tiebreaker ?? i + 1]));
  // Entrants share one preference; those still exactly tied keep their entry order, which is roster order.
  const index = new Map(players.map((player, i) => [player.id, i]));
  const rosterOrder = (a: Row, b: Row) =>
    (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0) ||
    (index.get(a.playerId) ?? 0) - (index.get(b.playerId) ?? 0);
  return rows
    .sort(rosterOrder)
    .sort(compareStandings(order, tallies))
    .map((row, i) => ({ ...row, place: i + 1 }));
}

/**
 * PAIRING V18-2: an assigned bye of a failed pairing attempt counts until the file is reopened, as a further
 * assigned bye of the round that was being paired.
 */
function withUnsavedByes(pod: Pod): Pod {
  if (!pod.unsavedByes?.length) {
    return pod;
  }
  return {
    ...pod,
    rounds: pod.rounds.map(round => {
      const byes = pod.unsavedByes!.filter(bye => bye.round === round.number && round.kind === 'swiss');
      const matches = byes.map(bye => ({
        p1: bye.playerId,
        p2: null,
        outcome: 'assigned-bye' as const,
        table: 0,
        timestamp: ''
      }));
      return byes.length ? { ...round, matches: [...round.matches, ...matches] } : round;
    })
  };
}

/** Winner and loser of a decided elimination match, or null while it is open. */
export function eliminationResult(match: Match): { winner: string; loser: string | null } | null {
  if (match.outcome === 'bye' || match.outcome === 'assigned-bye' || (match.outcome === 'p1' && match.p2 === null)) {
    return { winner: match.p1, loser: null };
  }
  if (match.outcome === 'p1') {
    return { winner: match.p1, loser: match.p2 };
  }
  if (match.outcome === 'p2' && match.p2 !== null) {
    return { winner: match.p2, loser: match.p1 };
  }
  return null;
}

/**
 * The match for third place in a top cut that plays one: in the final's
 * round, between the two players the semifinals knocked out.
 */
export function thirdPlaceMatch(pod: Pod, round: Round): Match | undefined {
  const semis = pod.rounds.find(r => r.number === round.number - 1);
  const pairs = round.matches.filter(m => m.p2 !== null);
  if (round.kind !== 'elimination' || pairs.length !== 2 || semis?.kind !== 'elimination') {
    return undefined;
  }
  const previous = semis.matches.filter(m => m.p2 !== null);
  if (previous.length !== 2) {
    return undefined;
  }
  const out = new Set(previous.map(match => eliminationResult(match)?.loser));
  return (
    pairs.find(match => out.has(match.p1) && out.has(match.p2)) ??
    (pendingPlayoff(pod, round, previous) ? pairs.at(-1) : undefined)
  );
}

function pendingPlayoff(pod: Pod, round: Round, previous: Match[]): boolean {
  const played = pod.rounds.filter(r => r.kind === 'elimination' && r.number <= round.number).length;
  const required = Math.ceil(Math.log2(pod.cut || pod.playerIds.length));
  return Boolean(pod.playoff3rd4th && played >= required && previous.some(m => m.outcome === 'pending'));
}

/** A top-cut round's bracket: every match but a third-place one. */
export function bracketMatches(pod: Pod, round: Round): Match[] {
  const playoff = thirdPlaceMatch(pod, round);
  return round.matches.filter(match => match !== playoff);
}

function registerEliminationMatch(tallies: Map<string, Tally>, match: Match): void {
  const first = tallyFor(tallies, match.p1);
  if (match.p2 === null) {
    return;
  }
  const second = tallyFor(tallies, match.p2);
  if (match.outcome === 'pending') {
    first.opponents.push(match.p2);
    second.opponents.push(match.p1);
  }
}

/** Elimination records include every bye win and retain the most recent opponent. */
function eliminationTallies(pod: Pod): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  // V19-3: a repaired opening round is no player's history until the file is reopened.
  for (const round of pod.rounds.filter(r => r.kind === 'elimination' && r.number !== pod.historyOmittedRound)) {
    round.matches.forEach(match => registerEliminationMatch(tallies, match));
    countRound(tallies, round);
  }
  for (const [id, tally] of tallies) {
    if (!tally.opponents.length) {
      const last = pod.rounds
        .filter(r => r.kind === 'swiss')
        .flatMap(r => r.matches)
        .filter(m => m.p2 !== null && (m.p1 === id || m.p2 === id))
        .at(-1);
      if (last) {
        tally.opponents.push(last.p1 === id ? last.p2! : last.p1);
      }
    }
  }
  return tallies;
}

function thirdPlaceComparison(tallies: ReadonlyMap<string, Tally>, a: Tally, b: Tally, rounds: number): number {
  const qualifies = (tally: Tally) => tally.record.losses === 1 && tally.record.wins >= rounds - 1;
  if (!qualifies(a) && !qualifies(b)) {
    return 0;
  }
  const unbeatenOpponent = (tally: Tally) => {
    const opponent = tally.opponents.at(-1);
    if (opponent === undefined) {
      throw new Error('Standings cannot be saved: a third-place comparison has no previous opponent');
    }
    return (tallies.get(opponent)?.record.losses ?? 0) === 0;
  };
  return Number(unbeatenOpponent(b)) - Number(unbeatenOpponent(a));
}

interface FinalsContext {
  players: readonly Player[];
  swissPod: Pod;
  regularRounds: number;
  /** SPEC V24-5: groups with a recorded order, placed afterwards without the third-place setting comparison. */
  recordedGroups?: readonly (readonly string[])[];
}

const thirdPlaceRounds = (pod: Pod) => (pod.cutOf || pod.rounds.some(r => r.kind === 'swiss') ? Math.log2(pod.cut) : 0);

/**
 * SPEC V24-5: equal-win groups the third-place setting comparison cannot order: a member without any two-player
 * match beside a member meeting its requirement, or two members whose latest two-player opponents have no
 * elimination loss, one of them meeting the requirement.
 */
export function undecidedThirdPlaceGroups(pod: Pod, swiss: readonly Standing[], swissPod: Pod = pod): string[][] {
  if (!pod.playoff3rd4th) {
    return [];
  }
  const tallies = eliminationTallies(swissPod);
  const rounds = thirdPlaceRounds(pod);
  const groups = new Map<number, Tally[]>();
  for (const row of swiss) {
    const tally = tallies.get(row.playerId);
    if (tally) {
      groups.set(tally.record.wins, [...(groups.get(tally.record.wins) ?? []), tally]);
    }
  }
  const qualifies = (tally: Tally) => tally.record.losses === 1 && tally.record.wins >= rounds - 1;
  const unbeaten = (tally: Tally) =>
    tally.opponents.length > 0 && (tallies.get(tally.opponents.at(-1)!)?.record.losses ?? 0) === 0;
  return [...groups.values()]
    .filter(group => {
      const unmatched = group.some(tally => !tally.opponents.length) && group.some(qualifies);
      const twoUnbeaten = group.filter(unbeaten);
      return unmatched || (twoUnbeaten.length >= 2 && twoUnbeaten.some(qualifies));
    })
    .map(group => swiss.map(row => row.playerId).filter(id => group.includes(tallies.get(id)!)));
}

/** The standing at the last Swiss round before the first cut; match history still includes every round. */
function cutStandingPod(pod: Pod): Pod {
  const firstCut = pod.rounds.find(r => r.kind === 'elimination')?.number ?? Infinity;
  return { ...pod, rounds: pod.rounds.filter(r => r.kind !== 'swiss' || r.number < firstCut) };
}

/** An opponent comparison is reached only after all earlier Swiss comparisons tie. */
function repairedOpponentComparison(
  pod: Pod,
  players: readonly Player[],
  rows: readonly Standing[],
  regularRounds?: number
) {
  if (!pod.cutOf && !pod.rounds.some(r => r.kind === 'swiss')) {
    return () => false;
  }
  const standing = cutStandingPod(pod);
  const swiss = players.length ? swissStandings(standing, players, { withDisqualified: true, regularRounds }) : rows;
  const byId = new Map(swiss.map(row => [row.playerId, row]));
  const compare = compareStandings(new Map(), tallySwiss(standing));
  return (a: string, b: string) => compare(byId.get(a)!, byId.get(b)!) === 0;
}

/** V25-2: the checkpoint orders only whole equal-win groups involving a dissolved latest opponent. */
export function repairedEliminationGroups(
  pod: Pod,
  swiss: readonly Standing[],
  full: Pod = pod,
  context: { players?: readonly Player[]; regularRounds?: number } = {}
): string[][] {
  if (!full.dissolvedOpponents?.length) {
    return [];
  }
  const history = matchOpponents(full);
  const latest = new Map([...history].map(([id, matches]) => [id, matches.filter(m => m !== null).at(-1)]));
  const affected = new Set<string>();
  for (const entry of full.dissolvedOpponents ?? []) {
    const replaced = full.rounds.some(
      r =>
        r.number >= entry.round &&
        r.matches.some(m => m.p2 !== null && (m.p1 === entry.playerId || m.p2 === entry.playerId))
    );
    if (!replaced) {
      affected.add(entry.playerId);
      latest.set(entry.playerId, entry.opponentId);
    }
  }
  const tallies = eliminationTallies(full);
  const groups = new Map<number, string[]>();
  for (const row of swiss) {
    const tally = tallies.get(row.playerId);
    if (tally) {
      groups.set(tally.record.wins, [...(groups.get(tally.record.wins) ?? []), row.playerId]);
    }
  }
  const qualifies = (id: string) => {
    const { record } = tallies.get(id)!;
    return pod.playoff3rd4th && record.losses === 1 && record.wins >= thirdPlaceRounds(pod) - 1;
  };
  const reached = repairedOpponentComparison(full, context.players ?? [], swiss, context.regularRounds);
  const involves = (a: string, b: string) =>
    qualifies(a) ||
    qualifies(b) ||
    (reached(a, b) &&
      latest.get(a) !== undefined &&
      latest.get(b) !== undefined &&
      !(latest.get(a) === b && latest.get(b) === a));
  return [...groups.values()].filter(group =>
    group.some(a => affected.has(a) && group.some(b => a !== b && involves(a, b)))
  );
}

/** Recorded matches use personal match numbers, including one-seat matches. */
function matchOpponents(pod: Pod): Map<string, (string | null)[]> {
  const history = new Map<string, (string | null)[]>();
  const append = (id: string, opponent: string | null) => {
    const matches = history.get(id) ?? [];
    matches.push(opponent);
    history.set(id, matches);
  };
  for (const round of [...pod.rounds].sort((a, b) => a.number - b.number)) {
    for (const match of round.matches) {
      append(match.p1, match.p2);
      if (match.p2 !== null) {
        append(match.p2, match.p1);
      }
    }
  }
  return history;
}

function compareOpponents(
  first: readonly (string | null)[],
  second: readonly (string | null)[],
  compare: (a: string, b: string) => number
): number {
  for (let i = Math.min(first.length, second.length) - 1; i >= 0; i--) {
    const a = first[i]!;
    const b = second[i]!;
    const difference = a !== null && b !== null ? compare(a, b) : Number(b !== null) - Number(a !== null);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

function cutSwissComparison(pod: Pod, swiss: readonly Standing[], context?: FinalsContext) {
  const saved = context?.swissPod ?? pod;
  const full = cutStandingPod(saved);
  const tallies = tallySwiss(full);
  const beforePreference = compareStandings(new Map(), tallies);
  const opponents = context
    ? swissStandings(full, context.players, { regularRounds: context.regularRounds, withDisqualified: true })
    : swiss;
  const rows = new Map(opponents.map(row => [row.playerId, row]));
  const order = context
    ? new Map(context.players.map((player, i) => [player.id, player.tiebreaker ?? i + 1]))
    : new Map(swiss.map(row => [row.playerId, row.place]));
  const compare = compareStandings(order, tallies);
  const history = matchOpponents(saved);
  const opponentOrder = (a: string, b: string) => compare(rows.get(a)!, rows.get(b)!);
  return (a: Standing, b: Standing): number =>
    beforePreference(rows.get(a.playerId) ?? a, rows.get(b.playerId) ?? b) ||
    (opponentsApply(history, a.playerId, b.playerId)
      ? compareOpponents(history.get(a.playerId) ?? [], history.get(b.playerId) ?? [], opponentOrder)
      : 0) ||
    compare(rows.get(a.playerId) ?? a, rows.get(b.playerId) ?? b);
}

/**
 * SPEC V24-8: the opponent comparison needs a two-player match for both players, pending ones counted, and does
 * not apply to two players who are each other's latest two-player opponent.
 */
function opponentsApply(history: ReadonlyMap<string, (string | null)[]>, a: string, b: string): boolean {
  const latest = (id: string) => (history.get(id) ?? []).filter(opponent => opponent !== null).at(-1);
  const [first, second] = [latest(a), latest(b)];
  return first !== undefined && second !== undefined && !(first === b && second === a);
}

/** Equal cut wins compare Swiss records, then match opponents, then final tie preference. */
export function placeFinals(pod: Pod, swiss: readonly Standing[], context?: FinalsContext): Standing[] {
  const tallies = eliminationTallies(context?.swissPod ?? pod);
  const afterSwiss = Boolean(pod.cutOf || pod.rounds.some(r => r.kind === 'swiss'));
  const rounds = thirdPlaceRounds(pod);
  const recorded = (a: string, b: string) =>
    Boolean(context?.recordedGroups?.some(g => g.includes(a) && g.includes(b)));
  const preferences = new Map(context?.players.map((p, i) => [p.id, p.tiebreaker ?? i + 1]));
  const compareSwiss = afterSwiss
    ? cutSwissComparison(pod, swiss, context)
    : (a: Standing, b: Standing) =>
        Number(a.late) - Number(b.late) ||
        (preferences.get(a.playerId) ?? a.place) - (preferences.get(b.playerId) ?? b.place);
  const compare = (a: Standing, b: Standing): number => {
    const first = tallies.get(a.playerId);
    const second = tallies.get(b.playerId);
    if (!first || !second) {
      return Number(Boolean(second)) - Number(Boolean(first)) || a.place - b.place;
    }
    if (second.record.wins !== first.record.wins) {
      return second.record.wins - first.record.wins;
    }
    const third =
      pod.playoff3rd4th && !recorded(a.playerId, b.playerId) ? thirdPlaceComparison(tallies, first, second, rounds) : 0;
    return second.record.wins - first.record.wins || third || compareSwiss(a, b);
  };
  return [...swiss].sort(compare).map((row, i) => ({ ...row, place: i + 1 }));
}

export function recordLabel(record: MatchRecord): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

export function percentLabel(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * SPEC V24-9: Swiss rows equal on every comparison before head-to-head whose head-to-head and final tie
 * preference do not give a consistent order: some pair of the sorted group is out of that order.
 */
export function headToHeadCycles(pod: Pod, players: readonly Player[], rows: readonly Standing[]): string[][] {
  const tallies = tallySwiss(pod);
  const preference = new Map(players.map((player, i) => [player.id, player.tiebreaker ?? i + 1]));
  const ahead = (a: Standing, b: Standing) =>
    (tallies.get(a.playerId)?.headToHead.get(b.playerId) ?? 0) > 0 ||
    ((tallies.get(a.playerId)?.headToHead.get(b.playerId) ?? 0) === 0 &&
      (preference.get(a.playerId) ?? 0) <= (preference.get(b.playerId) ?? 0));
  const groups: Standing[][] = [];
  for (const row of rows) {
    const group = groups.at(-1);
    const first = group?.[0];
    const equal =
      first &&
      row.points === first.points &&
      row.late === first.late &&
      row.owp === first.owp &&
      row.oowp === first.oowp;
    if (equal) {
      group.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups
    .filter(group => group.some((a, i) => group.slice(i + 1).some(b => !ahead(a, b))))
    .map(group => group.map(row => row.playerId));
}

/** Only a whole equal-win group with an eligible third-place or repair choice can take a recorded order. */
export function orderEliminationGroups(pod: Pod, rows: Standing[], groups: readonly (readonly string[])[]): Standing[] {
  const tallies = eliminationTallies(pod);
  return groups.reduce((ordered, group) => {
    const members = ordered.filter(row => group.includes(row.playerId));
    if (
      (!pod.playoff3rd4th && !pod.dissolvedOpponents?.length) ||
      group.length < 2 ||
      new Set(group).size !== group.length ||
      members.length !== group.length
    ) {
      throw new Error(
        'A recorded elimination tie requires distinct finished players and the third-place setting or a repair comparison'
      );
    }
    const wins = tallies.get(group[0]!)?.record.wins;
    const equal = ordered.filter(row => tallies.get(row.playerId)?.record.wins === wins);
    if (wins === undefined || equal.length !== group.length || equal.some(row => !group.includes(row.playerId))) {
      throw new Error('A recorded elimination tie must cover a whole equal-win group');
    }
    return placeRecordedGroup(ordered, group);
  }, rows);
}

function placeRecordedGroup(rows: Standing[], group: readonly string[]): Standing[] {
  const positions = rows.flatMap((row, index) => (group.includes(row.playerId) ? [index] : []));
  const byId = new Map(rows.map(row => [row.playerId, row]));
  const result = [...rows];
  for (const [index, id] of group.entries()) {
    const position = positions[index]!;
    result[position] = { ...byId.get(id)!, place: rows[position]!.place };
  }
  return result;
}

/** Whether the players are level on every comparison before head-to-head. */
export function equalBeforeHeadToHead(rows: readonly Standing[], ids: readonly string[]): boolean {
  const members = rows.filter(row => ids.includes(row.playerId));
  const [first] = members;
  return members.every(
    row =>
      row.points === first!.points && row.late === first!.late && row.owp === first!.owp && row.oowp === first!.oowp
  );
}

/** A recorded cycle changes only its group's computed places, never other standings. */
export function orderHeadToHeadGroups(rows: Standing[], groups: readonly (readonly string[])[]): Standing[] {
  let ordered = rows;
  for (const group of groups) {
    ordered = orderHeadToHeadGroup(ordered, group);
  }
  return ordered;
}

function orderHeadToHeadGroup(rows: Standing[], group: readonly string[]): Standing[] {
  const members = rows.filter(row => group.includes(row.playerId));
  if (group.length < 3 || new Set(group).size !== group.length || members.length !== group.length) {
    throw new Error('A recorded head-to-head cycle requires at least three distinct finished players');
  }
  const first = members[0]!;
  if (
    members.some(
      row => row.points !== first.points || row.late !== first.late || row.owp !== first.owp || row.oowp !== first.oowp
    )
  ) {
    throw new Error('A recorded head-to-head cycle cannot override earlier standings comparisons');
  }
  const positions = rows.flatMap((row, index) => (group.includes(row.playerId) ? [index] : []));
  if (positions.at(-1)! - positions[0]! + 1 !== group.length) {
    throw new Error('A recorded head-to-head cycle must occupy consecutive places');
  }
  return placeRecordedGroup(rows, group);
}
