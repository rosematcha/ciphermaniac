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
  oneDevice,
  type PlayerReport,
  type PlayerResult,
  reportsFor,
  settles
} from '../../../shared/tournament/reports';
import {
  bracketMatches,
  eliminationResult,
  percentLabel,
  placeFinals,
  recordLabel,
  sideResult,
  type Standing,
  swissStandings,
  tallySwiss
} from '../../../shared/tournament/standings';
import { attendees, cutPodOf, latestRound, livePods, swissAttendance } from '../../../shared/tournament/rounds';
import { ordinal } from '../format';
import { eventTypeOf, recommendedStructure } from '../../../shared/tournament/structure';
import {
  type Division,
  DIVISION_LABELS,
  DIVISIONS,
  type EventType,
  isDivision,
  type Match,
  type Outcome,
  playerName,
  type Pod,
  POD_LABELS,
  type Round,
  type Tournament
} from '../../../shared/tournament/types';
import {
  decksEnabled,
  type PendingResult,
  type TournamentMode,
  type TournamentSettings
} from '../../../shared/tournament/view';

export function namesById(tournament: Tournament): Map<string, string> {
  return new Map(tournament.players.map(player => [player.id, playerName(player)]));
}

const CUT_ROUND_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semifinals', 8: 'Quarterfinals' };

/** A top-cut stage by the players still in it: Final, Semifinals, Quarterfinals, then Top 16 and up. */
export const cutStageLabel = (players: number): string => CUT_ROUND_NAMES[players] ?? `Top ${players}`;

/** Whether a pod has played into a top cut, so its matches can be shown as a bracket. */
export const hasCut = (pod: Pod | undefined): boolean => pod?.rounds.some(r => r.kind === 'elimination') === true;

/** How a top cut's matches are shown: the table every round has, or the bracket. */
export type MatchView = 'table' | 'bracket';

export const MATCH_VIEWS: { value: MatchView; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'bracket', label: 'Bracket' }
];

/** A round's name: its number in Swiss, its stage in a top cut, whose final may also hold the match for third. */
export function roundLabel(round: Round, pod: Pod): string {
  if (round.kind === 'swiss') {
    return `Round ${round.number}`;
  }
  return cutStageLabel(bracketMatches(pod, round).length * 2);
}

/** The winner of a finished final, or null while the event is still going. */
export function champion(round: Round | undefined, pod: Pod): string | null {
  const bracket = round?.kind === 'elimination' ? bracketMatches(pod, round) : [];
  const [final] = bracket;
  return final && bracket.length === 1 ? (eliminationResult(final)?.winner ?? null) : null;
}

/** Where a pod's current round stands: how many tables are still playing, and any champion. */
export interface PodProgress {
  round: Round | undefined;
  /** Tables with two players, byes and missed rounds aside. */
  tables: number;
  /** Of those, the ones with no result yet (a result entered on the site counts). */
  open: number;
  champion: string | null;
  /** The round's name (see roundLabel), and in a top cut, the stage it leads to (see nextStageName). */
  label: string;
  next: string;
}

export function podProgress(pod: Pod, pending: readonly PendingResult[]): PodProgress {
  const round = latestRound(pod);
  const played = round?.matches.filter(m => m.p2 !== null) ?? [];
  const open = round ? played.filter(m => shownOutcome(m, pod, round, pending).outcome === 'pending').length : 0;
  const label = round ? roundLabel(round, pod) : '';
  const next = round?.kind === 'elimination' ? nextStageName(bracketMatches(pod, round).length) : '';
  return { round, tables: played.length, open, champion: champion(round, pod), label, next };
}

const tablesWord = (n: number, kind: Round['kind']) =>
  kind === 'elimination' ? (n === 1 ? 'match' : 'matches') : n === 1 ? 'table' : 'tables';

/** The name of the stage a cut round of `matches` bracket matches leads to: "semifinals", "the final". */
function nextStageName(matches: number): string {
  const name = CUT_ROUND_NAMES[matches] ?? `top ${matches}`;
  return name === 'Final' ? 'the final' : name.toLowerCase();
}

/** The Swiss rounds a pod plans to play, and the top cut to follow them (0 for none). */
export interface SwissPlan {
  rounds: number;
  cut: number;
}

/** A division a pod plays, with its players still in and the top cut its own attendance calls for. */
export interface DivisionCut {
  division: Division;
  active: number;
  /** 0 when the attendance calls for none, or too few are left to fill it. */
  cut: number;
  /** Whether its top cut has started, in a pod of its own (see Pod.cutOf). */
  started: boolean;
}

