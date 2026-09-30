/**
 * GET /api/tournaments/:code/manage — the whole document, for the event's
 * staff. The console asks every few seconds, so this is also where results
 * the players' reports have settled get written in (see settleIfDue).
 * `?since=<version>` answers 204 when that version still stands and no report
 * is due to settle, which is what the console polls with: an idle console
 * costs a few small reads, not the whole document.
 */

import { dueResults } from '../../../../shared/tournament/reports.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { currentUserId } from '../../../lib/auth/session.js';
import { manageView, open, privateJson } from '../../../lib/tournaments/access.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import { settleIfDue } from '../../../lib/tournaments/results.js';
import { isCode, isStaffMember, loadHead } from '../../../lib/tournaments/store.js';

/** Whether the asker is the event's staff and their copy is still current; anything else takes the full answer. */
async function unchanged(context: Context<'code'>): Promise<boolean> {
  const since = Number(new URL(context.request.url).searchParams.get('since'));
  const db = context.env.TOURNAMENT_DB;
  const code = param(context.params.code).toUpperCase();
  if (!since || !db || !isCode(code)) {
    return false;
  }
  const head = await loadHead(db, code);
  if (!head || head.version !== since || dueResults(head.reports, Date.now()).length > 0) {
    return false;
  }
  const userId = await currentUserId(db, context.request);
  return userId !== null && (userId === head.ownerId || (await isStaffMember(db, code, userId)));
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  if (await unchanged(context)) {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.role) {
    return jsonError(access.user ? 'Only this event’s staff can do that' : 'Sign in first', access.user ? 403 : 401);
  }
  const row = await settleIfDue(access.db, access.row);
  if (row !== access.row) {
    await publishAfter(context, row);
  }
  return privateJson(manageView({ ...access, row }));
}
