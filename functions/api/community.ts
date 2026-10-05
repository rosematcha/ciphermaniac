/**
 * POST /api/community — the signed-in account becomes a Community organizer
 * (shared/accounts/roles.ts): it may start unsanctioned events under its own
 * name, within the limits shared/tournament/limits.ts sets. Nobody approves
 * it; an Admin can take it away, and an account whose access was taken away
 * cannot ask again. Answers { user }; 409 when the account has a role.
 */

import { canJoinCommunity, readAccountRole } from '../../shared/accounts/roles.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import { type Context, sameOrigin } from '../lib/auth/env.js';
import { currentAccount } from '../lib/auth/session.js';
import { rowsChanged } from '../lib/d1.js';

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentAccount(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const refusal = user.role === 'revoked' ? 'An admin removed your access' : 'You already run events';
  if (!canJoinCommunity(user.role)) {
    return jsonError(refusal, 409);
  }
  // Only while the account still has no role as the write lands: an Admin may have acted since the read.
  const changed = await db
    .prepare("UPDATE users SET role = 'community', role_at = ? WHERE id = ? AND role IS NULL")
    .bind(Date.now(), user.id)
    .run();
  if (rowsChanged(changed) === 0) {
    return jsonError(refusal, 409);
  }
  return jsonResponse(
    { user: { ...user, role: readAccountRole('community') } },
    { cacheControl: 'no-store', cors: false }
  );
}