/**
 * The top cut of each division a pod plays, in division order: Play!
 * Pokémon's cut for that division's attendance (see attendees), and none
 * bigger than the players still in. A pod that plays divisions together still
 * cuts each on its own, by its own attendance (Tournament Rules Handbook
 * §5.2.1; every attendance table counts competitors per age division).
 */
export function divisionCuts(tournament: Tournament, pod: Pod, divisionOf: (id: string) => Division): DivisionCut[] {
  const dropped = new Set(tournament.players.filter(p => p.droppedAfter !== null).map(p => p.id));
  const came = attendees(pod);
  return DIVISIONS.flatMap(division => {
    const ids = pod.playerIds.filter(id => divisionOf(id) === division);
    const active = ids.filter(id => !dropped.has(id)).length;
    const attendance = came.filter(id => divisionOf(id) === division).length;
    const cut = plannedCut(attendance, active, eventTypeOf(tournament));
    const started = cutPodOf(tournament, pod, division) !== undefined;
    return ids.length ? [{ division, active, cut, started }] : [];
  });
}

/** A pod's name on the page: its divisions, or for one division's top cut, that. */
export function podLabel(pod: Pod): string {
  return pod.cutOf ? `${POD_LABELS[pod.category]} top cut` : POD_LABELS[pod.category];
}

/** The round cap a status line counts rounds against: none for a TOM event, whose rounds are TOM's to decide. */
export function roundCapOf(event: { mode: TournamentMode; settings: TournamentSettings }): number | null {
  return event.mode === 'tom' ? null : event.settings.roundCap;
}

/**
 * The Swiss rounds a pod plans: Play! Pokémon's number for its attendance
 * (see swissAttendance), held to the event's cap when it sets one.
 */
export function plannedRounds(pod: Pod, roundCap: number, type: EventType): number {
  const { rounds } = recommendedStructure(swissAttendance(pod), type);
  return roundCap > 0 ? Math.min(roundCap, rounds) : rounds;
}

/**
 * The one step the console offers next, the same on every tab: pair the next
 * round or stage (disabled, with the reason, while tables are still open);
 * once the plan's Swiss rounds are played, decide between the top cut (when
 * the plan has one), another round and ending the event; or end it once the
 * final has a champion (and the match for third, when the cut plays one, a
 * result).
 */
export type NextStep =
  | { kind: 'pair'; label: string; ready: boolean; reason?: string }
  | { kind: 'decide'; label: string; cut: number; ready: boolean; reason?: string }
  | { kind: 'close'; champion: string; ready: boolean; reason?: string }
  | { kind: 'none' };

export function nextStep(progress: PodProgress, finished: boolean, plan: SwissPlan | null = null): NextStep {
  const { round, open, champion: winner } = progress;
  if (finished) {
    return { kind: 'none' };
  }
  if (!round) {
    return { kind: 'pair', label: 'Pair round 1', ready: true };
  }
  const waiting = open > 0 ? { ready: false, reason: `${open} ${tablesWord(open, round.kind)} open` } : { ready: true };
  if (winner) {
    return { kind: 'close', champion: winner, ...waiting };
  }
  const swiss = round.kind === 'swiss';
  const label = swiss ? `Pair round ${round.number + 1}` : `Pair ${progress.next}`;
  return plan && swiss && round.number >= plan.rounds
    ? { kind: 'decide', label, cut: plan.cut, ...waiting }
    : { kind: 'pair', label, ...waiting };
}

/** The status sentence's parts: the round, what is happening in it, and the clock when it runs. */
/** A clock past zero reads as time over rather than a negative time left. */
const timeWords = (clock: string) => (clock.startsWith('-') ? `${clock.slice(1)} over` : `${clock} left`);

/** "Round 2 of 5" while a Swiss round is within the plan's `rounds`; the round's own name past it or without one. */
function roundOf(progress: PodProgress & { round: Round }, rounds: number | null): string {
  const { round } = progress;
  return round.kind === 'swiss' && rounds !== null && round.number <= rounds
    ? `Round ${round.number} of ${rounds}`
    : progress.label;
}

