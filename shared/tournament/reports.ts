/**
 * Results players report themselves, from the event's page.
 *
 * Each player in a match says how it went. When both have and they agree, the
 * result stands, as if staff had entered it. When they disagree, neither
 * counts: the match stays open and shows as disputed until a player changes
 * their report or staff enter the result, which settles it either way. One
 * report alone waits for the opponent, and staff can take it as it is.
 */

import { latestRound } from './rounds.js';
import type { Match, Outcome, Pod, PodCategory, Round, Tournament } from './types.js';

/** A match's result as one of its players tells it. */
export type ReportedOutcome = 'p1' | 'p2' | 'tie';

/** How it went for the player reporting. */
export type PlayerResult = 'win' | 'loss' | 'tie';

export const PLAYER_RESULTS: readonly PlayerResult[] = ['win', 'loss', 'tie'];

export interface PlayerReport {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string;
  /** The player who reported, one of the two. */
  by: string;
  outcome: ReportedOutcome;
  at: number;
}

type MatchKey = Pick<PlayerReport, 'pod' | 'round' | 'table' | 'p1' | 'p2'>;

const sameMatch = (a: MatchKey, b: MatchKey) =>
  a.pod === b.pod && a.round === b.round && a.table === b.table && a.p1 === b.p1 && a.p2 === b.p2;

/** The match's result from one seat's word. */
export function reportedOutcome(match: Pick<Match, 'p1'>, by: string, result: PlayerResult): ReportedOutcome {
  if (result === 'tie') {
    return 'tie';
  }
  const wonFirstSeat = (by === match.p1) === (result === 'win');
  return wonFirstSeat ? 'p1' : 'p2';
}

export interface OpenMatch {
  pod: Pod;
  round: Round;
  match: Match & { p2: string };
}

/**
 * The match a player can report now: theirs in their pod's current round,
 * against an opponent, with no result yet. `tournament` has any pending
 * results laid over it (see applyPending), since those count as results.
 */
export function reportableMatch(tournament: Tournament, playerId: string): OpenMatch | string {
  const pod = tournament.pods.find(p => p.playerIds.includes(playerId));
  const round = pod && latestRound(pod);
  const match = round?.matches.find(m => m.p1 === playerId || m.p2 === playerId);
  if (!pod || !round || !match) {
    return 'You are not paired this round';
  }
  if (match.p2 === null) {
    return 'A bye has no result to report';
  }
  if (match.outcome !== 'pending') {
    return 'This match already has a result';
  }
  return { pod, round, match: { ...match, p2: match.p2 } };
}

/** A player's report of their open match, or why it cannot be one. */
export function playerReport(open: OpenMatch, by: string, result: PlayerResult, at: number): PlayerReport | string {
  if (open.round.kind === 'elimination' && result === 'tie') {
    return 'A top cut match needs a winner';
  }
  const { pod, round, match } = open;
  const outcome = reportedOutcome(match, by, result);
  return { pod: pod.category, round: round.number, table: match.table, p1: match.p1, p2: match.p2, by, outcome, at };
}

export interface Filed {
  reports: PlayerReport[];
  /** The result both players agree on, which now stands; null while it does not. */
  agreed: ReportedOutcome | null;
}

/**
 * Adds a player's report, replacing any earlier one of theirs for the match.
 * If the opponent has reported the same result, the pair is settled and both
 * reports are taken out; a differing one stays, and the match is disputed.
 */
export function fileReport(reports: readonly PlayerReport[], report: PlayerReport): Filed {
  const rest = reports.filter(r => !(sameMatch(r, report) && r.by === report.by));
  const other = rest.find(r => sameMatch(r, report));
  if (other?.outcome === report.outcome) {
    return { reports: rest.filter(r => !sameMatch(r, report)), agreed: report.outcome };
  }
  return { reports: [...rest, report], agreed: null };
}

/** The reports filed for one match. */
export function reportsFor(reports: readonly PlayerReport[], pod: PodCategory, round: number, match: Match) {
  return match.p2 === null
    ? []
    : reports.filter(r => sameMatch(r, { pod, round, table: match.table, p1: match.p1, p2: match.p2 as string }));
}

/** Whether both players have reported a match and said different things. */
export function isDisputed(forMatch: readonly PlayerReport[]): boolean {
  const [first, second] = forMatch;
  return first !== undefined && second !== undefined && first.outcome !== second.outcome;
}

/**
 * The reports still waiting on something: a report is dropped once its match
 * has a result, from staff, TOM or a pending entry, or is gone (re-paired).
 * As with reportableMatch, pending results are laid over `tournament`.
 */
export function pruneReports(tournament: Tournament, reports: readonly PlayerReport[]): PlayerReport[] {
  return reports.filter(report => {
    const round = tournament.pods.find(p => p.category === report.pod)?.rounds.find(r => r.number === report.round);
    const match = round?.matches.find(m => m.table === report.table && m.p1 === report.p1 && m.p2 === report.p2);
    return match?.outcome === 'pending';
  });
}

/** The reports under public keys. */
export function publicReports(reports: readonly PlayerReport[], keys: Record<string, string>): PlayerReport[] {
  const key = (id: string) => keys[id] ?? id;
  return reports.map(report => ({ ...report, p1: key(report.p1), p2: key(report.p2), by: key(report.by) }));
}

/** Staff's result for a match, in the terms a command or pending entry takes. */
export function resultFor(open: OpenMatch, outcome: Outcome) {
  const { pod, round, match } = open;
  return { pod: pod.category, round: round.number, table: match.table, p1: match.p1, p2: match.p2, outcome };
}
