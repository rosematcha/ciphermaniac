/** GET /api/tournaments/:code/manage — the whole document, for the event's staff. */

import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, open, privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.role) {
    return jsonError(access.user ? 'Only this event’s staff can do that' : 'Sign in first', access.user ? 403 : 401);
  }
  return privateJson(manageView(access));
}
