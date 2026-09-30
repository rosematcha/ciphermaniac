/**
 * GET /api/tournaments/:code/manage — the whole document, for the event's
 * staff. The console asks every few seconds, so this is also where results
 * the players' reports have settled get written in (see settleIfDue).
 * `?since=<version>` answers 204 when that version still stands and no report
 * is due to settle, which is what the console polls with: an idle console
 * costs one small read, not the whole document. `?localTime=` is the venue's
 * clock, which results settled here are stamped with, as a command's are.
 */

import { dueResults } from '../../../../shared/tournament/reports.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, open, pollOf, privateJson } from '../../../lib/tournaments/access.js';
import { settled } from '../../../lib/tournaments/answers.js';
import { loadHead } from '../../../lib/tournaments/store.js';

/** Whether the asker is the event's staff and their copy is still current; anything else takes the full answer. */
async function unchanged(context: Context<'code'>): Promise<boolean> {
  const poll = pollOf(context);
  const head = poll && (await loadHead(poll.db, poll.code, context.request));
  return (
    poll !== null &&
    head !== null &&
    head.staff &&
    head.version === poll.since &&
    dueResults(head.reports, Date.now()).length === 0
  );
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  if (await unchanged(context)) {
    return noContent();
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  const { role } = access;
  if (!role) {
    return jsonError(access.user ? 'Only this event’s staff can do that' : 'Sign in first', access.user ? 403 : 401);
  }
  const localTime = new URL(context.request.url).searchParams.get('localTime');
  return privateJson(manageView({ ...access, role, row: await settled(context, access, localTime) }));
}
