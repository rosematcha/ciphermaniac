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

import { divisionsOf } from './podding.js';
import { isOpenMatch, latestRound, type MatchKey, podOf, sameMatch } from './rounds.js';
import { isDivision, type Match, type Pod, type PodCategory, type Round, type Tournament } from './types.js';

/** A match's result as one of its players tells it. */
export type ReportedOutcome = 'p1' | 'p2' | 'tie';

/** How it went for the player reporting. */
export type PlayerResult = 'win' | 'loss' | 'tie';

export const PLAYER_RESULTS: readonly PlayerResult[] = ['win', 'loss', 'tie'];

export interface PlayerReport extends MatchKey {
  p2: string;
  /** The player who reported, one of the two. */
  by: string;
  outcome: ReportedOutcome;
  at: number;
  /**
   * The hashed device that filed it. The public view only says whether both
   * of a match's reports came from one device (see publicReports).
   */
  device?: string;
}

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
  const pod = podOf(tournament, playerId);
  const round = latestRound(pod);
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

/**
 * Whether `open` is still the match the player's page showed, when it said
 * which. A page published before a division's top cut moved into its Swiss
 * pod names the division; as in TOM, that is the pod playing the division.
 */
export const stillShown = (open: OpenMatch, shown: ShownMatch | undefined): boolean =>
  !shown || (samePod(shown.pod, open.pod) && shown.round === open.round.number && shown.table === open.match.table);

const samePod = (named: PodCategory, pod: Pod): boolean =>
  named === pod.category || (isDivision(named) && divisionsOf(pod.category).includes(named));

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
 * Whether a match's two reports settle it at `now`: they say the same, both
 * have locked, and they came from two devices. The player's page asks this
 * too, so it calls a result settled exactly when the server will write it.
 */
export function settles(report: PlayerReport, other: PlayerReport | undefined, now: number): boolean {
  return (
    other?.outcome === report.outcome && isLocked(report, now) && isLocked(other, now) && !oneDevice(report, other)
  );
}

/** One report from each match whose two reports settle it: those results now stand. */
export function dueResults(reports: readonly PlayerReport[], now: number): PlayerReport[] {
  return reports.filter(
    report =>
      report.by === report.p1 &&
      settles(
        report,
        reports.find(r => sameMatch(r, report) && r.by === report.p2),
        now
      )
  );
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
  return reports.map(report => followPod(tournament, report)).filter(report => isOpenMatch(tournament, report));
}

/**
 * A report whose pod was renamed under it, as when a late player of a
 * division nobody played joins it, follows its players to the pod they play
 * that round in.
 */
function followPod(tournament: Tournament, report: PlayerReport): PlayerReport {
  if (tournament.pods.some(pod => pod.category === report.pod)) {
    return report;
  }
  const pod = tournament.pods.find(
    p => p.playerIds.includes(report.p1) && p.rounds.some(round => round.number === report.round)
  );
  return pod ? { ...report, pod: pod.category } : report;
}

/** One mark on both of a match's public reports when one device sent them, so its page does not call them settled. */
const SHARED_DEVICE = 'shared';

function publicDevice(reports: readonly PlayerReport[], report: PlayerReport): Pick<PlayerReport, 'device'> {
  const other = reports.find(r => sameMatch(r, report) && r.by !== report.by);
  return other && oneDevice(report, other) ? { device: SHARED_DEVICE } : {};
}

/** The reports under public keys, without the devices they came from. */
export function publicReports(reports: readonly PlayerReport[], keys: Record<string, string>): PlayerReport[] {
  const key = (id: string) => keys[id] ?? id;
  return reports.map(report => {
    const { device: _device, ...rest } = report;
    return { ...rest, ...publicDevice(reports, report), p1: key(report.p1), p2: key(report.p2), by: key(report.by) };
  });
}

/** The result a settled report stands for, as the command staff would send. */
export function resultOf(report: PlayerReport) {
  const { pod, round, table, p1, p2, outcome } = report;
  return { type: 'reportResult' as const, pod, round, table, p1, p2, outcome };
}
