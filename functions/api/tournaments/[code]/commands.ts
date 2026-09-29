/**
 * POST /api/tournaments/:code/commands — one organizer action (see
 * shared/tournament/commands.ts), from the event's staff.
 *
 * A Swiss event applies it to the document. A TOM-run event only takes
 * results: TOM owns its pairings, so a result entered here is held as pending
 * and shown until the .tdf that TOM writes has its own.
 */

import { readCommand } from '../../../../shared/tournament/readCommand.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { commandChanges, mutateSettled } from '../../../lib/tournaments/results.js';

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
  const outcome = await mutateSettled(
    access.db,
    access.row,
    row => commandChanges(row, command, value?.localTime),
    value?.localTime
  );
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env.REPORTS, outcome.row);
  return privateJson(manageView({ ...access, row: outcome.row }));
}
