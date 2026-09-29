/**
 * What the tournament pages derive from a tournament document: names by ID,
 * the current round, standings per division, a player's match history, the
 * clock, and the deck breakdown. Pure, so the organizer's page and the
 * public one show the same thing from the same data.
 */

import { secondsLeft } from '../../../shared/tournament/commands';
import {
  isDisputed,
  isLocked,
  type PlayerReport,
  type PlayerResult,
  reportsFor
} from '../../../shared/tournament/reports';
import { divisionFor, parseTomDate, seasonOf } from '../../../shared/tournament/divisions';
import {
  eliminationResult,
  percentLabel,
  placeFinals,
  recordLabel,
  sideResult,
  type Standing,
  swissStandings,
  tallySwiss
} from '../../../shared/tournament/standings';
import {
  type Division,
  DIVISION_LABELS,
  DIVISIONS,
  type Match,
  type Outcome,
  playerName,
  type Pod,
  type Round,
  type Tournament
} from '../../../shared/tournament/types';
import { decksEnabled, type PendingResult, type TournamentSettings } from '../../../shared/tournament/view';

export function namesById(tournament: Tournament): Map<string, string> {
  return new Map(tournament.players.map(player => [player.id, playerName(player)]));
}

export function currentRound(pod: Pod | undefined): Round | undefined {
  return pod?.rounds.at(-1);
}

const CUT_ROUND_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semifinals', 8: 'Quarterfinals' };

export function roundLabel(round: Round): string {
  if (round.kind === 'swiss') {
    return `Round ${round.number}`;
  }
  const remaining = round.matches.length * 2;
  return CUT_ROUND_NAMES[remaining] ?? `Top ${remaining}`;
}

/** The winner of a finished final, or null while the event is still going. */
export function champion(round: Round | undefined): string | null {
  if (round?.kind !== 'elimination' || round.matches.length !== 1) {
    return null;
  }
  const [final] = round.matches;
  return final ? (eliminationResult(final)?.winner ?? null) : null;
}

/** Where a pod's current round stands: how many tables are still playing, and any champion. */
export interface PodProgress {
  round: Round | undefined;
  /** Tables with two players, byes and missed rounds aside. */
  tables: number;
  /** Of those, the ones with no result yet (a result entered on the site counts). */
  open: number;
  champion: string | null;
}

export function podProgress(pod: Pod, pending: readonly PendingResult[]): PodProgress {
  const round = currentRound(pod);
  const played = round?.matches.filter(m => m.p2 !== null) ?? [];
  const open = round ? played.filter(m => shownOutcome(m, pod, round, pending).outcome === 'pending').length : 0;
  return { round, tables: played.length, open, champion: champion(round) };
}

const tablesWord = (n: number, kind: Round['kind']) =>
  kind === 'elimination' ? (n === 1 ? 'match' : 'matches') : n === 1 ? 'table' : 'tables';

/** The name of the stage a finished cut round leads to: "semifinals", "the final". */
function nextStageName(round: Round): string {
  const name = CUT_ROUND_NAMES[round.matches.length] ?? `top ${round.matches.length}`;
  return name === 'Final' ? 'the final' : name.toLowerCase();
}

/**
 * The one step the console offers next, the same on every tab: pair the next
 * round or stage (disabled, with the reason, while tables are still open), or
 * close the event once the final has a champion.
 */
export type NextStep =
  | { kind: 'pair'; label: string; ready: boolean; reason?: string }
  | { kind: 'close'; champion: string }
  | { kind: 'none' };

export function nextStep(progress: PodProgress, finished: boolean): NextStep {
  const { round, open, champion: winner } = progress;
  if (finished) {
    return { kind: 'none' };
  }
  if (winner) {
    return { kind: 'close', champion: winner };
  }
  if (!round) {
    return { kind: 'pair', label: 'Pair round 1', ready: true };
  }
  const label = round.kind === 'swiss' ? `Pair round ${round.number + 1}` : `Pair ${nextStageName(round)}`;
  return open > 0
    ? { kind: 'pair', label, ready: false, reason: `${open} ${tablesWord(open, round.kind)} open` }
    : { kind: 'pair', label, ready: true };
}

/** The status sentence's parts: the round, what is happening in it, and the clock when it runs. */
export function statusParts(progress: PodProgress, finished: boolean, clock: string | null): string[] {
  const { round, open, tables } = progress;
  if (finished) {
    return ['Finished'];
  }
  if (!round) {
    return ['Registration'];
  }
  if (progress.champion) {
    return [roundLabel(round), 'final played'];
  }
  const doing =
    open === 0
      ? `all ${tables} ${tablesWord(tables, round.kind)} in`
      : `${open} ${tablesWord(open, round.kind)} playing`;
  return [roundLabel(round), doing, ...(open > 0 && clock ? [`${clock} left`] : [])];
}

export const STATUS_LABELS: Record<Round['status'], string> = {
  paired: 'Paired',
  started: 'In progress',
  finished: 'Complete'
};

