/**
 * The check every admin route starts with: is the database bound, did the
 * request come from this site, is someone signed in, and are they an Admin.
 * Admins are set by hand in SQL; no request grants or takes away the role.
 */

import { isAdmin } from '../../../shared/accounts/roles.js';
import { jsonError } from '../api/responses.js';
import type { D1Like } from '../types.js';
import { type Context, sameOrigin } from './env.js';
import { currentUser, type User } from './session.js';

export interface AdminAccess {
  db: D1Like;
  admin: User;
}

/** The database and the Admin asking, or the answer that turns the request away. */
export async function openForAdmin<Params extends string>(context: Context<Params>): Promise<AdminAccess | Response> {
  const { request, env } = context;
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Admin is not available', 503);
  }
  if (!sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  return isAdmin(user.role) ? { db, admin: user } : jsonError('Admins only', 403);
}
