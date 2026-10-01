/**
 * DELETE /api/tournaments/:code/claim — the signed-in account stops being
 * the player it is at the event: its Claim, or the row its POP ID made (see
 * lib/tournaments/reporters.ts). That takes an unsanctioned event out of its
 * History and lets another device or account be that player. It works once
 * the event is over too, which is the only way to take a finished event out
 * of History; a finished event takes no new Claim, so there it is for good.
 * An account with no player here gets the same answer.
 */

import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { open } from '../../../lib/tournaments/access.js';

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.user) {
    return jsonError('Sign in first', 401);
  }
  await access.db
    .prepare('DELETE FROM report_devices WHERE code = ? AND user_id = ?')
    .bind(access.row.code, access.user.id)
    .run();
  return noContent();
}
