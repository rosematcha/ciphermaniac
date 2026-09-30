/**
 * Results players report themselves, from the event's page.
 *
 * Each player in a match says how it went, and can change their mind for a
 * short window before their report locks. When both reports agree and both
 * have locked, the result stands, as if staff had entered it. When they
 * disagree, neither counts: the match stays open and shows as disputed until
 * staff enter the result, which settles it either way. One report alone
 * waits for the opponent, and staff can take it as it is. Two agreeing
 * reports sent from one device never settle on their own: staff look first.
 */

import { latestRound } from './rounds.js';
import type { Match, Pod, PodCategory, Round, Tournament } from './types.js';

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
  /** The hashed device that filed it; kept from the public view. */
  device?: string;
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

/** The match a player's page showed them when they reported, so a stale page cannot report the next round's. */
export type ShownMatch = Pick<PlayerReport, 'pod' | 'round' | 'table'>;

/** Whether `open` is still the match the player's page showed, when it said which. */
export const stillShown = (open: OpenMatch, shown: ShownMatch | undefined): boolean =>
  !shown || (shown.pod === open.pod.category && shown.round === open.round.number && shown.table === open.match.table);

/** A player's report of their open match, or why it cannot be one. */
export function playerReport(
  open: OpenMatch,
  by: string,
  result: PlayerResult,
  filed: { at: number; device?: string }
): PlayerReport | string {
  if (open.round.kind === 'elimination' && result === 'tie') {
    return 'A top cut match needs a winner';
  }
  const { pod, round, match } = open;
  const outcome = reportedOutcome(match, by, result);
  return {
    pod: pod.category,
    round: round.number,
    table: match.table,
    p1: match.p1,
    p2: match.p2,
    by,
    outcome,
    at: filed.at,
    ...(filed.device ? { device: filed.device } : {})
  };
}

/** How long a player has to change a report before it locks. */
export const REPORT_WINDOW_MS = 30_000;

export const isLocked = (report: Pick<PlayerReport, 'at'>, now: number): boolean => now - report.at >= REPORT_WINDOW_MS;

/** Adds a player's report in place of an earlier one of theirs, unless that one has locked. */
export function fileReport(reports: readonly PlayerReport[], report: PlayerReport): PlayerReport[] | string {
  const own = reports.find(r => sameMatch(r, report) && r.by === report.by);
  if (own && isLocked(own, report.at)) {
    return 'Your report has locked; ask staff to change it';
  }
  return [...reports.filter(r => r !== own), report];
}

/** Whether both of a match's reports came from one device: one person speaking for both seats. */
export const oneDevice = (a: Pick<PlayerReport, 'device'>, b: Pick<PlayerReport, 'device'>): boolean =>
  a.device !== undefined && a.device === b.device;

/**
 * One report from each match whose two reports agree, have both locked and
 * came from two devices: those results now stand.
 */
export function dueResults(reports: readonly PlayerReport[], now: number): PlayerReport[] {
  return reports.filter(report => {
    if (report.by !== report.p1) {
      return false;
    }
    const other = reports.find(r => sameMatch(r, report) && r.by === report.p2);
    return (
      other?.outcome === report.outcome && isLocked(report, now) && isLocked(other, now) && !oneDevice(report, other)
    );
  });
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

/** The reports under public keys, without the devices they came from. */
export function publicReports(reports: readonly PlayerReport[], keys: Record<string, string>): PlayerReport[] {
  const key = (id: string) => keys[id] ?? id;
  return reports.map(({ device: _device, ...report }) => ({
    ...report,
    p1: key(report.p1),
    p2: key(report.p2),
    by: key(report.by)
  }));
}

/** The result a settled report stands for, as the command staff would send. */
export function resultOf(report: PlayerReport) {
  const { pod, round, table, p1, p2, outcome } = report;
  return { type: 'reportResult' as const, pod, round, table, p1, p2, outcome };
}
