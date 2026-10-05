/**
 * POST /api/stores/join — the signed-in account joins a store through an
 * invite link a Manager made ({ token }). Each link lets one person in, as
 * the role it was made for. Answers { storeId }; 410 when the link was used,
 * withdrawn or ran out.
 */

import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { currentUser } from '../../lib/auth/session.js';
import { acceptInvite } from '../../lib/stores/db.js';
import { privateJson } from '../../lib/tournaments/access.js';

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const token = (await readJsonObject(request, 512))?.token;
  const storeId = typeof token === 'string' && token ? await acceptInvite(db, token, user.id) : null;
  return storeId ? privateJson({ storeId }) : jsonError('This invite link was used or has run out', 410);
}