export function statusParts(
  progress: PodProgress,
  finished: boolean,
  clock: string | null,
  rounds: number | null = null
): string[] {
  const { round, open, tables } = progress;
  if (finished) {
    return ['Finished'];
  }
  if (!round) {
    return ['Registration'];
  }
  if (progress.champion && open === 0) {
    return [progress.label, 'final played'];
  }
  const doing =
    open === 0
      ? `all ${tables} ${tablesWord(tables, round.kind)} in`
      : `${open} ${tablesWord(open, round.kind)} playing`;
  return [roundOf({ ...progress, round }, rounds), doing, ...(open > 0 && clock ? [timeWords(clock)] : [])];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Where the event stands, for the public page and the big screen: who is
 * registered and when round 1 starts, the round in play, or how it finished.
 * `firstRound` is the start time already formatted, or null when unset.
 */
export function eventStatus(
  tournament: Tournament,
  event: {
    pending: readonly PendingResult[];
    finished: boolean;
    firstRound: string | null;
    /** The event's round cap (see TournamentSettings), or null where TOM decides the rounds. */
    roundCap: number | null;
  },
  now: number
): string[] {
  const pod = livePods(tournament).find(p => p.rounds.length > 0);
  if (!pod) {
    const players = tournament.players.filter(player => player.droppedAfter === null).length;
    return ['Registration', plural(players, 'player'), ...(event.firstRound ? [`Round 1 at ${event.firstRound}`] : [])];
  }
  if (event.finished) {
    const swiss = pod.rounds.filter(round => round.kind === 'swiss').length;
    return ['Finished', plural(swiss, 'round'), ...(pod.cut ? [`Top ${pod.cut}`] : [])];
  }
  const progress = podProgress(pod, event.pending);
  const { round } = progress;
  const clock = round && (round.clockStartedAt != null || round.startTime) ? clockLabel(round, now) : null;
  return statusParts(
    progress,
    false,
    clock,
    event.roundCap === null ? null : plannedRounds(pod, event.roundCap, eventTypeOf(tournament))
  );
}

/** A match's result as the pairings show it. */
export const RESULT_WORDS: Partial<Record<Outcome, string>> = {
  p1: '1–0',
  p2: '0–1',
  tie: 'Tie',
  'double-loss': 'Double loss',
  bye: 'Bye',
  loss: 'Missed round'
};

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
  /** The top cut it plays to: the one started, or before then, the one its attendance calls for (0 for none). */
  cut: number;
  /** Whether its top cut has started. */
  cutStarted: boolean;
}

/** The cut a division's attendance calls for, while enough are still in to fill it (see divisionCuts). */
function plannedCut(attendance: number, active: number, type: EventType): number {
  const { cut } = recommendedStructure(attendance, type);
  return cut <= active ? cut : 0;
}

/** One division's table: Swiss places from `pod`, then the top cut `bracket` plays, if any. */
function standingsOf(tournament: Tournament, pod: Pod, only?: ReadonlySet<string>, bracket?: Pod) {
  const played = bracket ?? pod;
  const rows = placeFinals(played, swissStandings(pod, tournament.players, only ? { only } : {}));
  const cutStarted = played.rounds.some(round => round.kind === 'elimination');
  const attendance = attendees(pod).filter(id => !only || only.has(id)).length;
  const active = rows.filter(row => !row.dropped).length;
  return { rows, cut: cutStarted ? played.cut : plannedCut(attendance, active, eventTypeOf(tournament)), cutStarted };
}

/**
 * A pod's standings. A pod of one division is one table; a pod of several is
 * ranked per division, since each division keeps its own standings and top
 * cut (Tournament Rules Handbook §5.2.1), and each takes its final places
 * from its own cut's pod (see Pod.cutOf). A division's cut pod reads as its
 * division's table.
 */
export function podStandings(
  tournament: Tournament,
  pod: Pod,
  divisionOf: (id: string) => Division
): DivisionStandings[] {
  const swiss = pod.cutOf && tournament.pods.find(p => p.category === pod.cutOf);
  if (swiss) {
    return podStandings(tournament, swiss, divisionOf).filter(group => group.division === pod.category);
  }
  if (isDivision(pod.category)) {
    return [{ division: null, ...standingsOf(tournament, pod) }];
  }
  const groups = DIVISIONS.flatMap(division => {
    const only = new Set(pod.playerIds.filter(id => divisionOf(id) === division));
    const bracket = cutPodOf(tournament, pod, division);
    return only.size ? [{ division, ...standingsOf(tournament, pod, only, bracket) }] : [];
  });
  // One division among them, as at an unsanctioned event: one table, with no division to name.
  return groups.length === 1 ? groups.map(group => ({ ...group, division: null })) : groups;
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
  for (const pod of livePods(tournament)) {
    const round = latestRound(pod);
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
  const round = latestRound(pod);
  if (!round || round.kind !== 'swiss') {
    return [];
  }
  const seated = new Set(
    round.matches.filter(m => m.outcome !== 'loss').flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]))
  );
  const dropped = new Set(tournament.players.filter(p => p.droppedAfter !== null).map(p => p.id));
  return pod.playerIds.filter(id => !seated.has(id) && !dropped.has(id));
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
  /**
   * Final by the reports alone, with no result written yet: asking the server
   * writes it in. A result staff entered, or one a TOM event holds for TOM,
   * is already written, so there is nothing to ask for.
   */
  due: boolean;
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
    return { chosen: asResult(shown, seat), disputed: false, locked: true, final: true, due: false };
  }
  const forMatch = reportsFor(reports, pod.category, round.number, match);
  const mine = forMatch.find(report => report.by === me);
  const theirs = forMatch.find(report => report.by !== me);
  if (!mine) {
    return { chosen: null, disputed: false, locked: false, final: false, due: false };
  }
  const final = settles(mine, theirs, now);
  return {
    chosen: asResult(mine.outcome, seat),
    disputed: isDisputed(forMatch),
    locked: isLocked(mine, now),
    final,
    due: final
  };
}

