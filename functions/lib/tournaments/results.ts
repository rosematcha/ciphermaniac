/**
 * What one organizer action changes in the stored event, shared by the staff
 * commands endpoint and the players' own reports once they agree.
 *
 * A Swiss event applies the command to the document. A TOM-run event only
 * takes results: TOM owns its pairings, so a result entered here is held as
 * pending and shown until the .tdf that TOM writes has its own.
 */

import { applyCommand, type Command } from '../../../shared/tournament/commands.js';
import { prunePending, withPending } from '../../../shared/tournament/view.js';
import { commandContext } from './commandContext.js';
import type { Changes, TournamentRow } from './store.js';

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
