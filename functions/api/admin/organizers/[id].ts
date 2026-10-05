/**
 * POST /api/admin/organizers/:id — an Admin removes a Community organizer's
 * access ({ role: 'revoked' }) or gives it back ({ role: 'community' }). A
 * revoked account keeps every event it owns, every staff seat it holds and
 * every store it belongs to; it only starts no more events of its own, and
 * cannot become a Community organizer again by asking. Only a Community
 * organizer or a revoked one changes here: an Admin, or an account with no
 * role, is 404. Answers { account }.
 */

import { holderOf, roleHolderQuery, type RoleHolderRow } from '../../../lib/accounts/organizers.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { firstRow, rowsChanged } from '../../../lib/d1.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { role } = (await readJsonObject(context.request, 256)) ?? {};
  if (role !== 'community' && role !== 'revoked') {
    return jsonError('Revoke or reinstate', 400);
  }
  const { db, admin } = access;
  const id = param(context.params.id);
  const [changed, account] = await db.batch([
    db
      .prepare("UPDATE users SET role = ?, role_at = ?, role_by = ? WHERE id = ? AND role IN ('community', 'revoked')")
      .bind(role, Date.now(), admin.id, id),
    roleHolderQuery(db, id)
  ]);
  const row = firstRow<RoleHolderRow>(account);
  return rowsChanged(changed) === 1 && row
    ? privateJson({ account: holderOf(row) })
    : jsonError('Not an organizer', 404);
}
