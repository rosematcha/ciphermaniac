/**
 * POST /api/tournaments/:code/commands — one organizer action (see
 * shared/tournament/commands.ts), from the event's staff.
 *
 * A Swiss event applies it to the document. A TOM-run event only takes
 * results: TOM owns its pairings, so a result entered here is held as pending
 * and shown until the .tdf that TOM writes has its own.
 */

import { applyCommand, type Command } from '../../../../shared/tournament/commands.js';
import { readCommand } from '../../../../shared/tournament/readCommand.js';
import { prunePending, withPending } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { commandContext } from '../../../lib/tournaments/commandContext.js';
import { type Changes, mutate, type TournamentRow } from '../../../lib/tournaments/store.js';

function changesFor(row: TournamentRow, command: Command, localTime: unknown): Changes | string {
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

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonBody(context.request, 4096);
  const value =
    body.ok && typeof body.value === 'object' && body.value !== null ? (body.value as Record<string, unknown>) : null;
  const command = value ? readCommand(value.command) : null;
  if (!command) {
    return jsonError('Not a command', 400);
  }
  const outcome = await mutate(access.db, access.row.code, row => changesFor(row, command, value?.localTime));
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  return privateJson(manageView({ ...access, row: outcome.row }));
}
