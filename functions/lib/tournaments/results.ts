/**
 * What one organizer action changes in the stored event, shared by the staff
 * commands endpoint and the players' own reports once they agree and lock.
 *
 * A Swiss event applies the command to the document. A TOM-run event only
 * takes results: TOM owns its pairings, so a result entered here is held as
 * pending and shown until the .tdf that TOM writes has its own.
 */

import { applyCommand, type Command } from '../../../shared/tournament/commands.js';
import { dueResults, resultOf } from '../../../shared/tournament/reports.js';
import { prunePending, withPending } from '../../../shared/tournament/view.js';
import type { D1Like } from '../types.js';
import { commandContext } from './commandContext.js';
import { type Changes, mutate, type TournamentRow } from './store.js';

/**
 * A result for TOM to take in. Only an open match takes one: TOM's own result
 * wins over anything written here, so a correction would never land.
 */
function pendingChange(row: TournamentRow, command: Extract<Command, { type: 'reportResult' }>): Changes | string {
  const pod = row.tournament.pods.find(p => p.category === command.pod);
  const match = pod?.rounds
    .find(r => r.number === command.round)
    ?.matches.find(m => m.table === command.table && m.p1 === command.p1 && m.p2 === command.p2);
  if (match?.outcome !== 'pending') {
    return 'TOM already has a result for this match; change it in TOM';
  }
  const { pod: category, round, table, p1, p2, outcome } = command;
  const next = { pod: category, round, table, p1, p2, outcome, at: Date.now() };
  return { pending: withPending(prunePending(row.tournament, row.pending), next) };
}

/** The changes `command` makes, or why it cannot run. */
export function commandChanges(row: TournamentRow, command: Command, localTime: unknown): Changes | string {
  if (row.mode === 'tom' && command.type !== 'reportResult') {
    return 'TOM runs this event; make that change in TOM';
  }
  const result = applyCommand(row.tournament, command, commandContext(row.tournament, localTime));
  if (!result.ok) {
    return result.error;
  }
  if (row.mode === 'swiss') {
    return { tournament: result.tournament };
  }
  return command.type === 'reportResult' ? pendingChange(row, command) : 'Not a result';
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
  code: string,
  change: (row: TournamentRow) => Changes | string,
  localTime?: unknown
) {
  return mutate(db, code, row => {
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
  const outcome = await mutateSettled(db, row.code, () => ({}), localTime);
  return 'error' in outcome ? row : outcome.row;
}
