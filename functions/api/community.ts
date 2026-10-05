/**
 * POST /api/community — the signed-in account becomes a Community organizer
 * (shared/accounts/roles.ts): it may start unsanctioned events under its own
 * name, within the limits shared/tournament/limits.ts sets. Nobody approves
 * it; an Admin can take it away, and an account whose access was taken away
 * cannot ask again. Answers { user }; 409 when the account has a role.
 * DELETE /api/community — a Community organizer resigns: it starts no more
 * events under its own name, and keeps and runs the ones it owns, as one
 * whose access was removed does; unlike that one, it may ask again. Its
 * creations still count toward the daily limit. Answers { user }; 409 when
 * the account is not a Community organizer.
 */

import { type AccountRole, canJoinCommunity, readAccountRole } from '../../shared/accounts/roles.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import { type Context, sameOrigin } from '../lib/auth/env.js';
import { currentAccount, type User } from '../lib/auth/session.js';
import { rowsChanged } from '../lib/d1.js';

/** The signed-in account, or the answer that turns the request away. */
async function asker({ request, env }: Context) {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentAccount(db, request);
  return user ? { db, user } : jsonError('Sign in first', 401);
}

const answer = (user: User, role: AccountRole | null) =>
  jsonResponse({ user: { ...user, role } }, { cacheControl: 'no-store', cors: false });

export async function onRequestPost(context: Context): Promise<Response> {
  const found = await asker(context);
  if (found instanceof Response) {
    return found;
  }
  const { db, user } = found;
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
  return answer(user, readAccountRole('community'));
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const found = await asker(context);
  if (found instanceof Response) {
    return found;
  }
  const { db, user } = found;
  // Only while the account is still one as the write lands: an Admin may have removed its access since the read.
  const changed = await db
    .prepare("UPDATE users SET role = NULL, role_at = ? WHERE id = ? AND role = 'community'")
    .bind(Date.now(), user.id)
    .run();
  return rowsChanged(changed) === 1 ? answer(user, null) : jsonError('You are not a community organizer', 409);
}
