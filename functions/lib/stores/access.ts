/**
 * The checks every store route starts with: is the database bound, is the
 * store real, who is asking, and may they do this. An Admin may do anything
 * a store's Manager may.
 */

import type { StoreRole } from '../../../shared/accounts/stores.js';
import { isAdmin } from '../../../shared/accounts/roles.js';
import type { Store } from '../../../shared/accounts/types.js';
import { jsonError } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import { sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { firstRow } from '../d1.js';
import type { D1Like } from '../types.js';
import { type Guard, loadStore } from './db.js';

export interface StoreAccess {
  db: D1Like;
  user: User | null;
  store: Store;
  /** What the asker is in the store; an Admin reads as its Manager. */
  role: StoreRole | null;
  guard: (need: Exclude<Need, 'anyone'>) => Guard;
}

export type Need = 'anyone' | 'member' | 'manager';

/** The asker and their role in the store, read in one round trip with the session. */
async function asker(db: D1Like, request: Request, storeId: string) {
  const hash = await sessionHash(request);
  if (!hash) {
    return { user: null, role: null, hash: '' };
  }
  const now = Date.now();
  const [account, member] = await db.batch([
    sessionUserQuery(db, hash, now),
    db
      .prepare(
        'SELECT m.role FROM store_members m JOIN sessions ON sessions.user_id = m.user_id ' +
          'WHERE m.store_id = ? AND sessions.token_hash = ? AND sessions.expires_at > ?'
      )
      .bind(storeId, hash, now)
  ]);
  const row = firstRow<UserRow>(account);
  const user = row && userFromRow(row);
  const stored = firstRow<{ role: string }>(member)?.role;
  const role: StoreRole | null =
    isAdmin(user?.role ?? null) || stored === 'manager' ? 'manager' : stored ? 'staff' : null;
  return { user, role: user ? role : null, hash };
}

const REFUSALS: Record<Exclude<Need, 'anyone'>, string> = {
  member: 'Only this store’s staff can do that',
  manager: 'Only this store’s managers can do that'
};

/** The store the route names and who is asking; a Response when either cannot be had or `need` is not met. */
export async function openStore(context: Context<'id'>, need: Need): Promise<StoreAccess | Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Stores are not available', 503);
  }
  if (context.request.method !== 'GET' && !sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const id = param(context.params.id);
  const [store, who] = await Promise.all([loadStore(db, id), asker(db, context.request, id)]);
  if (!store) {
    return jsonError('No such store', 404);
  }
  if (need !== 'anyone' && !who.user) {
    return jsonError('Sign in first', 401);
  }
  const allowed = need === 'anyone' || (need === 'member' ? who.role !== null : who.role === 'manager');
  const guard = (required: Exclude<Need, 'anyone'>): Guard => ({
    sql:
      'EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.token_hash = ? AND s.expires_at > ? AND u.age_checked_at IS NOT NULL AND ' +
      "(u.role = 'admin' OR EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = ? " +
      `AND m.user_id = u.id${required === 'manager' ? " AND m.role = 'manager'" : ''})))`,
    values: [who.hash, Date.now(), id]
  });
  return allowed
    ? { db, store, user: who.user, role: who.role, guard }
    : jsonError(REFUSALS[need as Exclude<Need, 'anyone'>], 403);
}
