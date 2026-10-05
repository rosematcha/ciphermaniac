/**
 * POST /api/tournaments/:code/commands — one organizer action (see
 * shared/tournament/commands.ts), from the event's staff.
 *
 * A Swiss event applies it to the document. A TOM-run event takes results,
 * held as pending until the .tdf that TOM writes has its own, and the round
 * clock, which the site runs (see functions/lib/tournaments/results.ts).
 */

import type { Command } from '../../../../shared/tournament/commands.js';
import { readCommand } from '../../../../shared/tournament/readCommand.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { commandChanges, mutateSettled } from '../../../lib/tournaments/results.js';
import type { TournamentRow } from '../../../lib/tournaments/store.js';

/**
 * The command as this event takes it: a Community organizer's event is of no
 * Play! Pokémon kind, and holds the date its start time names, so an edit to
 * either is left out.
 */
function forEvent(command: Command, row: TournamentRow): Command {
  if (command.type !== 'updateInfo' || row.communityDay === null) {
    return command;
  }
  const { eventType: _kind, startDate: _date, ...info } = command.info;
  return { ...command, info };
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const value = await readJsonObject(context.request, 4096);
  const read = value ? readCommand(value.command) : null;
  if (!read) {
    return jsonError('Not a command', 400);
  }
  const command = forEvent(read, access.row);
  const outcome = await mutateSettled(
    access.db,
    access.row,
    row => commandChanges(row, command, value?.localTime),
    value?.localTime
  );
  return answerStaff(context, access, outcome);
}