/** The outcome shown for a match: TOM's, or a pending one entered on the site. */
export function shownOutcome(
  match: Match,
  pod: Pod,
  round: Round,
  pending: readonly PendingResult[]
): { outcome: Outcome; unconfirmed: boolean } {
  if (match.outcome !== 'pending') {
    return { outcome: match.outcome, unconfirmed: false };
  }
  const entered = pending.find(
    p => p.pod === pod.category && p.round === round.number && p.table === match.table && p.p1 === match.p1
  );
  return entered ? { outcome: entered.outcome, unconfirmed: true } : { outcome: 'pending', unconfirmed: false };
}

/** W, L or T for one seat of a decided match; '' while open. */
export function seatMark(outcome: Outcome, seat: 1 | 2): string {
  const side = sideResult(outcome, seat);
  return side === 'win' ? 'W' : side === 'loss' ? 'L' : side === 'tie' ? 'T' : '';
}

export interface DivisionStandings {
  division: Division | null;
  rows: Standing[];
}

/**
 * A pod's standings. A pod of one division is one table; a combined pod is
 * ranked per division, since each division keeps its own standings and cut.
 */
export function podStandings(
  tournament: Tournament,
  pod: Pod,
  divisionOf: (id: string) => Division
): DivisionStandings[] {
  if ((DIVISIONS as readonly string[]).includes(pod.category)) {
    return [{ division: null, rows: placeFinals(pod, swissStandings(pod, tournament.players)) }];
  }
  return DIVISIONS.flatMap(division => {
    const only = new Set(pod.playerIds.filter(id => divisionOf(id) === division));
    return only.size ? [{ division, rows: placeFinals(pod, swissStandings(pod, tournament.players, { only })) }] : [];
  });
}

export function divisionHeading(division: Division | null): string {
  return division ? DIVISION_LABELS[division] : '';
}

export interface HistoryRow {
  round: number;
  kind: Round['kind'];
  table: number;
  opponent: string | null;
  mark: string;
  outcome: Outcome;
}

/** One player's matches, round by round. */
export function matchHistory(pod: Pod, playerId: string): HistoryRow[] {
  return pod.rounds.flatMap(round => {
    const match = round.matches.find(m => m.p1 === playerId || m.p2 === playerId);
    if (!match) {
      return [];
    }
    const seat = match.p1 === playerId ? 1 : 2;
    return [
      {
        round: round.number,
        kind: round.kind,
        table: match.table,
        opponent: seat === 1 ? match.p2 : match.p1,
        mark: seatMark(match.outcome, seat),
        outcome: match.outcome
      }
    ];
  });
}

/** The pod and match a player is in this round, if any. */
export function currentMatchOf(
  tournament: Tournament,
  playerId: string
): { pod: Pod; round: Round; match: Match } | null {
  for (const pod of tournament.pods) {
    const round = currentRound(pod);
    const match = round?.matches.find(m => m.p1 === playerId || m.p2 === playerId);
    if (round && match) {
      return { pod, round, match };
    }
  }
  return null;
}

/** m:ss, with a minus once time is up. */
export function clockLabel(round: Round, now: number): string {
  const left = secondsLeft(round, now);
  const sign = left < 0 ? '-' : '';
  const abs = Math.abs(left);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

export interface DeckShare {
  label: string;
  players: number;
  /** Decided matches the deck played, byes and missed rounds aside. */
  matches: number;
  /** Match win rate over those matches, ties counting half; null with none played. */
  winRate: number | null;
}

interface DeckRecord {
  won: number;
  played: number;
}

/** A decided match between two players counts for each side's deck; byes and missed rounds do not. */
function countSeat(match: Match, seat: 1 | 2, decks: Record<string, string>, tally: Map<string, DeckRecord>) {
  const id = seat === 1 ? match.p1 : match.p2;
  const label = id ? decks[id] : undefined;
  const side = sideResult(match.outcome, seat);
  if (!label || side === null || match.p2 === null) {
    return;
  }
  const entry = tally.get(label) ?? { won: 0, played: 0 };
  entry.played += 1;
  entry.won += side === 'win' ? 1 : side === 'tie' ? 0.5 : 0;
  tally.set(label, entry);
}

function deckTally(pod: Pod, decks: Record<string, string>, tally: Map<string, DeckRecord>) {
  for (const match of pod.rounds.flatMap(round => round.matches)) {
    countSeat(match, 1, decks, tally);
    countSeat(match, 2, decks, tally);
  }
}

/** How many players are on each archetype and how it has done, most played first. */
export function deckBreakdown(tournament: Tournament, decks: Record<string, string>): DeckShare[] {
  const counts = new Map<string, number>();
  for (const player of tournament.players) {
    const label = decks[player.id];
    if (label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const tally = new Map<string, DeckRecord>();
  for (const pod of tournament.pods) {
    deckTally(pod, decks, tally);
  }
  return [...counts]
    .map(([label, players]) => {
      const record = tally.get(label);
      const played = record?.played ?? 0;
      return { label, players, matches: played, winRate: record && played > 0 ? record.won / played : null };
    })
    .sort((a, b) => b.players - a.players || a.label.localeCompare(b.label));
}

/** The recommended Swiss rounds and top cut for a division's attendance (Handbook §5.5.6.1, League Cup). */
export function recommendedStructure(players: number): { rounds: number; cut: number } {
  const table: [number, number, number][] = [
    [8, 3, 0],
    [12, 4, 4],
    [20, 5, 4],
    [32, 5, 8],
    [64, 6, 8],
    [128, 7, 8],
    [226, 8, 8],
    [409, 9, 8]
  ];
  const row = table.find(([max]) => players <= max);
  return row ? { rounds: row[1], cut: row[2] } : { rounds: 10, cut: 8 };
}

/** Matches whose players' names contain the query, in either seat. */
export function filterMatches(matches: readonly Match[], names: Map<string, string>, query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...matches];
  }
  const hit = (id: string | null) => (id ? (names.get(id) ?? '').toLowerCase().includes(q) : false);
  return matches.filter(match => hit(match.p1) || hit(match.p2));
}

/** Each player's record going into `round`, as W-L-T. */
export function recordsBefore(pod: Pod, round: Round): Map<string, string> {
  const tallies = tallySwiss(pod, round.number - 1);
  return new Map([...tallies].map(([id, tally]) => [id, recordLabel(tally.record)]));
}

/**
 * Active players in the pod with no real seat in its current Swiss round: a
 * late arrival whose only entry is the missed-round loss, or someone added
 * after pairing. Re-pairing the round seats them.
 */
export function unseated(tournament: Tournament, pod: Pod): string[] {
  const round = currentRound(pod);
  if (!round || round.kind !== 'swiss') {
    return [];
  }
  const seated = new Set(
    round.matches.filter(m => m.outcome !== 'loss').flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))
  );
  const dropped = new Set(tournament.players.filter(p => p.droppedAfter !== null).map(p => p.id));
  return pod.playerIds.filter(id => !seated.has(id) && !dropped.has(id));
}

