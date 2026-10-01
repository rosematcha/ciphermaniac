/**
 * What one organizer action changes in the stored event, shared by the staff
 * commands endpoint and the players' own reports once they agree and lock.
 *
 * A Swiss event applies the command to the document. A TOM-run event takes
 * results and the round clock: TOM owns its pairings, so a result entered here
 * is held as pending and shown until the .tdf that TOM writes has its own,
 * while the clock is the site's (see shared/tournament/tomClock.ts).
 */

import { applyCommand, type Command } from '../../../shared/tournament/commands.js';
import { dueResults, resultOf } from '../../../shared/tournament/reports.js';
import { isOpenMatch } from '../../../shared/tournament/rounds.js';
import type { PodCategory, Tournament } from '../../../shared/tournament/types.js';
import { applyPending, prunePending, withPending } from '../../../shared/tournament/view.js';
import type { D1Like } from '../types.js';
import { commandContext } from './commandContext.js';
import { type Changes, mutate, type TournamentRow } from './store.js';

/**
 * A result for TOM to take in. Only an open match takes one: TOM's own result
 * wins over anything written here, so a correction would never land.
 */
function pendingChange(row: TournamentRow, command: Extract<Command, { type: 'reportResult' }>): Changes | string {
  if (!isOpenMatch(row.tournament, command)) {
    return 'TOM already has a result for this match; change it in TOM';
  }
  const { pod: category, round, table, p1, p2, outcome } = command;
  const next = { pod: category, round, table, p1, p2, outcome, at: Date.now() };
  return { pending: withPending(prunePending(row.tournament, row.pending), next) };
}

/** What a TOM-run event takes from the site: results for TOM, and the round clock, which the site runs. */
const TOM_COMMANDS: ReadonlySet<Command['type']> = new Set(['reportResult', 'startClock', 'stopClock', 'adjustClock']);

/** The changes `command` makes, or why it cannot run. */
export function commandChanges(row: TournamentRow, command: Command, localTime: unknown): Changes | string {
  if (row.mode === 'tom' && !TOM_COMMANDS.has(command.type)) {
    return 'TOM runs this event; make that change in TOM';
  }
  const result = applyCommand(row.tournament, command, commandContext(row.tournament, localTime));
  if (!result.ok) {
    return result.error;
  }
  if (row.mode === 'tom' && command.type === 'reportResult') {
    return pendingChange(row, command);
  }
  return { tournament: result.tournament };
}

/**
 * A TOM event's next round in `pod`, paired over the results entered here,
 * or why it cannot be. Nothing is stored: the console writes the round into
 * TOM's file, and the site takes it from the file's next sync, so until the
 * file has it the results stay pending and no round is held that it lacks.
 * Round 1 is TOM's, which pods the field.
 */
export function tomNextRound(row: TournamentRow, pod: PodCategory, localTime: unknown): Tournament | string {
  if (!row.tournament.pods.find(p => p.category === pod)?.rounds.length) {
    return 'Pair round 1 in TOM';
  }
  const tournament = applyPending(row.tournament, row.pending);
  const result = applyCommand(tournament, { type: 'pairRound', pod }, commandContext(row.tournament, localTime));
  return result.ok ? result.tournament : result.error;
}

/**
 * The results players' reports settle by `now`: every match whose two reports
 * agree and have locked, entered as staff would. Null when none is due.
 */
export function settledChanges(row: TournamentRow, now: number, localTime?: unknown): Changes | null {
  const due = dueResults(row.reports, now);
  if (due.length === 0) {
    return null;
  }
  let current = row;
  let changes: Changes = {};
  for (const report of due) {
    const next = commandChanges(current, resultOf(report), localTime);
    if (typeof next !== 'string') {
      changes = { ...changes, ...next };
      current = { ...current, ...next };
    }
  }
  return changes;
}

/**
 * As `mutate`, with any results the players' reports have settled written in
 * the same change. Nothing runs on a timer, so a result stands at the first
 * write or read after both reports lock (see settleIfDue).
 */
export function mutateSettled(
  db: D1Like,
  read: TournamentRow,
  change: (row: TournamentRow) => Changes | string,
  localTime?: unknown
) {
  return mutate(db, read, row => {
    const settled = settledChanges(row, Date.now(), localTime) ?? {};
    const next = change({ ...row, ...settled });
    return typeof next === 'string' ? next : { ...settled, ...next };
  });
}

/** Writes the settled results when any are due; the row as it now stands. */
export async function settleIfDue(db: D1Like, row: TournamentRow, localTime?: unknown): Promise<TournamentRow> {
  if (dueResults(row.reports, Date.now()).length === 0) {
    return row;
  }
  const outcome = await mutateSettled(db, row, () => ({}), localTime);
  return 'error' in outcome ? row : outcome.row;
}
