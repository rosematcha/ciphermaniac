/**
 * GET /api/tournaments/:code/manage — the whole document, for the event's
 * staff. The console asks every few seconds, so this is also where results
 * the players' reports have settled get written in (see settleIfDue).
 */

import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, open, privateJson } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { settleIfDue } from '../../../lib/tournaments/results.js';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.role) {
    return jsonError(access.user ? 'Only this event’s staff can do that' : 'Sign in first', access.user ? 403 : 401);
  }
  const row = await settleIfDue(access.db, access.row);
  if (row !== access.row) {
    await publishView(context.env, row);
  }
  return privateJson(manageView({ ...access, row }));
}