/** Each player's age division for the event's season, from the birth dates staff can see. */
export function divisionLookup(tournament: Tournament): (id: string) => Division {
  const season = seasonOf(parseTomDate(tournament.info.startDate) ?? new Date());
  const births = new Map(tournament.players.map(p => [p.id, p.birthDate]));
  return id => divisionFor(births.get(id) ?? '', season);
}

/** The archetypes to draw beside names: none when the event has them off. */
export function shownDecks(manage: { decks: Record<string, string>; settings: TournamentSettings }) {
  return decksEnabled(manage.settings) ? manage.decks : {};
}

export interface ReportState {
  /** How the match went for the player, by their own report or the result that stands. */
  chosen: PlayerResult | null;
  /** Their report and their opponent's say different things. */
  disputed: boolean;
  /** Their report can no longer be changed from the page. */
  locked: boolean;
  /** The result stands: entered by staff, or reported alike by both and locked. */
  final: boolean;
}

const asResult = (outcome: Outcome, seat: 1 | 2): PlayerResult => sideResult(outcome, seat) ?? 'loss';

/** Where a player's own report of their match stands at `now` (see shared/tournament/reports.ts). */
export function reportState(
  at: { pod: Pod; round: Round; match: Match },
  event: { pending: readonly PendingResult[]; reports: readonly PlayerReport[] },
  me: string,
  now: number
): ReportState {
  const { pod, round, match } = at;
  const { pending, reports } = event;
  const seat = match.p1 === me ? 1 : 2;
  const shown = shownOutcome(match, pod, round, pending).outcome;
  if (shown !== 'pending') {
    return { chosen: asResult(shown, seat), disputed: false, locked: true, final: true };
  }
  const forMatch = reportsFor(reports, pod.category, round.number, match);
  const mine = forMatch.find(report => report.by === me);
  const theirs = forMatch.find(report => report.by !== me);
  if (!mine) {
    return { chosen: null, disputed: false, locked: false, final: false };
  }
  const locked = isLocked(mine, now);
  const agreed = theirs?.outcome === mine.outcome && locked && isLocked(theirs, now);
  return { chosen: asResult(mine.outcome, seat), disputed: isDisputed(forMatch), locked, final: agreed };
}

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10];
  return `${n}${suffix ?? 'th'}`;
};

/** What put the last player in above the first one out: points, then OWP, then OOWP. */
export function cutSplit(rows: readonly Standing[], cut: number): string | null {
  const inside = rows[cut - 1];
  const outside = rows[cut];
  if (!inside || !outside) {
    return null;
  }
  const lead = `${ordinal(cut)} and ${ordinal(cut + 1)} split on`;
  if (inside.points !== outside.points) {
    return `${lead} points: ${inside.points} / ${outside.points}`;
  }
  if (inside.owp !== outside.owp) {
    return `${lead} OWP: ${percentLabel(inside.owp)} / ${percentLabel(outside.owp)}`;
  }
  return `${lead} OOWP: ${percentLabel(inside.oowp)} / ${percentLabel(outside.oowp)}`;
}
