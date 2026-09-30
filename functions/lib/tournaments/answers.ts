/**
 * How the routes that change an event finish: the public view is published
 * (see publish.ts), and staff get the console's new copy of the event.
 */

import { jsonError } from '../api/responses.js';
import type { Context } from '../auth/env.js';
import { type Access, manageView, privateJson, type StaffAccess } from './access.js';
import { publishAfter } from './publish.js';
import { settleIfDue } from './results.js';
import type { Mutation, TournamentRow } from './store.js';

/** What a staff change answers with: why it was refused, or the console's new copy of the event. */
export async function answerStaff(context: Context<'code'>, access: StaffAccess, outcome: Mutation): Promise<Response> {
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishAfter(context, outcome.row);
  return privateJson(manageView({ ...access, row: outcome.row }));
}

/**
 * The event with any results its players' reports have settled written in
 * and published: nothing runs on a timer, so whoever asks next settles them.
 */
export async function settled(context: Context<'code'>, access: Access, localTime?: unknown): Promise<TournamentRow> {
  const row = await settleIfDue(access.db, access.row, localTime);
  if (row !== access.row) {
    await publishAfter(context, row);
  }
  return row;
}
