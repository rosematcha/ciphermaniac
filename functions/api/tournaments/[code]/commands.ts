/**
 * POST /api/tournaments/:code/commands — one organizer action (see
 * shared/tournament/commands.ts), from the event's staff.
 *
 * A Swiss event applies it to the document. A TOM-run event takes results,
 * held as pending until the .tdf that TOM writes has its own, and the round
 * clock, which the site runs (see functions/lib/tournaments/results.ts).
 */

import { readCommand } from '../../../../shared/tournament/readCommand.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { commandChanges, mutateSettled } from '../../../lib/tournaments/results.js';

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const value = await readJsonObject(context.request, 4096);
  const command = value ? readCommand(value.command) : null;
  if (!command) {
    return jsonError('Not a command', 400);
  }
  const outcome = await mutateSettled(
    access.db,
    access.row,
    row => commandChanges(row, command, value?.localTime),
    value?.localTime
  );
  return answerStaff(context, access, outcome);
}