const OUTCOME_WORDS: Partial<Record<Outcome, string>> = {
  tie: 'Tie',
  'double-loss': 'Double loss',
  pending: 'Clear the result'
};

/** An outcome in words, as staff confirm it: "Ash Ketchum wins", "Tie", "Clear the result". */
export function outcomeLabel(outcome: Outcome, match: Match, names: Map<string, string>): string {
  const winner = outcome === 'p1' ? match.p1 : outcome === 'p2' ? match.p2 : null;
  return winner ? `${names.get(winner) ?? winner} wins` : (OUTCOME_WORDS[outcome] ?? '');
}

/** A short tag after a player's name in a pairings row, as what they reported. */
export interface SeatTag {
  text: string;
  /** The tag in full, for its tooltip and for assistive tech. */
  title: string;
  /** Drawn as a problem: reports that differ, or that came from one device. */
  problem: boolean;
}

const REPORT_WORDS: Partial<Record<Outcome, string>> = {
  tie: 'Tie',
  'double-loss': 'Double loss'
};

/**
 * What a report says, beside the player who sent it, in a word (their win or
 * loss, or the tie they called): the result cell beside it already says
 * Reported or Disputed, and a longer tag cut the name short.
 */
function reportTag(report: PlayerReport, match: Match, problem: boolean): SeatTag {
  const winner = report.outcome === 'p1' ? match.p1 : report.outcome === 'p2' ? match.p2 : null;
  const text = winner ? (winner === report.by ? 'Won' : 'Lost') : (REPORT_WORDS[report.outcome] ?? 'Reported');
  return { text, title: `Reported: ${text.toLowerCase()}`, problem };
}

export interface StaffReport {
  /** Stands in for Open in the result cell. */
  label: string;
  problem: boolean;
  /** The whole story, for the label's tooltip and for assistive tech. */
  detail: string;
  /** Each reporter's tag, by player ID. */
  tags: Map<string, SeatTag>;
}

/**
 * What the players reported for an open match: one report, which staff can
 * take as it is, or two that differ, which count for nothing until staff
 * enter the result. The cell says which in a word, and each reporter's tag
 * says what they sent, so the row stays one line.
 */
export function staffReport(
  reports: readonly PlayerReport[],
  match: Match,
  names: Map<string, string>
): StaffReport | null {
  const [first, second] = reports;
  if (!first) {
    return null;
  }
  const said = (report: PlayerReport) =>
    `${names.get(report.by) ?? report.by}: ${outcomeLabel(report.outcome, match, names)}`;
  // Two agreeing reports from one device never settle on their own: one person may have spoken for both seats.
  const shared = Boolean(second && oneDevice(first, second));
  const disputed = isDisputed(reports);
  const problem = shared || disputed;
  const tags = new Map(reports.map(report => [report.by, reportTag(report, match, problem)]));
  if (shared) {
    return {
      label: 'One device',
      problem,
      tags,
      detail: `Both reports came from one device. Reported: ${outcomeLabel(first.outcome, match, names)}`
    };
  }
  return disputed
    ? { label: 'Disputed', problem, tags, detail: `Reports differ. ${reports.map(said).join('; ')}` }
    : { label: 'Reported', problem, tags, detail: `Reported: ${outcomeLabel(first.outcome, match, names)}` };
}

/** The start of round 1 as a time, when the organizer set one. */
export const firstRoundTime = (startsAt: string): string | null =>
  startsAt ? new Date(startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;

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
